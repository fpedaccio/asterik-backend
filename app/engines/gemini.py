"""Engine A — direct image edit via Gemini."""
from __future__ import annotations

import io
from typing import Any

import numpy as np
from google import genai
from google.genai import types
from PIL import Image

from app.core.config import get_settings

_SYSTEM_INSTRUCTION = (
    "You are an expert cinematographer and colorist. Your only job is to apply an extreme, "
    "dramatic, cinematic color grade to the image. Push the colors, contrast, saturation, "
    "shadows, highlights, temperature, and film grain as far as needed to fully commit to "
    "the described aesthetic — do not be timid or subtle. The grade should be immediately "
    "striking and unmistakable. "
    "ABSOLUTE CONSTRAINTS: DO NOT alter subjects, faces, composition, objects, "
    "backgrounds, or any pixel-level content. DO NOT add, remove, or reposition any "
    "elements. Change ONLY color and tone — every detail of the original scene must remain."
)


def apply_gemini_filter(source_bytes: bytes, prompt: str) -> bytes:
    """Sends the source image + a grading prompt to Gemini and returns the edited bytes.

    Raises ``RuntimeError`` if the model returned no inline image in its response
    (e.g. it refused or returned text).
    """
    settings = get_settings()
    client = genai.Client(api_key=settings.gemini_api_key)

    mime_type = _detect_mime(source_bytes)
    user_text = (
        f"Color grade this image with a bold, cinematic, fully committed look: {prompt.strip()}. "
        "Push the grade hard — make it stunning and unmistakable. "
        "Do not touch the content, composition, or subjects — only color and tone."
    )

    response = client.models.generate_content(
        model=settings.gemini_image_model,
        contents=[
            types.Content(
                role="user",
                parts=[
                    types.Part.from_bytes(data=source_bytes, mime_type=mime_type),
                    types.Part.from_text(text=user_text),
                ],
            )
        ],
        config=types.GenerateContentConfig(
            system_instruction=_SYSTEM_INSTRUCTION,
            response_modalities=["IMAGE"],
        ),
    )

    for candidate in response.candidates or []:
        for part in candidate.content.parts or []:
            inline = getattr(part, "inline_data", None)
            if inline and inline.data:
                return _normalize_jpeg(inline.data)

    raise RuntimeError("Gemini did not return an image in the response")


def apply_gemini_filter_from_references(
    source_bytes: bytes, references: list[bytes]
) -> tuple[bytes, str]:
    """Reference-image mode — deterministic LAB color transfer (Reinhard).

    We do NOT ask Gemini image-edit to re-grade the source: no matter how
    strongly we word the prompt, it will sometimes reframe the scene, swap
    aspect ratios or blend content from the reference. Instead we match the
    source's color statistics (mean + std per channel in LAB) to the
    reference(s) — classical, well-known color transfer. Every pixel of the
    source's *content* is preserved because we never generate new pixels;
    we only shift each pixel's color.

    Returns (output_bytes, short_description). The description is still
    produced by Gemini text so saved filters remain searchable — but that
    call is best-effort and never touches the image.
    """
    if not references:
        raise ValueError("references must contain at least one image")

    output_bytes = _lab_color_transfer(source_bytes, references)

    try:
        description = describe_reference_styles(references)
    except Exception:
        description = "style copied from reference image"

    return output_bytes, description or "style copied from reference image"


def _lab_color_transfer(source_bytes: bytes, references: list[bytes]) -> bytes:
    """Reinhard color transfer in LAB space, with a soft strength boost.

    Steps:
      1. Load source as RGB float32.
      2. Convert to LAB via PIL (sRGB→LAB, D65-ish; good enough for grading).
      3. Compute mean+std per channel (L,a,b) for source and for the
         concatenation of all reference pixels (references contribute
         equally, which is effectively averaging their distributions).
      4. For each channel: (src - src_mean) * (ref_std / src_std) + ref_mean.
      5. Convert back to RGB, clip, return JPEG bytes.

    We preserve the source's EXIF orientation and dimensions exactly.
    """
    src_img = Image.open(io.BytesIO(source_bytes))
    src_img = _respect_exif_orientation(src_img)
    if src_img.mode != "RGB":
        src_img = src_img.convert("RGB")

    src_lab = _pil_lab_to_signed(src_img.convert("LAB"))  # HxWx3 float32

    # Stack LAB pixels from every reference. Downscale big refs so the stats
    # calc stays fast without changing the distribution meaningfully.
    ref_pixels: list[np.ndarray] = []
    for raw in references:
        r = Image.open(io.BytesIO(raw))
        r = _respect_exif_orientation(r)
        if r.mode != "RGB":
            r = r.convert("RGB")
        r.thumbnail((512, 512), Image.LANCZOS)
        ref_pixels.append(_pil_lab_to_signed(r.convert("LAB")).reshape(-1, 3))
    ref_all = np.concatenate(ref_pixels, axis=0)

    src_flat = src_lab.reshape(-1, 3)
    src_mean = src_flat.mean(axis=0)
    src_std = src_flat.std(axis=0) + 1e-6
    ref_mean = ref_all.mean(axis=0)
    ref_std = ref_all.std(axis=0) + 1e-6

    # Standard Reinhard transfer, per channel.
    out_flat = (src_flat - src_mean) * (ref_std / src_std) + ref_mean

    # Clip to valid PIL-LAB ranges: L ∈ [0,255], a/b ∈ [-128,127].
    out_flat[:, 0] = np.clip(out_flat[:, 0], 0.0, 255.0)
    out_flat[:, 1:] = np.clip(out_flat[:, 1:], -128.0, 127.0)
    out_lab = out_flat.reshape(src_lab.shape)

    out_img = Image.fromarray(_signed_to_pil_lab(out_lab), mode="LAB").convert("RGB")

    buf = io.BytesIO()
    out_img.save(buf, format="JPEG", quality=92, optimize=True)
    return buf.getvalue()


def _pil_lab_to_signed(lab_img: Image.Image) -> np.ndarray:
    """PIL stores LAB as uint8 with a/b wrapped as int8. Convert to float32
    with L ∈ [0,255] and a/b ∈ [-128,127]."""
    arr = np.asarray(lab_img, dtype=np.uint8)
    out = np.empty(arr.shape, dtype=np.float32)
    out[..., 0] = arr[..., 0].astype(np.float32)
    out[..., 1] = arr[..., 1].astype(np.int8).astype(np.float32)
    out[..., 2] = arr[..., 2].astype(np.int8).astype(np.float32)
    return out


def _signed_to_pil_lab(lab: np.ndarray) -> np.ndarray:
    """Inverse of ``_pil_lab_to_signed`` — pack back to uint8 PIL-LAB."""
    out = np.empty(lab.shape, dtype=np.uint8)
    out[..., 0] = np.clip(lab[..., 0], 0, 255).astype(np.uint8)
    # int8 → uint8 reinterpret preserves two's-complement.
    out[..., 1] = np.clip(lab[..., 1], -128, 127).astype(np.int8).view(np.uint8)
    out[..., 2] = np.clip(lab[..., 2], -128, 127).astype(np.int8).view(np.uint8)
    return out


def _respect_exif_orientation(img: Image.Image) -> Image.Image:
    """Apply EXIF orientation so the output matches what users see on their phone."""
    try:
        from PIL import ImageOps

        return ImageOps.exif_transpose(img)
    except Exception:
        return img


def apply_gemini_filter_from_reference(
    source_bytes: bytes, reference_bytes: bytes
) -> bytes:
    """Back-compat shim for single-reference callers."""
    output, _ = apply_gemini_filter_from_references(source_bytes, [reference_bytes])
    return output


def describe_reference_style(reference_bytes: bytes) -> str:
    """Back-compat shim for single-reference callers."""
    return describe_reference_styles([reference_bytes])


def describe_reference_styles(references: list[bytes]) -> str:
    """Ask Gemini for one short description summarising the reference(s)."""
    if not references:
        return "style copied from reference image"

    settings = get_settings()
    client = genai.Client(api_key=settings.gemini_api_key)

    if len(references) == 1:
        instruction = (
            "Look at this image purely as a color grade, not as content. In ONE "
            "short phrase (max ~15 words), describe the look: palette, tone, "
            "temperature, contrast, grain. Examples: 'warm vintage film with "
            "teal shadows and heavy grain', 'cool bleach-bypass, crushed "
            "blacks, desaturated skin tones'. Return only the phrase."
        )
    else:
        instruction = (
            f"Look at these {len(references)} images purely as color references, "
            "not as content. In ONE short phrase (max ~15 words), describe the "
            "BLENDED look that combines their grades: palette, tone, contrast, "
            "temperature, grain. Return only the phrase, no quotes or prefix."
        )

    parts: list[Any] = []
    for ref in references:
        parts.append(types.Part.from_bytes(data=ref, mime_type=_detect_mime(ref)))
    parts.append(types.Part.from_text(text=instruction))

    response = client.models.generate_content(
        model=settings.gemini_text_model,
        contents=[types.Content(role="user", parts=parts)],
    )
    text = (response.text or "").strip().strip('"').strip("'")
    return text or "style copied from reference images"


def _detect_mime(data: bytes) -> str:
    try:
        img = Image.open(io.BytesIO(data))
        fmt = (img.format or "").lower()
        if fmt in ("jpeg", "jpg"):
            return "image/jpeg"
        if fmt == "png":
            return "image/png"
        if fmt == "webp":
            return "image/webp"
    except Exception:
        pass
    return "image/jpeg"


def _normalize_jpeg(data: bytes) -> bytes:
    """Re-encode whatever the model returned as JPEG for consistent storage."""
    img = Image.open(io.BytesIO(data))
    if img.mode != "RGB":
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92, optimize=True)
    return buf.getvalue()

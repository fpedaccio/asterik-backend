"""Engine A — direct image edit via Gemini."""
from __future__ import annotations

import io
from typing import Any

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


_REFERENCE_INSTRUCTION = (
    "You are an expert colorist. You will receive TWO images: the SOURCE (first) "
    "and a REFERENCE (second). Your job is to re-grade the source so its color, "
    "tone, contrast, saturation, temperature, shadow/highlight character, and "
    "film grain match the look of the reference as closely as possible. "
    "ABSOLUTE CONSTRAINTS: DO NOT alter the source's subjects, faces, "
    "composition, objects, or any pixel-level content. DO NOT copy content "
    "from the reference — only its color grade. Return the source image with "
    "the reference's color grade applied."
)


def apply_gemini_filter_from_reference(
    source_bytes: bytes, reference_bytes: bytes
) -> bytes:
    """Back-compat shim — delegates to the multi-reference implementation."""
    return apply_gemini_filter_from_references(source_bytes, [reference_bytes])


def apply_gemini_filter_from_references(
    source_bytes: bytes, references: list[bytes]
) -> bytes:
    """Engine A, reference-image mode: match the combined grade of N references.

    The model receives: source first, then each reference in order, then a
    textual instruction describing how to combine them (when N > 1, it's told
    to blend the looks, weighting each equally).
    """
    if not references:
        raise ValueError("references must contain at least one image")

    settings = get_settings()
    client = genai.Client(api_key=settings.gemini_api_key)

    parts: list[Any] = [
        types.Part.from_bytes(data=source_bytes, mime_type=_detect_mime(source_bytes))
    ]
    for ref in references:
        parts.append(
            types.Part.from_bytes(data=ref, mime_type=_detect_mime(ref))
        )

    if len(references) == 1:
        user_text = (
            "Re-grade the SOURCE image (first) to match the color, tone, "
            "contrast, saturation, temperature, and grain of the REFERENCE "
            "image (second). Only color and tone — preserve the source's "
            "subjects and composition entirely."
        )
    else:
        user_text = (
            f"Re-grade the SOURCE image (first) to match a BLENDED color grade "
            f"derived from the {len(references)} REFERENCE images that follow. "
            "Weight the references equally. Only color and tone — preserve the "
            "source's subjects and composition entirely."
        )

    parts.append(types.Part.from_text(text=user_text))

    response = client.models.generate_content(
        model=settings.gemini_image_model,
        contents=[types.Content(role="user", parts=parts)],
        config=types.GenerateContentConfig(
            system_instruction=_REFERENCE_INSTRUCTION,
            response_modalities=["IMAGE"],
        ),
    )

    for candidate in response.candidates or []:
        for part in candidate.content.parts or []:
            inline = getattr(part, "inline_data", None)
            if inline and inline.data:
                return _normalize_jpeg(inline.data)

    raise RuntimeError("Gemini did not return an image in the response")


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

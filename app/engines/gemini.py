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


_REFERENCE_SYSTEM_INSTRUCTION = (
    "You are a precision colorist. When given a SOURCE photo and one or more "
    "STYLE REFERENCE images, your only job is to re-grade the SOURCE so its "
    "color characteristics match the reference(s), while preserving every "
    "pixel-level detail of its content. "
    "ABSOLUTE CONSTRAINTS: the output must show the SAME subjects, faces, "
    "hair, eyes, expressions, clothing, objects, background elements, "
    "composition, framing, body posture and scene geometry as the SOURCE. "
    "Do NOT copy subjects, lighting direction, poses, or scene content from "
    "the reference(s) — they are for color information ONLY (palette, tone, "
    "contrast, saturation, white balance, split-tone, grain). The output is "
    "the SOURCE with a different color grade. Nothing else."
)


def apply_gemini_filter_from_references(
    source_bytes: bytes, references: list[bytes]
) -> tuple[bytes, str]:
    """Engine A, reference-image mode — true multi-image edit.

    The model receives the SOURCE first, labeled, then each STYLE REFERENCE
    labeled inline (text part before each image — much more reliable than
    relying on positional indices), then a final task prompt with explicit
    positive and negative constraints.

    Returns (output_bytes, derived_style_phrase). The derived phrase is what
    goes into the saved filter's prompt_used so it stays searchable. We ask
    a separate text model for that phrase to keep the edit call focused.
    """
    if not references:
        raise ValueError("references must contain at least one image")

    settings = get_settings()
    client = genai.Client(api_key=settings.gemini_api_key)

    parts: list[Any] = [
        types.Part.from_text(
            text=(
                "Below is the SOURCE photo. This is the image you must edit. "
                "Preserve every pixel-level detail of its content."
            )
        ),
        types.Part.from_bytes(data=source_bytes, mime_type=_detect_mime(source_bytes)),
    ]

    if len(references) == 1:
        parts.append(
            types.Part.from_text(
                text=(
                    "Below is the STYLE REFERENCE. Analyse its color grade — "
                    "palette, tone, contrast, saturation, temperature, "
                    "shadow/highlight tints, film grain — but do NOT copy "
                    "any of its content into the output."
                )
            )
        )
        parts.append(
            types.Part.from_bytes(
                data=references[0], mime_type=_detect_mime(references[0])
            )
        )
    else:
        parts.append(
            types.Part.from_text(
                text=(
                    f"The next {len(references)} images are STYLE REFERENCES. "
                    "Their combined color grade — averaged across them — is "
                    "the look you should apply. Do NOT copy any of their "
                    "content into the output."
                )
            )
        )
        for ref in references:
            parts.append(
                types.Part.from_bytes(data=ref, mime_type=_detect_mime(ref))
            )

    parts.append(
        types.Part.from_text(
            text=(
                "TASK: Output a re-graded version of the SOURCE photo. "
                "The output's content must be IDENTICAL to the SOURCE — "
                "same subjects, faces, hair, eyes, mouth, clothing, objects, "
                "background, composition, framing, body posture and geometry. "
                "Only the color grade changes: copy palette, tone, contrast, "
                "saturation, temperature, white balance, shadow tints, "
                "highlight tints and film grain from the STYLE REFERENCE(s). "
                "Push the grade hard so it's striking and unmistakable, but "
                "never alter the SOURCE's pixel-level content. "
                "Do NOT introduce any subject, object, scene element, lighting "
                "direction or pose from the reference(s)."
            )
        )
    )

    response = client.models.generate_content(
        model=settings.gemini_image_model,
        contents=[types.Content(role="user", parts=parts)],
        config=types.GenerateContentConfig(
            system_instruction=_REFERENCE_SYSTEM_INSTRUCTION,
            response_modalities=["IMAGE"],
        ),
    )

    output_bytes: bytes | None = None
    for candidate in response.candidates or []:
        for part in candidate.content.parts or []:
            inline = getattr(part, "inline_data", None)
            if inline and inline.data:
                output_bytes = _normalize_jpeg(inline.data)
                break
        if output_bytes is not None:
            break

    if output_bytes is None:
        raise RuntimeError("Gemini did not return an image in the response")

    # Derive a short style phrase for the stored prompt (so saved filters
    # remain searchable). Best-effort — we still have the rendered image.
    try:
        description = describe_reference_styles(references)
    except Exception:
        description = "style copied from reference image"

    return output_bytes, description or "style copied from reference image"


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

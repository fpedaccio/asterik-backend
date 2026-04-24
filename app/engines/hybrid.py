"""Engine B — Hybrid LUT.

Sends only the user's text prompt to a Gemini text model with structured output,
receives a ``LutParams`` spec, and applies it deterministically via ``engines.lut``.
"""
from __future__ import annotations

import json

from google import genai
from google.genai import types

from app.core.config import get_settings
from app.engines.lut import apply_lut
from app.models.schemas import LutParams

_SYSTEM_INSTRUCTION = (
    "You translate natural-language photo-filter descriptions into structured color-grading "
    "parameters. You MUST return JSON that matches the schema exactly. Interpret the user's "
    "prompt as a style (e.g. 'vintage film', 'orange teal', 'fuji 400h') and pick values that "
    "capture that grade. Avoid extreme values unless the prompt explicitly calls for them."
)


def generate_lut_params(prompt: str) -> LutParams:
    settings = get_settings()
    client = genai.Client(api_key=settings.gemini_api_key)

    response = client.models.generate_content(
        model=settings.gemini_text_model,
        contents=[
            types.Content(
                role="user",
                parts=[types.Part.from_text(text=f"Style prompt: {prompt.strip()}")],
            )
        ],
        config=types.GenerateContentConfig(
            system_instruction=_SYSTEM_INSTRUCTION,
            response_mime_type="application/json",
            response_schema=LutParams,
        ),
    )

    # google-genai may populate `.parsed` when a Pydantic schema is given.
    parsed = getattr(response, "parsed", None)
    if isinstance(parsed, LutParams):
        return parsed

    text = (response.text or "").strip()
    if not text:
        raise RuntimeError("Gemini returned empty response for LUT params")
    return LutParams.model_validate(json.loads(text))


def apply_hybrid_filter(source_bytes: bytes, prompt: str) -> tuple[bytes, LutParams]:
    params = generate_lut_params(prompt)
    return apply_lut(source_bytes, params), params


def apply_cached_params(source_bytes: bytes, params: LutParams) -> bytes:
    """Re-applies a previously generated LUT spec (no Gemini call)."""
    return apply_lut(source_bytes, params)


_REFERENCE_SYSTEM_INSTRUCTION = (
    "You analyze a reference image as pure color grade (ignore subjects and "
    "content) and return structured grading parameters that re-create its "
    "look when applied to another photo. You MUST return JSON matching the "
    "schema exactly. Capture palette, contrast, saturation, temperature, "
    "shadow/highlight tints, and grain as you see them."
)


def generate_lut_params_from_reference(reference_bytes: bytes) -> LutParams:
    from app.engines.gemini import _detect_mime  # local import to avoid cycle

    settings = get_settings()
    client = genai.Client(api_key=settings.gemini_api_key)

    mime = _detect_mime(reference_bytes)
    response = client.models.generate_content(
        model=settings.gemini_text_model,
        contents=[
            types.Content(
                role="user",
                parts=[
                    types.Part.from_bytes(data=reference_bytes, mime_type=mime),
                    types.Part.from_text(
                        text=(
                            "Extract the color grade of this image as LutParams. "
                            "Treat it purely as a look reference."
                        )
                    ),
                ],
            )
        ],
        config=types.GenerateContentConfig(
            system_instruction=_REFERENCE_SYSTEM_INSTRUCTION,
            response_mime_type="application/json",
            response_schema=LutParams,
        ),
    )

    parsed = getattr(response, "parsed", None)
    if isinstance(parsed, LutParams):
        return parsed

    text = (response.text or "").strip()
    if not text:
        raise RuntimeError("Gemini returned empty response for reference LUT params")
    return LutParams.model_validate(json.loads(text))


def apply_hybrid_filter_from_reference(
    source_bytes: bytes, reference_bytes: bytes
) -> tuple[bytes, LutParams]:
    params = generate_lut_params_from_reference(reference_bytes)
    return apply_lut(source_bytes, params), params


def _average_lut_params(many: list[LutParams]) -> LutParams:
    """Element-wise mean of scalar fields and the two ColorTint sub-objects."""
    if not many:
        raise ValueError("many must contain at least one LutParams")
    if len(many) == 1:
        return many[0]

    n = len(many)
    from app.models.schemas import ColorTint  # local import to avoid cycle

    def avg(getter):
        return sum(getter(p) for p in many) / n

    avg_highlight = ColorTint(
        r=avg(lambda p: p.highlight_tint.r),
        g=avg(lambda p: p.highlight_tint.g),
        b=avg(lambda p: p.highlight_tint.b),
        mix=avg(lambda p: p.highlight_tint.mix),
    )
    avg_shadow = ColorTint(
        r=avg(lambda p: p.shadow_tint.r),
        g=avg(lambda p: p.shadow_tint.g),
        b=avg(lambda p: p.shadow_tint.b),
        mix=avg(lambda p: p.shadow_tint.mix),
    )
    return LutParams(
        brightness=avg(lambda p: p.brightness),
        contrast=avg(lambda p: p.contrast),
        saturation=avg(lambda p: p.saturation),
        temperature=avg(lambda p: p.temperature),
        tint=avg(lambda p: p.tint),
        highlight_tint=avg_highlight,
        shadow_tint=avg_shadow,
        grain=avg(lambda p: p.grain),
        vignette=avg(lambda p: p.vignette),
    )


def apply_hybrid_filter_from_references(
    source_bytes: bytes, references: list[bytes]
) -> tuple[bytes, LutParams]:
    """Hybrid engine with N references: extract LutParams from each and average."""
    if not references:
        raise ValueError("references must contain at least one image")
    all_params = [generate_lut_params_from_reference(b) for b in references]
    blended = _average_lut_params(all_params)
    return apply_lut(source_bytes, blended), blended

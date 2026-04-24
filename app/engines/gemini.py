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

    output_bytes = _style_transfer(source_bytes, references)

    try:
        description = describe_reference_styles(references)
    except Exception:
        description = "style copied from reference image"

    return output_bytes, description or "style copied from reference image"


# ---------------------------------------------------------------------------
# Deterministic style transfer (4-stage pipeline)
# ---------------------------------------------------------------------------
# Everything below runs on pixels only — no AI generation — so the source's
# content, composition, faces, framing and dimensions are guaranteed identical
# to the input. Stages:
#
#   1. Histogram matching on L        → captures the full tone curve shape
#                                        (crushed blacks, rolled highlights,
#                                        S-curves, bleach bypass, etc.).
#   2. Split-tone Reinhard on a, b    → transfers color stats per luminance
#                                        zone (shadows / mids / highlights)
#                                        with smooth Gaussian blending — this
#                                        is what gives "teal shadows, orange
#                                        highlights" grades their personality.
#   3. Grain transfer                 → measures high-frequency amplitude in
#                                        the ref(s) (MAD-robust so real edges
#                                        don't inflate it) and adds matching
#                                        gaussian noise to L.
#   4. Vignette transfer              → radial brightness profile of ref →
#                                        multiplicative mask on source's L.
#                                        Gated so ref portraits with bright
#                                        subjects don't accidentally darken
#                                        the output's edges.
# ---------------------------------------------------------------------------


def _style_transfer(source_bytes: bytes, references: list[bytes]) -> bytes:
    """4-stage content-preserving style transfer. See module notes."""
    src_img = Image.open(io.BytesIO(source_bytes))
    src_img = _respect_exif_orientation(src_img)
    if src_img.mode != "RGB":
        src_img = src_img.convert("RGB")

    # Load + downscale each reference (keep the RGB too for grain/vignette).
    ref_imgs_rgb: list[Image.Image] = []
    ref_lab_flat: list[np.ndarray] = []
    for raw in references:
        r = Image.open(io.BytesIO(raw))
        r = _respect_exif_orientation(r)
        if r.mode != "RGB":
            r = r.convert("RGB")
        r.thumbnail((512, 512), Image.LANCZOS)
        ref_imgs_rgb.append(r)
        ref_lab_flat.append(_pil_lab_to_signed(r.convert("LAB")).reshape(-1, 3))
    ref_all = np.concatenate(ref_lab_flat, axis=0)

    src_lab = _pil_lab_to_signed(src_img.convert("LAB"))  # HxWx3 float32
    src_flat = src_lab.reshape(-1, 3).copy()

    # --- stage 1: histogram match L ----------------------------------------
    src_flat[:, 0] = _match_histogram(src_flat[:, 0], ref_all[:, 0])

    # --- stage 2: split-tone Reinhard on a, b ------------------------------
    src_flat[:, 1:] = _split_tone_ab(src_flat[:, 0], src_flat[:, 1:], ref_all)

    # Reshape back to image grid before spatial effects.
    out_lab = src_flat.reshape(src_lab.shape)

    # --- stage 3: grain ----------------------------------------------------
    grain_amp = _measure_grain(ref_imgs_rgb)
    if grain_amp > 0.3:  # skip imperceptible grain
        out_lab = _add_grain(out_lab, grain_amp)

    # --- stage 4: vignette -------------------------------------------------
    vig_profile = _measure_vignette(ref_imgs_rgb)
    if vig_profile is not None:
        out_lab = _apply_vignette(out_lab, vig_profile)

    # Clip + pack back to PIL-LAB, convert to RGB JPEG.
    out_lab[..., 0] = np.clip(out_lab[..., 0], 0.0, 255.0)
    out_lab[..., 1:] = np.clip(out_lab[..., 1:], -128.0, 127.0)
    out_img = Image.fromarray(_signed_to_pil_lab(out_lab), mode="LAB").convert("RGB")

    buf = io.BytesIO()
    out_img.save(buf, format="JPEG", quality=92, optimize=True)
    return buf.getvalue()


def _match_histogram(src_channel: np.ndarray, ref_channel: np.ndarray) -> np.ndarray:
    """Remap src so its CDF matches ref's CDF. Both are 1D float arrays
    with values in [0, 255] (works for the L channel). Returns remapped src."""
    # Build histograms at integer resolution — plenty for L.
    bins = np.arange(257, dtype=np.float64)  # edges 0..256
    src_hist, _ = np.histogram(src_channel, bins=bins)
    ref_hist, _ = np.histogram(ref_channel, bins=bins)

    src_cdf = np.cumsum(src_hist).astype(np.float64)
    src_cdf /= max(src_cdf[-1], 1.0)
    ref_cdf = np.cumsum(ref_hist).astype(np.float64)
    ref_cdf /= max(ref_cdf[-1], 1.0)

    # mapping[v] = ref_value whose CDF matches src_cdf[v].
    # np.interp needs the x (ref_cdf) to be increasing — it is, monotone.
    bin_centers = np.arange(256, dtype=np.float64)
    mapping = np.interp(src_cdf, ref_cdf, bin_centers).astype(np.float32)

    src_idx = np.clip(src_channel.astype(np.int32), 0, 255)
    return mapping[src_idx]


def _split_tone_ab(
    src_L: np.ndarray, src_ab: np.ndarray, ref_lab: np.ndarray
) -> np.ndarray:
    """Transfer a, b from ref to src with 3 luminance zones blended with
    gaussian weights. src_L: (N,), src_ab: (N, 2), ref_lab: (M, 3)."""
    zone_centers = np.array([42.0, 127.0, 213.0], dtype=np.float32)
    zone_sigma = 55.0  # overlap between zones — higher = smoother blending

    ref_L = ref_lab[:, 0]
    ref_ab = ref_lab[:, 1:]

    # Precompute per-zone (mean, std) for ref and for src.
    def zone_stats(L: np.ndarray, ab: np.ndarray, center: float) -> tuple[np.ndarray, np.ndarray]:
        w = np.exp(-0.5 * ((L - center) / zone_sigma) ** 2).astype(np.float32)
        w_sum = float(w.sum()) + 1e-6
        mean = (ab * w[:, None]).sum(axis=0) / w_sum
        var = (((ab - mean) ** 2) * w[:, None]).sum(axis=0) / w_sum
        std = np.sqrt(var) + 1e-3
        return mean, std

    out = np.zeros_like(src_ab)
    total_w = np.zeros(src_ab.shape[0], dtype=np.float32)
    for c in zone_centers:
        rm, rs = zone_stats(ref_L, ref_ab, c)
        sm, ss = zone_stats(src_L, src_ab, c)
        # Transfer assuming the source pixel belongs to this zone.
        transferred = (src_ab - sm) * (rs / ss) + rm
        # Weight by source pixel's membership to this zone.
        w = np.exp(-0.5 * ((src_L - c) / zone_sigma) ** 2).astype(np.float32)
        out += transferred * w[:, None]
        total_w += w

    return out / (total_w[:, None] + 1e-6)


def _measure_grain(ref_imgs_rgb: list[Image.Image]) -> float:
    """Robust estimate of high-frequency amplitude averaged across refs.

    Uses a high-pass = img - gaussian_blur(img), then MAD (median absolute
    deviation) so real edges don't dominate the estimate. Returns an
    amplitude in L-channel units (0..255 scale). Capped at 6.0 — enough to
    be visible, not enough to destroy the image.
    """
    from PIL import ImageFilter

    amps: list[float] = []
    for r in ref_imgs_rgb:
        gray = np.asarray(r.convert("L"), dtype=np.float32)
        blurred = np.asarray(
            r.convert("L").filter(ImageFilter.GaussianBlur(radius=1.5)),
            dtype=np.float32,
        )
        high = gray - blurred
        # MAD → std estimator; scaling factor 1.4826 for gaussians.
        mad = float(np.median(np.abs(high - np.median(high))))
        amps.append(1.4826 * mad)
    amp = float(np.mean(amps))
    return min(amp, 6.0)


def _add_grain(lab: np.ndarray, amplitude: float, seed: int = 42) -> np.ndarray:
    """Add deterministic gaussian noise to the L channel."""
    rng = np.random.default_rng(seed)
    noise = rng.normal(0.0, amplitude, size=lab.shape[:2]).astype(np.float32)
    lab[..., 0] = lab[..., 0] + noise
    return lab


def _measure_vignette(ref_imgs_rgb: list[Image.Image]) -> np.ndarray | None:
    """Average radial brightness profile across refs, normalized so center=1.

    Returns a 10-element array [center_bin, ..., corner_bin] or ``None`` if
    the profile isn't a plausible vignette (e.g. bright center subject on a
    dark background — that's content, not a vignette; applying it would
    wreck the source). A "plausible vignette" means corner is darker than
    center by <=25% and the profile is near-monotone.
    """
    profiles: list[np.ndarray] = []
    for r in ref_imgs_rgb:
        gray = np.asarray(r.convert("L"), dtype=np.float32)
        h, w = gray.shape
        cy, cx = h / 2.0, w / 2.0
        yy, xx = np.mgrid[0:h, 0:w]
        r_map = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2)
        r_norm = r_map / float(np.sqrt(cy * cy + cx * cx))

        bin_edges = np.linspace(0.0, 1.0, 11)
        prof = np.empty(10, dtype=np.float32)
        for i in range(10):
            mask = (r_norm >= bin_edges[i]) & (r_norm < bin_edges[i + 1])
            prof[i] = float(gray[mask].mean()) if mask.any() else float(gray.mean())
        if prof[0] <= 1e-3:
            continue
        profiles.append(prof / prof[0])

    if not profiles:
        return None
    avg = np.mean(profiles, axis=0)

    # Gating: reject implausible vignettes.
    corner = float(avg[-1])
    if corner > 1.05:  # edges brighter than center → not a vignette
        return None
    if corner < 0.75:  # would darken edges more than 25% → too aggressive
        avg = np.clip(avg, 0.75, 1.0)

    # Monotonicity check — allow small bumps but reject if corner is brighter
    # than some intermediate bin (content not vignette).
    if float(avg[4:].max()) > float(avg[:4].max()) + 0.03:
        return None

    return avg


def _apply_vignette(lab: np.ndarray, profile: np.ndarray) -> np.ndarray:
    """Multiply L by radial multiplier interpolated from ``profile``."""
    h, w = lab.shape[:2]
    cy, cx = h / 2.0, w / 2.0
    yy, xx = np.mgrid[0:h, 0:w]
    r_map = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2)
    r_norm = (r_map / float(np.sqrt(cy * cy + cx * cx))).astype(np.float32)

    bin_centers = np.linspace(0.05, 0.95, 10)
    mult = np.interp(r_norm, bin_centers, profile).astype(np.float32)
    lab[..., 0] = lab[..., 0] * mult
    return lab


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

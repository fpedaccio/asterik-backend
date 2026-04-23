"""Deterministic color-grading pipeline for Engine B.

Takes a ``LutParams`` spec + source image bytes and returns filtered image bytes.
Pure Pillow + NumPy — no AI, no randomness (except optional grain, which is seeded
per generation for reproducibility).
"""
from __future__ import annotations

import io

import numpy as np
from PIL import Image

from app.models.schemas import ColorTint, LutParams

_JPEG_QUALITY = 92


def apply_lut(source_bytes: bytes, params: LutParams, seed: int = 0) -> bytes:
    img = Image.open(io.BytesIO(source_bytes))
    img = _respect_exif_orientation(img)
    if img.mode != "RGB":
        img = img.convert("RGB")

    arr = np.asarray(img, dtype=np.float32) / 255.0  # HxWx3 in [0,1]

    arr = _apply_brightness(arr, params.brightness)
    arr = _apply_contrast(arr, params.contrast)
    arr = _apply_saturation(arr, params.saturation)
    arr = _apply_temperature_tint(arr, params.temperature, params.tint)
    arr = _apply_split_tone(arr, params.shadow_tint, params.highlight_tint)
    arr = _apply_grain(arr, params.grain, seed=seed)
    arr = _apply_vignette(arr, params.vignette)

    arr = np.clip(arr, 0.0, 1.0)
    out = (arr * 255.0 + 0.5).astype(np.uint8)
    result = Image.fromarray(out, mode="RGB")

    buf = io.BytesIO()
    result.save(buf, format="JPEG", quality=_JPEG_QUALITY, optimize=True)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Individual operations
# ---------------------------------------------------------------------------
def _apply_brightness(arr: np.ndarray, amount: float) -> np.ndarray:
    if amount == 0.0:
        return arr
    return arr + amount * 0.5


def _apply_contrast(arr: np.ndarray, amount: float) -> np.ndarray:
    if amount == 0.0:
        return arr
    # amount in [-1, 1] -> multiplier in roughly [0.5, 2.0] pivoted at mid-gray
    factor = 1.0 + amount
    return (arr - 0.5) * factor + 0.5


def _apply_saturation(arr: np.ndarray, amount: float) -> np.ndarray:
    if amount == 0.0:
        return arr
    # Rec. 709 luma weights
    luma = (arr * np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)).sum(axis=-1, keepdims=True)
    factor = 1.0 + amount
    return luma + (arr - luma) * factor


def _apply_temperature_tint(arr: np.ndarray, temperature: float, tint: float) -> np.ndarray:
    if temperature == 0.0 and tint == 0.0:
        return arr
    # temperature: + warms (more R, less B); tint: + magenta (more R+B, less G)
    r_gain = 1.0 + 0.25 * temperature + 0.10 * tint
    g_gain = 1.0 - 0.20 * tint
    b_gain = 1.0 - 0.25 * temperature + 0.10 * tint
    gains = np.array([r_gain, g_gain, b_gain], dtype=np.float32)
    return arr * gains


def _apply_split_tone(arr: np.ndarray, shadow: ColorTint, highlight: ColorTint) -> np.ndarray:
    if shadow.mix == 0.0 and highlight.mix == 0.0:
        return arr
    luma = (arr * np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)).sum(axis=-1, keepdims=True)
    shadow_w = np.clip(1.0 - luma * 2.0, 0.0, 1.0) * shadow.mix
    highlight_w = np.clip((luma - 0.5) * 2.0, 0.0, 1.0) * highlight.mix
    shadow_rgb = np.array([shadow.r, shadow.g, shadow.b], dtype=np.float32)
    highlight_rgb = np.array([highlight.r, highlight.g, highlight.b], dtype=np.float32)
    out = arr * (1.0 - shadow_w - highlight_w)
    out += shadow_rgb * shadow_w
    out += highlight_rgb * highlight_w
    return out


def _apply_grain(arr: np.ndarray, amount: float, seed: int) -> np.ndarray:
    if amount == 0.0:
        return arr
    rng = np.random.default_rng(seed)
    noise = rng.standard_normal(arr.shape[:2]).astype(np.float32) * (0.05 * amount)
    return arr + noise[..., None]


def _apply_vignette(arr: np.ndarray, amount: float) -> np.ndarray:
    if amount == 0.0:
        return arr
    h, w, _ = arr.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cy, cx = (h - 1) / 2.0, (w - 1) / 2.0
    dist = np.sqrt(((xx - cx) / cx) ** 2 + ((yy - cy) / cy) ** 2)
    mask = np.clip(1.0 - amount * (dist**2), 0.0, 1.0)
    return arr * mask[..., None]


def _respect_exif_orientation(img: Image.Image) -> Image.Image:
    try:
        from PIL import ImageOps

        return ImageOps.exif_transpose(img)
    except Exception:
        return img

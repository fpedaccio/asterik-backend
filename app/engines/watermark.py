"""Asterik watermark — small, unobtrusive signature for outputs.

Rendered at the bottom-right, scaled to image height so it looks consistent on
phones and full resolution exports alike. Used to drive the "Made with
Asterik" distribution loop — always on for free plan, opt-out for Pro.
"""
from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

_WATERMARK_TEXT = "ASTERIK"

# Try a bundled font first, then common Linux system fonts, finally fall back
# to Pillow's default bitmap font. The bundled font is optional — if we ever
# add one under app/assets/fonts/ it gets picked up automatically.
_FONT_CANDIDATES = [
    Path(__file__).resolve().parent.parent / "assets" / "fonts" / "Inter-Bold.ttf",
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    Path("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
    Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),  # macOS dev
]


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in _FONT_CANDIDATES:
        try:
            if path.exists():
                return ImageFont.truetype(str(path), size)
        except (OSError, ValueError):
            continue
    return ImageFont.load_default()


def apply_watermark(img_bytes: bytes) -> bytes:
    """Overlay a small 'ASTERIK' signature on the bottom-right and re-encode as JPEG."""
    base = Image.open(io.BytesIO(img_bytes))
    if base.mode != "RGBA":
        base = base.convert("RGBA")

    width, height = base.size
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Size relative to the shorter edge so aspect ratio doesn't screw us over.
    short_edge = min(width, height)
    font_size = max(14, int(short_edge * 0.028))
    font = _load_font(font_size)

    # Measure.
    try:
        bbox = draw.textbbox((0, 0), _WATERMARK_TEXT, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
    except Exception:
        # load_default fallback: estimate
        text_w, text_h = (font_size * 5, font_size)

    pad = max(10, int(short_edge * 0.022))
    x = width - text_w - pad
    y = height - text_h - pad - int(font_size * 0.2)

    # Soft dark shadow for legibility against bright backgrounds.
    draw.text((x + 1, y + 2), _WATERMARK_TEXT, font=font, fill=(0, 0, 0, 150))
    # Main glyphs — warm off-white, slightly translucent so it feels printed.
    draw.text((x, y), _WATERMARK_TEXT, font=font, fill=(248, 244, 233, 210))

    composed = Image.alpha_composite(base, overlay).convert("RGB")
    buf = io.BytesIO()
    composed.save(buf, format="JPEG", quality=92, optimize=True)
    return buf.getvalue()

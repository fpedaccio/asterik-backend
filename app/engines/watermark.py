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
    """Overlay an 'asterik' pill badge on the bottom-right, re-encode as JPEG."""
    base = Image.open(io.BytesIO(img_bytes))
    if base.mode != "RGBA":
        base = base.convert("RGBA")

    width, height = base.size
    short_edge = min(width, height)

    # Font: generous size so it reads even on small thumbnails.
    font_size = max(20, int(short_edge * 0.048))
    font = _load_font(font_size)

    # Measure text on a scratch canvas.
    scratch = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    try:
        bbox = scratch.textbbox((0, 0), _WATERMARK_TEXT, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
    except Exception:
        text_w, text_h = font_size * len(_WATERMARK_TEXT) // 2, font_size

    h_pad = max(10, int(font_size * 0.55))
    v_pad = max(6,  int(font_size * 0.35))
    pill_w = text_w + h_pad * 2
    pill_h = text_h + v_pad * 2

    h_margin = max(14, int(short_edge * 0.025))

    # Instagram Stories (and similar tall formats) overlay UI chrome at the
    # very bottom (~12 % of height). Push the badge up into the safe zone
    # when the image is portrait-tall so it doesn't get cut off.
    aspect = height / max(width, 1)
    if aspect > 1.4:
        v_margin = max(h_margin, int(height * 0.13))
    else:
        v_margin = h_margin

    pill_x = width  - pill_w - h_margin
    pill_y = height - pill_h - v_margin

    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Dark semi-transparent pill — guarantees legibility on any bg.
    radius = pill_h // 2
    draw.rounded_rectangle(
        [pill_x, pill_y, pill_x + pill_w, pill_y + pill_h],
        radius=radius,
        fill=(0, 0, 0, 165),
    )

    # White text centred in the pill.
    tx = pill_x + h_pad - (bbox[0] if 'bbox' in dir() else 0)
    ty = pill_y + v_pad - (bbox[1] if 'bbox' in dir() else 0)
    draw.text((tx, ty), _WATERMARK_TEXT, font=font, fill=(255, 255, 255, 255))

    composed = Image.alpha_composite(base, overlay).convert("RGB")
    buf = io.BytesIO()
    composed.save(buf, format="JPEG", quality=92, optimize=True)
    return buf.getvalue()

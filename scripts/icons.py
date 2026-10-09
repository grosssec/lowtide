"""Draws the app icons (public/*.png) from the logo: four rising bars, the last one in the accent.

Run: python3 scripts/icons.py   (needs Pillow). Drawn at 4x and scaled down for clean edges.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

PUBLIC = Path(__file__).resolve().parent.parent / "public"
TOP, BOTTOM = (34, 34, 33), (10, 10, 10)  # a quiet vertical gradient, darker at the bottom
BAR, ACCENT = (247, 247, 245), (75, 147, 234)
# The logo's bars on a 32-unit grid: x centre, top y (bottom is 22.5), stroke 2.6.
BARS = [(8, 17), (13.4, 12), (18.7, 15.5), (24, 9.5)]


def icon(size: int, inset: float) -> Image.Image:
    scale = 4
    s = size * scale
    img = Image.new("RGB", (s, s))
    draw = ImageDraw.Draw(img)
    for y in range(s):
        t = y / (s - 1)
        draw.line([(0, y), (s, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)))

    # A soft accent glow behind the tallest bar.
    glow = Image.new("L", (s, s), 0)
    unit = s * (1 - 2 * inset) / 32
    ox = oy = s * inset
    gx, gy = ox + 24 * unit, oy + 13 * unit
    ImageDraw.Draw(glow).ellipse([gx - 9 * unit, gy - 9 * unit, gx + 9 * unit, gy + 9 * unit], fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(5 * unit))
    img = Image.composite(Image.new("RGB", (s, s), ACCENT), img, glow)

    draw = ImageDraw.Draw(img)
    width = 2.6 * unit
    for i, (x, top) in enumerate(BARS):
        cx = ox + x * unit
        draw.rounded_rectangle(
            [cx - width / 2, oy + top * unit - width / 2, cx + width / 2, oy + 22.5 * unit + width / 2],
            radius=width / 2,
            fill=ACCENT if i == len(BARS) - 1 else BAR,
        )
    return img.resize((size, size), Image.LANCZOS)


# Regular icons fill the square (iOS and Android round the corners); maskable keeps the bars in the safe zone.
icon(512, 0.0).save(PUBLIC / "icon-512.png", optimize=True)
icon(192, 0.0).save(PUBLIC / "icon-192.png", optimize=True)
icon(180, 0.0).save(PUBLIC / "apple-touch-icon.png", optimize=True)
icon(512, 0.12).save(PUBLIC / "icon-maskable-512.png", optimize=True)
icon(64, 0.0).save(PUBLIC / "favicon-64.png", optimize=True)
print("icons written")

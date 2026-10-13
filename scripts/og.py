"""Draws the link preview (public/og.png, 1200x630) and GitHub's social preview (docs/social-preview.png, 1280x640)
from the demo screenshots in docs/screenshots (made by scripts/screenshots.ts).

Run: python3 scripts/og.py   (needs Pillow). Drawn at 2x and scaled down for clean edges.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "docs" / "screenshots"
PLANE, INK, INK_2, MUTED, ACCENT = (245, 245, 241), (12, 12, 11), (75, 74, 70), (107, 105, 99), (42, 120, 214)
FONT = "/System/Library/Fonts/SFNS.ttf"


def font(size: int, weight: str) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(FONT, size)
    try:
        f.set_variation_by_name(weight)
    except (OSError, ValueError):
        pass
    return f


def logo(size: int) -> Image.Image:
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s * 8 / 32, fill=INK)
    unit, width = s / 32, 2.6 * s / 32
    for i, (x, top) in enumerate([(8, 17), (13.4, 12), (18.7, 15.5), (24, 9.5)]):
        d.rounded_rectangle([x * unit - width / 2, top * unit - width / 2, x * unit + width / 2, 22.5 * unit + width / 2], radius=width / 2,
                            fill=ACCENT if i == 3 else PLANE)
    return img.resize((size, size), Image.Resampling.LANCZOS)


def phone(path: Path, height: int) -> Image.Image:
    shot = Image.open(path).convert("RGB")
    shot = shot.crop((0, 0, shot.width, int(shot.width * 1.9)))
    shot = shot.resize((int(shot.width * height / shot.height), height), Image.Resampling.LANCZOS)
    radius = int(shot.width * 0.11)
    bezel = int(shot.width * 0.035)
    frame = Image.new("RGBA", (shot.width + 2 * bezel, shot.height + 2 * bezel), (0, 0, 0, 0))
    ImageDraw.Draw(frame).rounded_rectangle([0, 0, frame.width - 1, frame.height - 1], radius=radius + bezel, fill=(22, 22, 21))
    mask = Image.new("L", shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, shot.width - 1, shot.height - 1], radius=radius, fill=255)
    frame.paste(shot, (bezel, bezel), mask)
    return frame


def card(width: int, height: int) -> Image.Image:
    w, h = width * 2, height * 2
    img = Image.new("RGB", (w, h), PLANE)
    glow = Image.new("L", (w, h), 0)
    ImageDraw.Draw(glow).ellipse([w * 0.45, -h * 0.5, w * 1.25, h * 0.9], fill=60)
    img = Image.composite(Image.new("RGB", (w, h), (205, 225, 250)), img, glow.filter(ImageFilter.GaussianBlur(h * 0.18)))

    # Two phones on the right: light in front, dark behind, both bleeding off the bottom edge.
    ph = int(h * 1.02)
    dark, light = phone(SHOTS / "month-phone-dark.png", ph), phone(SHOTS / "month-phone.png", ph)
    for img_phone, x, y in [(dark, int(w * 0.80), int(h * 0.20)), (light, int(w * 0.585), int(h * 0.10))]:
        shadow = Image.new("RGBA", (img_phone.width + 200, img_phone.height + 200), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle([100, 120, img_phone.width + 100, img_phone.height + 100], radius=90, fill=(32, 28, 16, 70))
        shadow = shadow.filter(ImageFilter.GaussianBlur(40))
        img.paste(shadow, (x - 100, y - 100), shadow)
        img.paste(img_phone, (x, y), img_phone)

    d = ImageDraw.Draw(img)
    left = int(w * 0.075)
    mark = logo(int(h * 0.105))
    img.paste(mark, (left, int(h * 0.13)), mark)
    d.text((left + mark.width + int(h * 0.03), int(h * 0.13) + mark.height // 2), "Finance", font=font(int(h * 0.058), "Semibold"), fill=INK, anchor="lm")

    title = font(int(h * 0.115), "Bold")
    y = int(h * 0.36)
    for line in ["Know what's", "safe to spend."]:
        d.text((left, y), line, font=title, fill=INK)
        y += int(h * 0.128)
    body = font(int(h * 0.04), "Regular")
    y += int(h * 0.04)
    for line in ["A personal cash-flow forecast from bank alerts,", "timesheets and a 12-month plan."]:
        d.text((left, y), line, font=body, fill=INK_2)
        y += int(h * 0.058)
    d.text((left, int(h * 0.86)), "React · Cloudflare Workers · D1 · Passkeys", font=font(int(h * 0.032), "Medium"), fill=MUTED)
    return img.resize((width, height), Image.Resampling.LANCZOS)


card(1200, 630).save(ROOT / "public" / "og.png", optimize=True)
card(1280, 640).save(ROOT / "docs" / "social-preview.png", optimize=True)
print("public/og.png, docs/social-preview.png")

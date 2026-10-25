"""Puts a caption bar on pictures and scales them: used by site/shot-redraw.mjs.

    uv run --with pillow python -I scripts/caption-frames.py <folder with f0000.png ... and captions.json> <output width>
"""
import json, pathlib, sys
from PIL import Image, ImageDraw, ImageFont

folder, width = pathlib.Path(sys.argv[1]), int(sys.argv[2])
captions = json.loads((folder / "captions.json").read_text())
FONTS = ["/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/SFNS.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "C:/Windows/Fonts/arialbd.ttf"]
font_path = next((f for f in FONTS if pathlib.Path(f).exists()), None)
for i, text in enumerate(captions):
    path = folder / f"f{i:04d}.png"
    im = Image.open(path).convert("RGB")
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    if text:
        bar_h = round(width * 0.105)
        font = ImageFont.truetype(font_path, round(bar_h * 0.46)) if font_path else ImageFont.load_default()
        overlay = Image.new("RGBA", im.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(overlay)
        d.rectangle([0, im.height - bar_h, im.width, im.height], fill=(18, 14, 36, 225))
        w = d.textlength(text, font=font)
        d.text(((im.width - w) / 2, im.height - bar_h + bar_h * 0.22), text, font=font, fill=(255, 184, 156, 255))
        im = Image.alpha_composite(im.convert("RGBA"), overlay).convert("RGB")
    im.save(folder / f"c{i:04d}.png")
print(len(captions), "pictures")

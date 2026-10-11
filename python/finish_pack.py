"""Turns an AI image tool's edits into frame-pack pictures in which only the face changes.

Image tools redraw the whole picture, so the hair or the outline moves a pixel or two between edits, and
she would twitch whenever the picture swaps. This lines each edit up with the base picture and copies over
only the part meant to change: the face for an emotion, the eyes for a blink, the mouth for a talk picture.
Everything else stays exactly the base's pixels.

    uv run --with pillow --with numpy python python/finish_pack.py DIR [--white] [NAME ...]

DIR holds `neutral.png` (the base, with a transparent background) and, for each picture to make, the tool's
edit as `raw-NAME.png` (NAME as in docs/frame-packs.md: happy, happy-blink, happy-talk2 ...). The edits must be
of the base on a plain white background, in the same framing. Writes NAME.png next to them. A blink or talk
picture is put on top of that emotion's own NAME.png, so make the emotions first (the order given is the order
done). With --white it also writes white-NAME.png (the picture on white), which is what to feed the tool for
that emotion's blinks and mouths.

The face is found from its skin colour, sampled at --cheek (fractions of the picture; the default suits a
head-and-shoulders crop with the head in the middle). If a picture comes out wrong, look at face-mask.png
and adjust --cheek, --seam (where the eyes end and the mouth begins) or --mouth-box.
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

parser = argparse.ArgumentParser()
parser.add_argument("dir")
parser.add_argument("names", nargs="*", help="pictures to make; default: every raw-*.png, emotions first")
parser.add_argument("--white", action="store_true", help="also write white-NAME.png")
parser.add_argument("--cheek", default="0.5,0.427", help="x,y as fractions: a spot of plain skin below the eyes, beside the mouth")
parser.add_argument("--seam", type=float, default=0.422, help="y fraction between the eyes and the mouth")
parser.add_argument("--mouth-box", default="0.417,0.408,0.583,0.518", help="x0,y0,x1,y1 as fractions: a box around the mouth, wide-open included")
args = parser.parse_args()

root = Path(args.dir)
base = Image.open(root / "neutral.png").convert("RGBA")
W, H = base.size
white = Image.new("RGBA", base.size, "white")
white.alpha_composite(base)
base_white = white.convert("RGB")
fx = lambda v: round(v * W)
fy = lambda v: round(v * H)
cheek = [float(v) for v in args.cheek.split(",")]
box = [float(v) for v in args.mouth_box.split(",")]


def face_mask() -> Image.Image:
    """The face: the convex hull of its skin-coloured pixels, grown a little so the eye lines and brows are inside."""
    rgb = np.asarray(base_white, float)
    cx, cy = fx(cheek[0]), fy(cheek[1])
    ref = np.median(rgb[cy - 6 : cy + 6, cx - 16 : cx + 16].reshape(-1, 3), axis=0)
    near = np.abs(rgb - ref).sum(axis=2) < 45
    near[: fy(0.146)] = False
    near[fy(0.508) :] = False
    near[:, : fx(0.267)] = False
    near[:, fx(0.733) :] = False
    ys, xs = np.nonzero(near)
    if len(xs) < 500:
        raise SystemExit("could not find the face's skin: adjust --cheek (x,y as fractions of the picture)")
    pts = sorted(set(zip(xs.tolist()[:: max(1, len(xs) // 20000)], ys.tolist()[:: max(1, len(xs) // 20000)])))

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    def chain(points):
        out = []
        for q in points:
            while len(out) >= 2 and cross(out[-2], out[-1], q) <= 0:
                out.pop()
            out.append(q)
        return out[:-1]

    hull = Image.new("L", base.size, 0)
    ImageDraw.Draw(hull).polygon(chain(pts) + chain(pts[::-1]), fill=255)
    return hull.filter(ImageFilter.MaxFilter(13))


def part(mask: Image.Image, which: str) -> Image.Image:
    if which == "full":
        return mask
    band = Image.new("L", base.size, 0)
    ImageDraw.Draw(band).rectangle(
        (0, 0, W, fy(args.seam)) if which == "eyes" else (fx(box[0]), fy(box[1]), fx(box[2]), fy(box[3])), fill=255
    )
    band = np.asarray(band.filter(ImageFilter.GaussianBlur(4)), float)
    return Image.fromarray((np.asarray(mask, float) * band / 255).astype("uint8"))


def register(raw: Image.Image, mask: Image.Image) -> Image.Image:
    """Resize the edit to the base size, then nudge it (scale, shift) onto the base's outlines outside the face."""
    ref = np.asarray(base_white.convert("L"), float) < 90
    keep = np.asarray(mask.filter(ImageFilter.MaxFilter(15)), float) < 128
    ref &= keep
    best = None
    for s in np.arange(0.985, 1.0151, 0.005):
        w, h = round(W * s), round(H * s)
        canvas = Image.new("RGB", base.size, "white")
        canvas.paste(raw.resize((w, h), Image.LANCZOS), ((W - w) // 2, (H - h) // 2))
        dark = np.asarray(canvas.convert("L"), float) < 90
        for dy in range(-8, 9):
            for dx in range(-8, 9):
                moved = np.roll(np.roll(dark, dy, 0), dx, 1) & keep
                score = (ref & moved).sum() / max(1, np.sqrt(ref.sum() * moved.sum()))
                if not best or score > best[0]:
                    best = (score, s, dx, dy, canvas)
    score, s, dx, dy, canvas = best
    print(f"  aligned: scale {s:.3f}, shift {dx},{dy}, outline match {score:.2f}")
    return Image.fromarray(np.roll(np.roll(np.asarray(canvas), dy, 0), dx, 1))


def finish(name: str, mask: Image.Image) -> None:
    emotion, _, kind = name.partition("-")
    which = "eyes" if kind == "blink" else "mouth" if kind.startswith("talk") else "full"
    own = root / f"{emotion}.png"
    start = base if which == "full" or emotion == "neutral" or not own.exists() else Image.open(own).convert("RGBA")
    aligned = register(Image.open(root / f"raw-{name}.png").convert("RGB"), mask)
    out = start.copy()
    out.paste(aligned.convert("RGBA"), (0, 0), part(mask, which).filter(ImageFilter.GaussianBlur(3)))
    out.putalpha(base.getchannel("A"))
    out.save(root / f"{name}.png")
    if args.white:
        on_white = Image.new("RGBA", base.size, "white")
        on_white.alpha_composite(out)
        on_white.convert("RGB").save(root / f"white-{name}.png")


names = args.names or sorted((p.stem[4:] for p in root.glob("raw-*.png")), key=lambda n: ("-" in n, n))
mask = face_mask()
mask.save(root / "face-mask.png")
for name in names:
    print(name)
    finish(name, mask)

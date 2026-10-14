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
and adjust --cheek, --face-box (where to look for the skin), --seam (where the eyes end and the mouth begins) or --mouth-box.
"""

import argparse
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

parser = argparse.ArgumentParser()
parser.add_argument("dir")
parser.add_argument("names", nargs="*", help="pictures to make; default: every raw-*.png, emotions first")
parser.add_argument("--white", action="store_true", help="also write white-NAME.png")
parser.add_argument("--cheek", default="0.5,0.427", help="x,y as fractions: a spot of plain skin below the eyes, beside the mouth")
parser.add_argument("--seam", type=float, default=0.422, help="y fraction between the eyes and the mouth")
parser.add_argument("--face-box", default="0.267,0.146,0.733,0.508", help="x0,y0,x1,y1 as fractions: where to look for the face's skin; keep neck, shoulders and arms outside it")
parser.add_argument("--mouth-box", default="0.417,0.408,0.583,0.518", help="x0,y0,x1,y1 as fractions: a box around the mouth, wide-open included")
parser.add_argument("--pose-face", default="happy", help="the picture a pose (wave-1, cheer-2 ...) is made from, whose face it keeps")
parser.add_argument("--pose-align", choices=["head", "body"], default="head", help="line a pose edit up on the top of her head (default) or on the outline of her body, which suits an edit whose head is drawn a little differently")
parser.add_argument("--mouth-diff", action="store_true", help="for talk pictures, copy only what differs from the emotion's picture (grown a little), looked for in a wider box: for wide mouths that reach the chin")
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
look = [float(v) for v in args.face_box.split(",")]


def face_mask() -> Image.Image:
    """The face: the convex hull of its skin-coloured pixels, grown a little so the eye lines and brows are inside."""
    rgb = np.asarray(base_white, float)
    cx, cy = fx(cheek[0]), fy(cheek[1])
    ref = np.median(rgb[cy - 6 : cy + 6, cx - 16 : cx + 16].reshape(-1, 3), axis=0)
    near = np.abs(rgb - ref).sum(axis=2) < 45
    near[: fy(look[1])] = False
    near[fy(look[3]) :] = False
    near[:, : fx(look[0])] = False
    near[:, fx(look[2]) :] = False
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

    def place(img: Image.Image, fill) -> Image.Image:
        w, h = round(W * s), round(H * s)
        moved = Image.new(img.mode, base.size, fill)
        moved.paste(img.resize((w, h), Image.LANCZOS), ((W - w) // 2, (H - h) // 2))
        return Image.fromarray(np.roll(np.roll(np.asarray(moved), dy, 0), dx, 1))

    return Image.fromarray(np.roll(np.roll(np.asarray(canvas), dy, 0), dx, 1)), place


POSE = re.compile(r"^[a-z]+-\d+$")
POSE_NAMES = {"wave", "cheer"}


def register_pose(raw: Image.Image, ref_white: Image.Image) -> Image.Image:
    """Resize and shift an edit of `ref_white` onto it. A pose edit often comes back with the figure smaller (the tool makes room for the
    arms), so the scale is searched widely, on the top of the head (hair and brow line), which no arm reaches."""
    small = 8
    box = (fx(0.3), fy(0.07), fx(0.7), fy(0.30))
    ref = np.asarray(ref_white.convert("L"), float) < 90
    ref_head = ref[box[1] : box[3], box[0] : box[2]]
    ref_small = np.asarray(Image.fromarray((ref_head * 255).astype("uint8")).resize((ref_head.shape[1] // small, ref_head.shape[0] // small), Image.BOX), float) > 100
    dark = np.asarray(raw.convert("L"), float) < 90
    rw, rh = raw.size
    best = (-1.0, 1.0, 0, 0)
    for s in np.arange(0.94, 1.061, 0.01):
        # raw pixels -> base pixels: the picture is drawn s times as large (about the centre), then shifted
        w, h = round(W * s), round(H * s)
        scaled = np.asarray(Image.fromarray((dark * 255).astype("uint8")).resize((max(1, w // small), max(1, h // small)), Image.BOX), float) > 100
        for dy in range(-30, 31, 2):
            for dx in range(-30, 31, 2):
                # place the scaled picture so its centre is at the base's centre, plus (dx, dy) small pixels
                ox = (W // small - scaled.shape[1]) // 2 + dx
                oy = (H // small - scaled.shape[0]) // 2 + dy
                x0, y0 = box[0] // small, box[1] // small
                tile = np.zeros_like(ref_small)
                sx0, sy0 = x0 - ox, y0 - oy
                if sx0 < 0 or sy0 < 0:
                    continue
                part_ = scaled[sy0 : sy0 + ref_small.shape[0], sx0 : sx0 + ref_small.shape[1]]
                tile[: part_.shape[0], : part_.shape[1]] = part_
                score = (tile & ref_small).sum() / max(1, (tile | ref_small).sum())
                if score > best[0]:
                    best = (score, s, dx, dy)
    score, s, dx, dy = best
    # refine at full size around the coarse answer
    best_full = (-1.0, s, dx * small, dy * small)
    ref_full = ref[box[1] : box[3], box[0] : box[2]]
    for ds in np.arange(-0.01, 0.0101, 0.0025):
        s2 = s + ds
        w, h = round(W * s2), round(H * s2)
        scaled = np.asarray(raw.resize((w, h), Image.LANCZOS).convert("L"), float) < 90
        for ddy in range(-8, 9, 2):
            for ddx in range(-8, 9, 2):
                ox = (W - w) // 2 + dx * small + ddx
                oy = (H - h) // 2 + dy * small + ddy
                sx0, sy0 = box[0] - ox, box[1] - oy
                if sx0 < 0 or sy0 < 0:
                    continue
                part_ = scaled[sy0 : sy0 + ref_full.shape[0], sx0 : sx0 + ref_full.shape[1]]
                if part_.shape != ref_full.shape:
                    continue
                sc = (part_ & ref_full).sum() / max(1, (part_ | ref_full).sum())
                if sc > best_full[0]:
                    best_full = (sc, s2, dx * small + ddx, dy * small + ddy)
    sc, s2, ox_, oy_ = best_full
    print(f"  pose aligned: scale {s2:.3f} (the edit is {s2:.2f}x), shift {ox_},{oy_}, head match {sc:.2f}")
    w, h = round(W * s2), round(H * s2)
    def place(img: Image.Image, fill) -> Image.Image:
        canvas = Image.new(img.mode, base.size, fill)
        canvas.paste(img.resize((w, h), Image.LANCZOS), ((W - w) // 2 + ox_, (H - h) // 2 + oy_))
        return canvas

    return place(raw.convert("RGB"), "white"), place


def finish_pose(name: str, mask: Image.Image) -> None:
    """A pose picture: the emotion's own picture, with only what the edit changed (the arms, and what they uncover) taken from it."""
    face = root / f"{args.pose_face}.png"
    start = Image.open(face).convert("RGBA")
    on_white = Image.new("RGBA", base.size, "white")
    on_white.alpha_composite(start)
    raw = Image.open(root / f"raw-{name}.png")
    cutout = raw.mode == "RGBA" and raw.getchannel("A").getextrema()[0] < 255  # an edit that already has a transparent background
    flat = Image.new("RGBA", raw.size, "white")
    flat.alpha_composite(raw.convert("RGBA"))
    if args.pose_align == "body":
        aligned, place = register(flat.convert("RGB"), mask)
    else:
        aligned, place = register_pose(flat.convert("RGB"), on_white.convert("RGB"))
    a, b = np.asarray(aligned, int), np.asarray(on_white.convert("RGB"), int)
    if cutout:
        # use its own transparency, and its own colours (not the ones flattened on white)
        raw_figure = np.asarray(place(raw.getchannel("A"), 0)) > 128
        aligned = place(raw.convert("RGB"), "white")
    else:
        # the figure in the edit: what is not the white that reaches the picture's edge
        bg = Image.fromarray(((np.abs(a - 255).sum(axis=2) <= 36) * 255).astype("uint8")).copy()  # a copy: one made from an array cannot be drawn on
        for corner in ((0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)):
            if bg.getpixel(corner) == 255:
                ImageDraw.floodfill(bg, corner, 128, thresh=0)
        raw_figure = np.asarray(bg) != 128
    base_figure = np.asarray(start.getchannel("A")) > 128
    # what the edit changed: skin where there was none, or none where there was skin (an arm up, the place it left). Hair and the dress are
    # redrawn a few pixels differently by the tool, so a different silhouette alone is not a change. Thin differences are opened away.
    cx, cy = fx(cheek[0]), fy(cheek[1])
    tone = np.median(b[cy - 6 : cy + 6, cx - 16 : cx + 16].reshape(-1, 3), axis=0)
    skin_raw = (np.abs(a - tone).sum(axis=2) < 60) & raw_figure
    skin_base = (np.abs(b - tone).sum(axis=2) < 60) & base_figure
    moved = Image.fromarray(((skin_raw != skin_base) * 255).astype("uint8")).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))
    colour = Image.fromarray((((np.abs(a - b).sum(axis=2) > 120) & skin_raw & base_figure) * 255).astype("uint8")).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    changed = np.maximum(np.asarray(moved), np.asarray(colour))
    # the tool redraws the face a little differently: never take anything from the face or the top of the head
    changed[: fy(0.30), fx(0.3) : fx(0.7)] = 0
    changed[fy(0.965) :] = 0  # the legs under the hem: no arm reaches them, and the tool draws them a little differently
    changed[np.asarray(mask.filter(ImageFilter.MaxFilter(21))) > 128] = 0
    where = Image.fromarray(changed).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(1.5))
    figure = Image.fromarray((raw_figure * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(0.6))
    out = start.copy()
    # the outer pixels of the edit's figure are the outline mixed with the white of its background: a pale fringe on a dark page. Make them the outline's own colour.
    inner = np.asarray(Image.fromarray((raw_figure * 255).astype("uint8")).filter(ImageFilter.MinFilter(3))) > 128
    rim = raw_figure & ~inner
    solid = np.asarray(aligned, "uint8").copy()
    solid[rim] = np.minimum(solid[rim], (52, 28, 34))
    pasted = Image.fromarray(solid).convert("RGBA")
    out.paste(pasted, (0, 0), where)
    alpha = np.asarray(start.getchannel("A"), float)
    w = np.asarray(where, float) / 255
    alpha = alpha * (1 - w) + np.asarray(figure, float) * w
    out.putalpha(Image.fromarray(alpha.astype("uint8")))
    out.save(root / f"{name}.png")
    if args.white:
        flat = Image.new("RGBA", base.size, "white")
        flat.alpha_composite(out)
        flat.convert("RGB").save(root / f"white-{name}.png")


def finish(name: str, mask: Image.Image) -> None:
    if POSE.match(name) and name.split("-")[0] in POSE_NAMES:
        return finish_pose(name, mask)
    emotion, _, kind = name.partition("-")
    which = "eyes" if kind == "blink" else "mouth" if kind.startswith("talk") else "full"
    own = root / f"{emotion}.png"
    start = base if which == "full" or emotion == "neutral" or not own.exists() else Image.open(own).convert("RGBA")
    aligned = register(Image.open(root / f"raw-{name}.png").convert("RGB"), mask)[0]
    out = start.copy()
    where = part(mask, which)
    if which == "mouth" and args.mouth_diff:
        # Where the edit really differs from the picture it was made from, inside the face and a wider box than the mouth's own.
        wide = Image.new("L", base.size, 0)
        ImageDraw.Draw(wide).rectangle((fx(box[0]) - 12, fy(box[1]) - 24, fx(box[2]) + 12, fy(box[3]) + 24), fill=255)
        a, b = np.asarray(aligned.convert("RGB"), int), np.asarray(start.convert("RGB"), int)
        changed = Image.fromarray(((np.abs(a - b).sum(axis=2) > 60) * 255).astype("uint8")).filter(ImageFilter.MaxFilter(11))
        where = Image.fromarray((np.asarray(changed, float) * np.asarray(wide, float) * np.asarray(mask, float) / 255**2).astype("uint8"))
    out.paste(aligned.convert("RGBA"), (0, 0), where.filter(ImageFilter.GaussianBlur(3)))
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

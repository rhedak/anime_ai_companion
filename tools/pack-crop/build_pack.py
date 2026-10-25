"""Cut a folder of 896x1024 PNGs on white into transparent lossless WebP, with one alpha per base picture.

    python build_pack.py <png folder> <out folder> [--size 940x1070]

A picture that differs from one already cut only inside the face box (a face edit pasted back) takes that picture's alpha
and edge colours, so every face frame of a pose has the same outline. Any other picture (a gesture, a whole-picture edit) is cut on its own.
"""
import argparse, sys
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parent))
from cutout import cutout

FACE = (360, 140, 545, 360)       # generous face box at 896x1024: anything that differs outside it is not a face edit
EYES = [(371, 186, 524, 253)]     # enclosed eye whites are never gaps
SEAM_MAX = 16                     # a change that still differs by more than this at the edge of its area is a seam
REAL_CHANGE = 100                 # a difference above this many levels is a real change, not the noise of a whole-picture edit
SAME_PIXELS = 30                  # a face edit may differ from the base by this many such pixels outside the box


def outside_changes(a, b):
    d = np.abs(a.astype(int) - b.astype(int)).max(axis=2) > REAL_CHANGE
    x0, y0, x1, y1 = FACE
    d[y0:y1, x0:x1] = False
    return int(d.sum())


def seam_score(rgb, base):
    """How hard the edit stops at the edge of the area it changed: the largest difference from the base in a 3 px band
    just inside the bounding box of the changes (above 3). A clean face edit fades to nothing there; a clipped one does not."""
    d = np.abs(rgb.astype(int) - base.astype(int)).max(axis=2)
    ys, xs = np.where(d > 3)
    if len(ys) == 0:
        return 0
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    ring = np.zeros_like(d, dtype=bool)
    ring[y0:y1 + 1, x0:x1 + 1] = True
    ring[y0 + 3:y1 - 2, x0 + 3:x1 - 2] = False
    return int(d[ring].max())


def to_rgba(rgb, alpha, fg):
    rgba = np.dstack([np.clip(fg, 0, 255).astype(np.uint8), np.round(alpha * 255).astype(np.uint8)])
    return Image.fromarray(rgba, "RGBA")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("dst")
    ap.add_argument("--size", default="940x1070")
    args = ap.parse_args()
    size = tuple(int(v) for v in args.size.split("x"))
    dst = Path(args.dst); dst.mkdir(parents=True, exist_ok=True)
    cuts = []                       # (rgb, alpha, fg) of every picture cut on its own
    names = sorted(Path(args.src).glob("*.png"), key=lambda p: (p.stem.endswith(("-blink", "-talk1", "-talk2", "-talk3")), p.stem))
    for path in names:
        rgb = np.asarray(Image.open(path).convert("RGB"))
        same = [(outside_changes(rgb, c[0]), c) for c in cuts]
        n, c = min(same, key=lambda t: t[0]) if same else (None, None)
        if c is not None and n <= SAME_PIXELS:
            alpha = c[1]
            # outside the face the picture is the base, exactly: stray differences of a level or two (a whole-picture
            # edit) would otherwise make the archive store the whole picture instead of a small patch of the face
            x0, y0, x1, y1 = FACE
            inside = np.zeros(alpha.shape, bool); inside[y0:y1, x0:x1] = True
            rgb = np.where(inside[..., None], rgb, c[0])
            # the base's saved colours are not exactly its source pixels (the matting moves them a little), so outside the
            # face the variant takes the base's saved colours, not its own source
            fg = np.where((inside & (alpha == 1))[..., None], rgb, c[2])
            seam = seam_score(rgb, c[0])
            how = f"shares an alpha ({n} px outside, seam {seam}{' <-- CHECK' if seam > SEAM_MAX else ''})"
        else:
            alpha, fg, _, _ = cutout(rgb, EYES)
            cuts.append((rgb, alpha, fg))
            how = "own alpha"
        to_rgba(rgb, alpha, fg).resize(size, Image.LANCZOS).save(dst / (path.stem + ".webp"), "WEBP", lossless=True)
        print(f"{path.stem}: {how}", flush=True)


if __name__ == "__main__":
    main()

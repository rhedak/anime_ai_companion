"""Cut the frames of an activity loop shot on a magenta background into transparent WebP.

    python build_loop.py <frames folder> <out folder> --name reading [--scale 1.489] [--offset 102,1]
                         [--canvas 896x1024] [--size 940x1070] [--band 6] [--quality 90]

Each frame is scaled, placed on a magenta canvas (the video is narrower than the picture), cut with closed-form
matting (cutout.py, key="magenta") and written as activity-<name>-N.webp: lossy q90 with alpha, as AGENTS.md asks for long loops.
"""
import argparse, sys
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parent))
from cutout import cutout


def cut_frame(path, scale, offset, canvas, size, band):
    v = Image.open(path).convert("RGB")
    s = v.resize((round(v.width * scale), round(v.height * scale)), Image.LANCZOS)
    c = Image.new("RGB", canvas, (255, 0, 255)); c.paste(s, offset)
    alpha, fg, _, _ = cutout(np.asarray(c), key="magenta", band=band)
    rgba = np.dstack([np.clip(fg, 0, 255).astype(np.uint8), np.round(alpha * 255).astype(np.uint8)])
    return Image.fromarray(rgba, "RGBA").resize(size, Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("frames"); ap.add_argument("out")
    ap.add_argument("--name", required=True)
    ap.add_argument("--scale", type=float, default=1.489)
    ap.add_argument("--offset", default="102,1")
    ap.add_argument("--canvas", default="896x1024")
    ap.add_argument("--size", default="940x1070")
    ap.add_argument("--band", type=int, default=6)
    ap.add_argument("--quality", type=int, default=90)
    a = ap.parse_args()
    off = tuple(int(v) for v in a.offset.split(","))
    canvas = tuple(int(v) for v in a.canvas.split("x")); size = tuple(int(v) for v in a.size.split("x"))
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    frames = sorted(Path(a.frames).glob("f*.png"))
    for i, f in enumerate(frames, start=1):
        # lossless alpha, lossy colour: method 6 keeps the alpha channel exact
        cut_frame(f, a.scale, off, canvas, size, a.band).save(out / f"activity-{a.name}-{i}.webp", "WEBP", quality=a.quality, alpha_quality=100, method=4)
    print("frames", len(frames))


if __name__ == "__main__":
    main()

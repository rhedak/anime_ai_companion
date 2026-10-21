"""Step 1: every raw picture to a clean 940x1070 RGBA frame: interior alpha filled (the cutouts leave dark fabric translucent), swimming frames composed, resized with premultiplied alpha."""
import sys
import numpy as np
from PIL import Image
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))

import os
SRC = os.environ.get("PACK_SRC", "ref/") .rstrip("/") + "/"  # the folder with cutouts/<emotion>.png, poses/<name>.png and swimming/<n>-original.jpg, -cutout.png
OUT = "frames-raw/"
SIZE = (940, 1070)

def shift_or(m, r):
    out = m.copy()
    for _ in range(r):
        o = out.copy(); o[1:] |= out[:-1]; o[:-1] |= out[1:]
        out = o
        o = out.copy(); o[:, 1:] |= out[:, :-1]; o[:, :-1] |= out[:, 1:]
        out = o
    return out

def fill_interior(im, near=6):
    a = np.asarray(im.convert("RGBA")).copy()
    al = a[..., 3]
    transparent = al < 20
    near_t = shift_or(transparent, near)
    fix = (al >= 100) & (al < 255) & ~near_t
    al[fix] = 255
    return Image.fromarray(a, "RGBA"), int(fix.sum())

def to_frame(im):
    pm = im.convert("RGBa").resize(SIZE, Image.LANCZOS).convert("RGBA")
    return pm

def save(name, im):
    im.save(OUT + name + ".png")

if __name__ == "__main__":
    import os
    os.makedirs(OUT, exist_ok=True)
    jobs = []
    for n in ["neutral", "happy", "sad", "angry", "surprised", "shy", "thinking"]:
        jobs.append((n, SRC + f"cutouts/{n}.png"))
    for n in ["wave-1", "wave-2", "cheer-1", "cheer-2"]:
        jobs.append((n, SRC + f"poses/{n}.png"))
    for name, path in jobs:
        im, fixed = fill_interior(Image.open(path))
        save(name, to_frame(im))
        print(name, "filled", fixed)
    from compose_swim import compose
    for n in "1234":
        out = f"swim-compose-{n}.png"
        compose(SRC + f"swimming/{n}-original.jpg", SRC + f"swimming/{n}-cutout.png", out, verbose=False)
        save(f"activity-swimming-{n}", to_frame(Image.open(out)))
        a = np.asarray(Image.open(out).convert("RGBA"))[..., 3][600:900, 560:760]
        print("swimming", n, "torso alpha mean", round(a.mean(), 1))

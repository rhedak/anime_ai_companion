"""Measure how clean the cut-out of a folder of RGBA WebP pictures is.

    python check.py <folder> [--out report.json] [--sheet sheet.png] [--glob '*.webp']

Numbers per picture (all on the picture's own pixels):
  edge_px       pixels with alpha > 0 within 2 px of a fully transparent pixel
  tint_share    share of edge pixels that are white or magenta where the figure beside them is not
                (white_fringe, magenta_fringe give the two parts)
  soft_share    share of edge pixels with partial alpha (0 < a < 255); a hard 0/255 edge is jagged
  specks        opaque islands apart from the largest one (count, area)
  holes         enclosed transparent islands (count, area)
Needs numpy, scipy, Pillow.
"""
import argparse, json, sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi


def measure(path):
    rgba = np.asarray(Image.open(path).convert("RGBA"))
    rgb = rgba[..., :3].astype(float)
    a = rgba[..., 3]
    clear = a == 0
    solid = a == 255
    near_clear = ndi.binary_dilation(clear, iterations=2)
    edge = (a > 0) & near_clear
    interior = ndi.binary_erosion(solid, iterations=3)
    out = {"size": list(a.shape[::-1]), "transparent_share": round(float(clear.mean()), 4)}
    if not interior.any() or not edge.any():
        return {**out, "edge_px": int(edge.sum())}
    _, idx = ndi.distance_transform_edt(~interior, return_indices=True)
    nearest = rgb[idx[0], idx[1]]
    dist = np.linalg.norm(rgb - nearest, axis=2)
    e = dist[edge]
    e_rgb, n_rgb = rgb[edge], nearest[edge]
    white = lambda c: c.min(axis=1) >= 200
    magenta = lambda c: (c[:, 0] > 150) & (c[:, 2] > 150) & (c[:, 1] < 110)
    # a fringe: the edge pixel is white (or magenta) where the figure beside it is not
    # only pixels that show (alpha >= 64): the colour under a nearly clear pixel is never seen
    shows = a[edge] >= 64
    white_fringe = white(e_rgb) & ~white(n_rgb) & shows
    magenta_fringe = magenta(e_rgb) & ~magenta(n_rgb) & shows
    soft = (a > 0) & (a < 255) & near_clear
    # opaque islands and enclosed holes
    lab, n = ndi.label(a > 128)
    sizes = ndi.sum(np.ones_like(a), lab, range(1, n + 1)) if n else []
    specks = sorted(sizes)[:-1] if n > 1 else []
    hl, hn = ndi.label(a <= 128)
    border = set(np.unique(np.concatenate([hl[0], hl[-1], hl[:, 0], hl[:, -1]])))
    hsizes = [int((hl == i).sum()) for i in range(1, hn + 1) if i not in border]
    return {**out, "edge_px": int(edge.sum()),
            "white_fringe": round(float(white_fringe.mean()), 4),
            "magenta_fringe": round(float(magenta_fringe.mean()), 4),
            "tint_share": round(float((white_fringe | magenta_fringe).mean()), 4),
            "tint_mean": round(float(e.mean()), 2),
            "soft_share": round(float(soft.sum() / edge.sum()), 4),
            "specks": [len(specks), int(sum(specks))],
            "holes": [len(hsizes), int(sum(hsizes))]}


def sheet(files, out, crop=None, bgs=((40, 20, 80), (255, 255, 255), (128, 128, 128)), scale=1):
    tiles = []
    for f in files:
        im = Image.open(f).convert("RGBA")
        if crop:
            im = im.crop(crop)
        row = []
        for bg in bgs:
            base = Image.new("RGBA", im.size, bg + (255,))
            row.append(Image.alpha_composite(base, im).convert("RGB"))
        tiles.append(row)
    w, h = tiles[0][0].size
    img = Image.new("RGB", (w * len(bgs), h * len(tiles)))
    for r, row in enumerate(tiles):
        for c, t in enumerate(row):
            img.paste(t, (c * w, r * h))
    if scale != 1:
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    img.save(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--glob", default="*.webp")
    ap.add_argument("--out")
    args = ap.parse_args()
    res = {p.name: measure(p) for p in sorted(Path(args.folder).glob(args.glob))}
    ts = [r["tint_share"] for r in res.values() if "tint_share" in r] or [0.0]
    ss = [r["soft_share"] for r in res.values() if "soft_share" in r]
    summary = {"files": len(res), "tint_share_mean": round(float(np.mean(ts)), 4), "tint_share_max": max(ts),
               "soft_share_mean": round(float(np.mean(ss)), 4),
               "specks_total": sum(r["specks"][0] for r in res.values() if "specks" in r),
               "holes_total": sum(r["holes"][0] for r in res.values() if "holes" in r)}
    print(json.dumps(summary))
    worst = sorted(res.items(), key=lambda kv: -kv[1].get("tint_share", 0))[:5]
    for k, v in worst:
        print(" ", k, v)
    if args.out:
        Path(args.out).write_text(json.dumps({"summary": summary, "pictures": res}, indent=1))

if __name__ == "__main__":
    main()

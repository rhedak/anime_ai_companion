"""Scan pack frames for background remnants: detached specks, faint haze away from the figure, and light/dark fringes on the outline."""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

def label_runs(mask):
    """4-connected components of a boolean mask by runs and union-find. Returns (labels, areas, bboxes)."""
    h, w = mask.shape
    parent = []
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    def union(a, b):
        a, b = find(a), find(b)
        if a != b:
            parent[max(a, b)] = min(a, b)
    runs = []  # (row, start, end, id)
    prev = []
    for y in range(h):
        row = mask[y]
        if not row.any():
            prev = []
            continue
        padded = np.concatenate(([False], row, [False]))
        d = np.diff(padded.astype(np.int8))
        starts = np.nonzero(d == 1)[0]
        ends = np.nonzero(d == -1)[0]  # exclusive
        cur = []
        j = 0
        for s, e in zip(starts, ends):
            rid = len(parent)
            parent.append(rid)
            cur.append((s, e, rid))
            runs.append((y, s, e, rid))
            while j < len(prev) and prev[j][1] <= s:
                j += 1
            k = j
            while k < len(prev) and prev[k][0] < e:
                union(rid, prev[k][2])
                k += 1
        prev = cur
    comp = {}
    for y, s, e, rid in runs:
        r = find(rid)
        c = comp.setdefault(r, [0, w, h, 0, 0])  # area, x0, y0, x1, y1
        c[0] += e - s
        c[1] = min(c[1], s)
        c[2] = min(c[2], y)
        c[3] = max(c[3], e - 1)
        c[4] = max(c[4], y)
    return comp

def shift_any(m, r):
    """Dilation by a square of radius r (rows then columns)."""
    out = m.copy()
    for _ in range(r):
        o = out.copy()
        o[1:] |= out[:-1]; o[:-1] |= out[1:]
        out = o
        o = out.copy()
        o[:, 1:] |= out[:, :-1]; o[:, :-1] |= out[:, 1:]
        out = o
    return out

def scan(path):
    im = np.asarray(Image.open(path).convert("RGBA"))
    rgb = im[..., :3].astype(np.int16)
    a = im[..., 3]
    solid = a > 128
    anyalpha = a > 8
    comp = label_runs(anyalpha)
    areas = sorted(((v[0], k) for k, v in comp.items()), reverse=True)
    main = areas[0][0] if areas else 0
    specks = [(comp[k][0], comp[k][1:]) for ar, k in areas[1:] if ar >= 4]
    # faint haze: some alpha but far (>3 px) from anything solid, and not part of a counted speck's solid core
    near_solid = shift_any(solid, 3)
    haze = (a > 0) & ~near_solid
    # fringe: solid pixels with a (nearly) transparent 4-neighbour
    trans = a < 32
    edge = np.zeros_like(solid)
    edge[1:] |= trans[:-1]; edge[:-1] |= trans[1:]
    edge[:, 1:] |= trans[:, :-1]; edge[:, :-1] |= trans[:, 1:]
    edge &= solid
    n_edge = int(edge.sum())
    e = rgb[edge]
    mn, mx = e.min(axis=1), e.max(axis=1)
    near_white = int((mn > 225).sum())
    near_black = int((mx < 35).sum())
    # semi-transparent ring: alpha strictly between 32 and 128 next to solid (anti-aliasing width)
    return {
        "main": int(main),
        "specks": len(specks),
        "speck_area": int(sum(s[0] for s in specks)),
        "speck_max": max((s[0] for s in specks), default=0),
        "speck_boxes": [[int(s[0]), [int(v) for v in s[1]]] for s in sorted(specks, reverse=True)[:3]],
        "haze_px": int(haze.sum()),
        "edge_px": n_edge,
        "edge_white": near_white / max(n_edge, 1),
        "edge_black": near_black / max(n_edge, 1),
    }

if __name__ == "__main__":
    root = Path(sys.argv[1])
    out = {}
    for pack in sorted(p for p in root.iterdir() if p.is_dir() and p.name != "characters"):
        frames = {}
        for f in sorted(pack.glob("*.webp")):
            frames[f.stem] = scan(f)
        out[pack.name] = frames
        print(pack.name, len(frames), file=sys.stderr)
    json.dump(out, open(sys.argv[2], "w"), default=lambda o: o.item() if hasattr(o, "item") else str(o))

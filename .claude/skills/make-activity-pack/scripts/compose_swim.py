"""Figure from Grok's background removal + translucent water from the original (white to alpha), classified by colour near the waterline."""
import sys
import numpy as np
from PIL import Image

def shift_or_local(m, rad):
    out = m.copy()
    for _ in range(rad):
        o = out.copy(); o[1:] |= out[:-1]; o[:-1] |= out[1:]
        out = o
        o = out.copy(); o[:, 1:] |= out[:, :-1]; o[:, :-1] |= out[:, 1:]
        out = o
    return out

def gauss_local(a, sigma):
    k = int(sigma * 3) * 2 + 1
    x = np.arange(k) - k // 2
    w = np.exp(-(x ** 2) / (2 * sigma ** 2)); w /= w.sum()
    out = np.apply_along_axis(lambda v: np.convolve(np.pad(v, k // 2, mode="edge"), w, mode="valid"), 0, a)
    return np.apply_along_axis(lambda v: np.convolve(np.pad(v, k // 2, mode="edge"), w, mode="valid"), 1, out)

def compose(orig_path, cut_path, out_path, water_row=900, verbose=True, soften_column=False, y_dry_override=None):
    orig = np.asarray(Image.open(orig_path).convert("RGB")).astype(np.float64)
    cut = np.asarray(Image.open(cut_path).convert("RGBA")).astype(np.float64)
    H, W = orig.shape[:2]
    fa = cut[..., 3] / 255.0
    rows = np.arange(H)[:, None]
    r, g, b = cut[..., 0], cut[..., 1], cut[..., 2]
    bright = cut[..., :3].mean(axis=2)
    # what is dry figure: warm skin, the dark green suit, hair-coloured and dark outline pixels stay; pale bluish-white pixels below the waist are water
    water_like = (rows >= water_row) & (b >= r - 6) & (cut[..., :3].min(axis=2) > 140)
    fa2 = np.where(water_like, 0.0, fa)
    # nothing of the figure lower than its lowest dry skin / suit pixel (the cutout can keep the submerged body as an opaque pale column)
    ro, go, bo = orig[..., 0], orig[..., 1], orig[..., 2]
    skin = (ro > bo + 20) & (ro > 140)
    suit = (go > ro + 18) & (go > bo - 12) & (orig.mean(axis=2) < 120)
    dry = (skin | suit) & (fa2 > 0.5) & (rows >= water_row - 200)
    if dry.any():
        y_dry = int(np.nonzero(dry.any(axis=1))[0].max())
        if y_dry_override is not None:
            y_dry = y_dry_override
        fa2 = fa2 * np.clip((y_dry + 14 - rows) / 6.0, 0, 1)
        if verbose: print("lowest dry row", y_dry)
    # keep the main body: the biggest connected blob (drops the stray eye fragments Grok leaves)
    from inventory import label_runs
    comp = label_runs(fa2 > 0.03)
    main = max(comp.items(), key=lambda kv: kv[1][0])
    bx0, by0, bx1, by1 = main[1][1:]
    box = np.zeros((H, W), bool); box[by0:by1 + 1, bx0:bx1 + 1] = True
    fa2 = np.where(box, fa2, 0.0)
    # the dark suit comes out of the cutout partly transparent: fill the figure's deep interior (nothing transparent within 6 px)
    def shift_or(m, rad):
        out = m.copy()
        for _ in range(rad):
            o = out.copy(); o[1:] |= out[:-1]; o[:-1] |= out[1:]
            out = o
            o = out.copy(); o[:, 1:] |= out[:, :-1]; o[:, :-1] |= out[:, 1:]
            out = o
        return out
    near_t = shift_or(fa2 < 0.08, 6)
    fa2 = np.where((fa2 >= 0.39) & (fa2 < 1.0) & ~near_t, 1.0, fa2)
    # the pool: white -> alpha. Dry skin and suit seen in the original are opaque (not water), so a figure edge cut higher than the real waterline leaves no ghost
    mn = orig.min(axis=2) / 255.0
    pa = np.clip((1.0 - mn) * 1.15, 0, 1)
    pa = np.where(skin | suit, 1.0, pa)
    with np.errstate(divide="ignore", invalid="ignore"):
        pc = (orig - (1 - pa)[..., None] * 255.0) / np.maximum(pa, 1e-3)[..., None]
    pc = np.clip(pc, 0, 255)
    if soften_column:
        # the cutout kept her submerged body as a pale column: soften the pool where that column was, so its hard sides do not show
        col = water_like & (fa > 0.5)
        col_n = shift_or_local(col, 14)
        k = 14.0
        n = pa.shape
        soft = np.clip(gauss_local(pa, k), 0, 1)
        feather = gauss_local(col_n.astype(float), 8.0)
        pa = pa * (1 - feather) + soft * feather
    blue = (orig[..., 2] - orig[..., 0]) > 40
    prow = np.nonzero((blue & (fa2 < 0.1)).sum(axis=1) > 20)[0]
    pool_top = int(prow.min()) if len(prow) else int(H * 0.55)
    ramp = np.clip((rows - (pool_top - 20)) / 40.0, 0, 1)
    pa = pa * ramp
    A = fa2 + pa * (1 - fa2)
    with np.errstate(divide="ignore", invalid="ignore"):
        C = (fa2[..., None] * cut[..., :3] + (pa * (1 - fa2))[..., None] * pc) / np.maximum(A, 1e-3)[..., None]
    out = np.dstack([np.clip(C, 0, 255), np.clip(A * 255, 0, 255)]).astype(np.uint8)
    Image.fromarray(out, "RGBA").save(out_path)
    if verbose: print("pool top", pool_top)
    return out_path

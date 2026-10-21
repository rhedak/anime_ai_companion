"""Closed-eye frame from an emotion frame: erase each open eye (iris, sclera, lashes) with the skin around it, draw one closed lid. Everything else stays identical."""
import sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from inventory import label_runs
from face import irises

def gauss(a, sigma):
    k = int(sigma * 3) * 2 + 1
    x = np.arange(k) - k // 2
    w = np.exp(-(x ** 2) / (2 * sigma ** 2)); w /= w.sum()
    out = np.apply_along_axis(lambda v: np.convolve(np.pad(v, k // 2, mode="edge"), w, mode="valid"), 0, a)
    out = np.apply_along_axis(lambda v: np.convolve(np.pad(v, k // 2, mode="edge"), w, mode="valid"), 1, out)
    return out

def skin_fill(arr, mask, box, box_cy):
    """Per column, a vertical blend from the plain skin just above the masked area to the plain skin just below it, so shading and blush carry on through the closed lid."""
    y0, y1, x0, x1 = box
    sub = arr[y0:y1, x0:x1].astype(float)
    m = mask[y0:y1, x0:x1]
    r, g, b = sub[..., 0], sub[..., 1], sub[..., 2]
    skin = (sub[..., 3] > 250) & (r > 175) & (r - b > 8) & (r - b < 95) & (g > 135) & (b > 95) & ~is_hair(sub.astype(np.uint8)) & ~m
    H, W = m.shape
    out = np.zeros((H, W, 3))
    okc = np.zeros(W, bool)
    top_c = np.zeros((W, 3)); bot_c = np.zeros((W, 3)); top_y = np.zeros(W); bot_y = np.zeros(W)
    for x in range(W):
        ys = np.nonzero(m[:, x])[0]
        if len(ys) == 0:
            continue
        t, bt = ys.min(), ys.max()
        up = [y for y in range(max(0, t - 12), t) if skin[y, x]]
        dn = [y for y in range(bt + 1, min(H, bt + 13)) if skin[y, x]]
        if not up and not dn:
            continue
        top_c[x] = sub[up, x, :3].mean(axis=0) if up else sub[dn, x, :3].mean(axis=0)
        bot_c[x] = sub[dn, x, :3].mean(axis=0) if dn else top_c[x]
        top_y[x], bot_y[x] = t, bt
        okc[x] = True
    if not okc.any():
        return out, np.zeros((H, W), bool)
    xs = np.arange(W)
    for arr_, name in ((top_c, "t"), (bot_c, "b")):
        for c in range(3):
            arr_[:, c] = np.interp(xs, xs[okc], arr_[okc, c])
        for c in range(3):
            arr_[:, c] = gauss(arr_[:, c][None, :], 3.0)[0]
    top_y = np.interp(xs, xs[okc], top_y[okc]); bot_y = np.interp(xs, xs[okc], bot_y[okc])
    yy = np.arange(H)[:, None]
    t = np.clip((yy - top_y[None, :]) / np.maximum(bot_y - top_y, 1)[None, :], 0, 1)
    out = top_c[None, :, :] * (1 - t[..., None]) + bot_c[None, :, :] * t[..., None]
    return out, np.ones((H, W), bool)

def is_hair(px):
    r, g, b = px[..., 0].astype(int), px[..., 1].astype(int), px[..., 2].astype(int)
    if __import__("os").environ.get("HAIR") == "dark":
        # black or very dark hair (Franzi): the blonde rule below would call light skin hair
        return (0.3 * r + 0.59 * g + 0.11 * b) < 80
    return (r > 175) & (g > 150) & (b > 105) & (r - b > 25) & (r - b < 90) & ~((r > 235) & (g > 215) & (b > 190))

def skin_color(arr, cx, cy, half_w):
    # plain skin just below the eye
    y0, y1 = cy + 17, cy + 30
    patch = arr[y0:y1, cx - half_w:cx + half_w, :3].reshape(-1, 3).astype(int)
    al = arr[y0:y1, cx - half_w:cx + half_w, 3].reshape(-1)
    skin = patch[(al > 250) & (patch[:, 0] > 215) & (patch[:, 0] - patch[:, 2] > 15) & (patch[:, 0] - patch[:, 2] < 80)]
    return np.median(skin, axis=0) if len(skin) else np.array([250, 215, 195])

def eye_mask(arr, cx, cy, iris_h, rx=40, top_margin=14):
    H, W = arr.shape[:2]
    x0, x1 = cx - rx, cx + rx
    top = cy - int(iris_h / 2 + top_margin)
    y0, y1 = top, cy + 24
    box = arr[y0:y1, x0:x1]
    r, g, b = box[..., 0].astype(int), box[..., 1].astype(int), box[..., 2].astype(int)
    teal = (g > r + 18) & (b > r + 12)
    white = (r > 200) & (g > 200) & (b > 195) & (abs(r - b) < 32)
    dark = (r < 110) & (g < 110) & (b < 120)
    grey = (abs(r - g) < 22) & (abs(g - b) < 28) & (r < 210)
    eyeish = teal | white | dark | grey
    m = teal.copy()
    for _ in range(34):
        n = m.copy(); n[1:] |= m[:-1]; n[:-1] |= m[1:]; n[:, 1:] |= m[:, :-1]; n[:, :-1] |= m[:, 1:]
        n[1:, 1:] |= m[:-1, :-1]; n[:-1, :-1] |= m[1:, 1:]; n[1:, :-1] |= m[:-1, 1:]; n[:-1, 1:] |= m[1:, :-1]
        m = n & eyeish
    hair = is_hair(box)
    m &= ~hair
    # only inside an ellipse around the eye, so a hair outline that runs into the eye tapers instead of being cut square
    yy, xx = np.mgrid[y0:y1, x0:x1]
    ell = ((xx - cx) / float(rx)) ** 2 + ((yy - (cy - 2)) / 25.0) ** 2 <= 1.0
    ell &= yy >= top
    m &= ell
    full = np.zeros((H, W), bool)
    full[y0:y1, x0:x1] = m
    return full

def draw_lid(layer, cx, cy, side, color=(40, 28, 30)):
    S = 4
    h, w = layer.size[1] * S, layer.size[0] * S
    big = Image.new("RGBA", (layer.size[0] * S, layer.size[1] * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    half = 19
    pts = []
    for i in range(-half, half + 1):
        t = i / half
        y = cy + 4 + 5 * (1 - t * t) - 0.6 * t * side  # gentle downward curve
        pts.append(((cx + i) * S, y * S))
    d.line(pts, fill=color + (255,), width=int(2.6 * S), joint="curve")
    # small outer lashes and a wing at the outer end
    ox = cx + side * half
    oy = cy + 4 - 0 * 1
    for k, (dx, dy) in enumerate([(3, -3), (5, -1), (6, 2)]):
        d.line([(ox * S, oy * S), ((ox + side * dx) * S, (oy + dy) * S)], fill=color + (255,), width=int(1.8 * S))
    return big.resize(layer.size, Image.LANCZOS)

def blink_frame(path_in, path_out, rx=40, top_margin=14):
    arr = np.asarray(Image.open(path_in).convert("RGBA")).copy()
    irs = irises(arr)
    irs = sorted([((b[0] + b[2]) // 2, (b[1] + b[3]) // 2, b[3] - b[1] + 1) for _, b in irs])[:2]
    layer = Image.new("RGBA", (arr.shape[1], arr.shape[0]), (0, 0, 0, 0))
    out = arr.copy()
    for k, (cx, cy, ih) in enumerate(irs):
        m = eye_mask(arr, cx, cy, ih, rx, top_margin)
        # grow the mask 1 px so the soft edge of lashes goes too
        n = m.copy(); n[1:] |= m[:-1]; n[:-1] |= m[1:]; n[:, 1:] |= m[:, :-1]; n[:, :-1] |= m[:, 1:]
        sc = skin_color(arr, cx, cy, 16)
        # leftover near-white / pale specks beside the erased eye (parts of the sclera that were not connected)
        yy0, yy1, xx0, xx1 = cy - 30, cy + 24, cx - 40, cx + 40
        sub = arr[yy0:yy1, xx0:xx1]
        pale = (sub[..., :3].min(axis=2) > 222) & (sub[..., 3] > 200) & ~is_hair(sub)
        grow = n[yy0:yy1, xx0:xx1].copy()
        for _ in range(4):
            g2 = grow.copy(); g2[1:] |= grow[:-1]; g2[:-1] |= grow[1:]; g2[:, 1:] |= grow[:, :-1]; g2[:, :-1] |= grow[:, 1:]
            grow = g2
        n[yy0:yy1, xx0:xx1] |= (pale & grow)
        box = (cy - 36, cy + 28, cx - rx - 6, cx + rx + 6)
        fill, ok = skin_fill(arr, n, box, cy + 6)
        y0, y1, x0, x1 = box
        sub_n = n[y0:y1, x0:x1]
        # soft mask edge (1 px) so the patch meets the surrounding pixels without a hard seam
        soft = np.clip(gauss(sub_n.astype(float), 0.9) * 1.6, 0, 1) * (sub_n | (gauss(sub_n.astype(float), 0.9) > 0.15))
        col = np.where(ok[..., None], fill, sc[None, None, :])
        region = out[y0:y1, x0:x1, :3].astype(float)
        out[y0:y1, x0:x1, :3] = (region * (1 - soft[..., None]) + col * soft[..., None]).astype(np.uint8)
        out[y0:y1, x0:x1, 3] = np.maximum(out[y0:y1, x0:x1, 3], (soft * 255).astype(np.uint8))
        side = -1 if k == 0 else 1
        lid = draw_lid(layer, cx, cy, side)
        la = np.asarray(lid)
        a = la[..., 3:4].astype(float) / 255
        out[..., :3] = (out[..., :3] * (1 - a) + la[..., :3] * a).astype(np.uint8)
    Image.fromarray(out, "RGBA").save(path_out)
    return irs

if __name__ == "__main__":
    n = sys.argv[1] if len(sys.argv) > 1 else "neutral"
    irs = blink_frame(f"frames-raw/{n}.png", f"blink-test-{n}.png")
    print(irs)
    a = Image.open(f"frames-raw/{n}.png").convert("RGBA"); b = Image.open(f"blink-test-{n}.png")
    crop = (360, 170, 600, 280)
    tiles = []
    for im in (a, b):
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255)); bg.alpha_composite(im); tiles.append(bg.convert("RGB").crop(crop).resize((960, 440), Image.LANCZOS))
    s = Image.new("RGB", (960, 880)); s.paste(tiles[0], (0, 0)); s.paste(tiles[1], (0, 440)); s.save(f"blink-test-{n}-view.png")

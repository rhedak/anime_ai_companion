"""Open-mouth talking frames: the open mouth of the cheer picture, cut out, scaled to three openings and pasted over each frame's own (erased) mouth."""
import sys, math
import numpy as np
from PIL import Image
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from face import measure
from blink import skin_fill, gauss, is_hair
from inventory import label_runs

def skin_like(arr):
    r, g, b = arr[..., 0].astype(int), arr[..., 1].astype(int), arr[..., 2].astype(int)
    return (arr[..., 3] > 200) & (r > 195) & (r - b > 14) & (r - b < 95) & (g > 150)

def head_geometry(path):
    top, eyes = measure(path)
    (x0, y0, *_), (x1, y1, *_) = eyes[0], eyes[1]
    return ((x0 + x1) / 2, (y0 + y1) / 2, math.degrees(math.atan2(y1 - y0, x1 - x0)), x1 - x0)

def line_pixels(sub):
    """Non-skin pieces plus pale line pixels: anything clearly darker than the skin around it."""
    r, g, b = sub[..., 0].astype(float), sub[..., 1].astype(float), sub[..., 2].astype(float)
    lum = 0.3 * r + 0.59 * g + 0.11 * b
    sk = skin_like(sub)
    w = sk.astype(float)
    base = gauss(lum * w, 6.0) / np.maximum(gauss(w, 6.0), 1e-3)
    import os
    thr = float(os.environ.get("MOUTH_THRESH", "9"))  # a faint smile line (Franzi's) needs 4 or 5
    return (sub[..., 3] > 200) & ((~sk) | (lum < base - thr))

def mouth_center(arr, mx, ey, spacing):
    """The closed or open mouth near its expected place: centre and size of the non-skin pieces in a window under the nose."""
    H, W = arr.shape[:2]
    cx, cy = int(mx), int(ey + 0.68 * spacing)
    x0, x1, y0, y1 = cx - 34, cx + 34, cy - 12, cy + 16
    sub = arr[y0:y1, x0:x1]
    non = line_pixels(sub)
    # drop the chin outline (dark line at the bottom of the window) by keeping the component nearest the expected centre
    comp = label_runs(non)
    best = None
    for k, v in comp.items():
        area, bx0, by0, bx1, by1 = v
        if area < 6:
            continue
        ccx, ccy = (bx0 + bx1) / 2 + x0, (by0 + by1) / 2 + y0
        d = math.hypot(ccx - cx, ccy - cy)
        if best is None or d < best[0]:
            best = (d, (bx0 + x0, by0 + y0, bx1 + x0, by1 + y0))
    if not best:
        return (cx, cy), None
    # a smile line often comes in two pieces with a gap: take every piece whose centre lies close to the best one (not the nose mark above it)
    bx0, by0, bx1, by1 = best[1]
    mcx, mcy = (bx0 + bx1) / 2, (by0 + by1) / 2
    for k, v in comp.items():
        area, ax0, ay0, ax1, ay1 = v
        if area < 6:
            continue
        ccx, ccy = (ax0 + ax1) / 2 + x0, (ay0 + ay1) / 2 + y0
        if abs(ccx - mcx) <= 28 and abs(ccy - mcy) <= 6:
            bx0, by0, bx1, by1 = min(bx0, ax0 + x0), min(by0, ay0 + y0), max(bx1, ax1 + x0), max(by1, ay1 + y0)
    return (cx, cy), (bx0, by0, bx1, by1)

def cheer_patch():
    arr = np.asarray(Image.open("frames-raw/cheer-1.png").convert("RGBA")).copy()
    mx, ey, ang, sp = head_geometry("frames-raw/cheer-1.png")
    (cx, cy), box = mouth_center(arr, mx, ey, sp)
    bx0, by0, bx1, by1 = box
    pad = 3
    crop = arr[by0 - pad:by1 + pad + 1, bx0 - pad:bx1 + pad + 1].copy()
    non = ~skin_like(crop)
    # keep the main connected piece (the mouth), feather its edge a little
    comp = label_runs(non)
    main = max(comp.items(), key=lambda kv: kv[1][0])
    # (label_runs only gives boxes: keep everything non-skin inside the main box)
    mb = main[1]
    keep = np.zeros(non.shape, bool); keep[mb[2]:mb[4] + 1, mb[1]:mb[3] + 1] = True
    m = (non & keep).astype(float)
    a = np.clip(gauss(m, 0.8) * 1.5, 0, 1) * ((m > 0) | (gauss(m, 0.8) > 0.2))
    crop[..., 3] = (a * 255).astype(np.uint8)
    return Image.fromarray(crop, "RGBA"), ang

def erase_mouth(arr, cx, cy, box):
    H, W = arr.shape[:2]
    bx0, by0, bx1, by1 = box
    # erase the mouth pieces (non-skin in the box, grown 2 px) and the soft shadow under a smile line
    m = np.zeros((H, W), bool)
    sub = arr[by0 - 3:by1 + 4, bx0 - 5:bx1 + 6]
    non = line_pixels(sub)
    m[by0 - 3:by1 + 4, bx0 - 5:bx1 + 6] = non
    for _ in range(2):
        n = m.copy(); n[1:] |= m[:-1]; n[:-1] |= m[1:]; n[:, 1:] |= m[:, :-1]; n[:, :-1] |= m[:, 1:]
        m = n
    box2 = (by0 - 14, by1 + 14, bx0 - 16, bx1 + 16)
    fill, ok = skin_fill(arr, m, box2, 10 ** 6)
    y0, y1, x0, x1 = box2
    sub_m = m[y0:y1, x0:x1]
    soft = np.clip(gauss(sub_m.astype(float), 0.9) * 1.6, 0, 1) * (sub_m | (gauss(sub_m.astype(float), 0.9) > 0.15))
    out = arr.copy()
    region = out[y0:y1, x0:x1, :3].astype(float)
    out[y0:y1, x0:x1, :3] = (region * (1 - soft[..., None]) + fill * soft[..., None]).astype(np.uint8)
    return out

def paste(arr, patch, cx, cy, w, h, rot):
    p = patch.rotate(rot, resample=Image.BICUBIC, expand=True)
    # trim empty margins after rotation
    bb = p.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    p = p.crop(bb)
    p = p.convert("RGBa").resize((int(round(w)), int(round(h))), Image.LANCZOS).convert("RGBA")
    pa = np.asarray(p).astype(float)
    ph, pw = pa.shape[:2]
    x0, y0 = int(round(cx - pw / 2)), int(round(cy - ph / 2))
    out = arr.copy()
    region = out[y0:y0 + ph, x0:x0 + pw].astype(float)
    a = pa[..., 3:4] / 255.0
    region[..., :3] = region[..., :3] * (1 - a) + pa[..., :3] * a
    region[..., 3] = np.maximum(region[..., 3], pa[..., 3])
    out[y0:y0 + ph, x0:x0 + pw] = region.astype(np.uint8)
    return out

OPENINGS = [(18, 10), (24, 15), (30, 21)]  # talk1..talk3: width, height in pixels

def talk_frames(src_path, out_prefix, patch, src_angle, scale=1.0, openings=OPENINGS):
    arr = np.asarray(Image.open(src_path).convert("RGBA")).copy()
    mx, ey, ang, sp = head_geometry(src_path)
    (cx, cy), box = mouth_center(arr, mx, ey, sp)
    if box is None:
        box = (cx - 8, cy - 3, cx + 8, cy + 3)
    mcx, mcy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    clean = erase_mouth(arr, cx, cy, box)
    outs = []
    for i, (w, h) in enumerate(openings, 1):
        # centre the opening's top lip where the old mouth line was, so the mouth opens downward
        top = box[1] if (box[3] - box[1]) < 8 else mcy - (box[3] - box[1]) / 2
        frame = paste(clean, patch, mcx, top + h / 2 + 1, w * scale, h * scale, src_angle - ang)
        Image.fromarray(frame, "RGBA").save(f"{out_prefix}{i}.png")
        outs.append(f"{out_prefix}{i}.png")
    return outs, (mcx, mcy, box)

if __name__ == "__main__":
    patch, sang = cheer_patch()
    patch.save("mouth-patch.png"); print("patch", patch.size, "src tilt", round(sang, 1))
    tiles = []
    for n in sys.argv[1:] or ["neutral", "happy", "surprised", "thinking"]:
        outs, info = talk_frames(f"frames-raw/{n}.png", f"mouth-test-{n}-", patch, sang)
        print(n, info)
        row = []
        for p in [f"frames-raw/{n}.png"] + outs:
            im = Image.open(p).convert("RGBA"); bg = Image.new("RGBA", im.size, (255, 255, 255, 255)); bg.alpha_composite(im)
            mx, ey, ang, sp = head_geometry(f"frames-raw/{n}.png")
            row.append(bg.convert("RGB").crop((int(mx - 45), int(ey + 36), int(mx + 45), int(ey + 100))).resize((270, 192), Image.LANCZOS))
        s = Image.new("RGB", (270 * 4, 192)); [s.paste(t, (i * 270, 0)) for i, t in enumerate(row)]; tiles.append(s)
    big = Image.new("RGB", (270 * 4, 192 * len(tiles)))
    for i, t in enumerate(tiles): big.paste(t, (0, i * 192))
    big.save("mouths-test.png")

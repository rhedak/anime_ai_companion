"""Cut a figure off a flat white background with soft alpha (closed-form matting).

    from cutout import cutout
    alpha, fg = cutout(rgb)      # rgb: uint8 HxWx3 on white; alpha float 0..1, fg float 0..255 colours without the white

The rough mask is the near-white region joined to the picture edge, plus enclosed white gaps beside hair or skin
(outside the face box). A thin band around it goes to pymatting as the unknown part; everything else is sure.
"""
import numpy as np
from scipy import ndimage as ndi
from pymatting import estimate_alpha_cf, estimate_foreground_ml

TOL = 6          # distance from white (max channel) that still counts as plain background
PALE = 28         # distance from white that still counts as a gap when it is neutral and enclosed
BAND = 4         # width of the unknown band around the rough mask, in pixels


def rough_background_magenta(rgb):
    """Magenta key: nothing of the figure is magenta, so every magenta-hued region is background, enclosed or not."""
    a = rgb.astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    core = np.sqrt(((a - (255, 0, 255)) ** 2).sum(axis=2)) < 90
    hued = (r > 100) & (b > 90) & (b - g > 35) & (r - g > 35)
    lab, n = ndi.label(hued)
    keep = np.unique(lab[core])
    return np.isin(lab, keep[keep > 0])


def rough_background(rgb, keep_boxes=(), tol=TOL):
    a = rgb.astype(int)
    near = (255 - a).max(axis=2) <= tol
    lab, n = ndi.label(near)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(edge))
    # enclosed pale gaps: between hair strands and fingers (a little greyer than the open background)
    pale = ((255 - a).max(axis=2) <= PALE) & ((a.max(axis=2) - a.min(axis=2)) <= 16)
    lab, n = ndi.label(pale)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg |= np.isin(lab, list(edge))
    red = (a[..., 0] > 120) & (a[..., 0] - a[..., 1] > 60)
    skin = (a[..., 0] > 200) & (a[..., 0] - a[..., 2] > 15) & (a[..., 1] > 150)
    beside = ndi.binary_dilation(red | skin, iterations=3)
    keep = np.zeros_like(near)
    for x0, y0, x1, y1 in keep_boxes:
        keep[y0:y1, x0:x1] = True
    for i in range(1, n + 1):
        if i in edge:
            continue
        comp = lab == i
        if comp.sum() >= 6 and (comp & beside).any() and not (comp & keep).any():
            bg |= comp
    return bg


def cutout(rgb, keep_boxes=(), band=BAND, key="white"):
    bg = rough_background_magenta(rgb) if key == "magenta" else rough_background(rgb, keep_boxes)
    unknown = ndi.binary_dilation(bg, iterations=band) & ~bg
    # pixels that are far from white are surely figure even next to the background
    trimap = np.full(bg.shape, 1.0)
    trimap[bg] = 0.0
    trimap[unknown] = 0.5
    img = rgb.astype(float) / 255
    alpha = estimate_alpha_cf(img, trimap)
    alpha = np.clip(alpha, 0, 1)
    alpha[bg] = 0
    fg = estimate_foreground_ml(img, alpha)
    return alpha, np.clip(fg, 0, 1) * 255, bg, trimap

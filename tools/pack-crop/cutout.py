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


def clear_pale_strands(alpha, fg, keep_boxes=(), hair_gap=45, speck=60):
    """Clear what the matting keeps beside the hair that is not hair: faint pale strands the model drew as thin
    translucent lines, and small light slivers between strands. Real hair edge pixels keep the hair colour after
    the matting, so they stay. Skin, and anything inside keep_boxes (the eyes), is never touched."""
    f = fg.astype(float)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    hair = (r > 100) & (r - g > 60)
    skin = (r > 215) & (g > 165) & (r - b > 15)
    solid = alpha > 0.9
    dist = ndi.distance_transform_edt(~(solid & hair))
    keep = np.zeros(alpha.shape, bool)
    for x0, y0, x1, y1 in keep_boxes:
        keep[y0:y1, x0:x1] = True
    out = alpha.copy()
    paler = (f.mean(axis=2) > 120) & (b - r < 10)       # light and not blue: not the shirt, not the skirt
    faint = paler & (r - g < hair_gap) & (alpha < 0.98) & (alpha > 0) & ~skin & (dist <= 6) & ~keep
    out[faint] = 0
    light = (f.min(axis=2) >= 170) & ((f.max(axis=2) - f.min(axis=2)) <= 40) & (b - r < 10) & (out > 0.15) & ~skin & ~keep
    lab, n = ndi.label(light)
    for i in range(1, n + 1):
        comp = lab == i
        if comp.sum() <= speck and dist[comp].min() <= 5:
            out[comp] = 0
    return out


def snap_edge_colour(alpha, fg, solid_at=0.98):
    """Give every partly transparent pixel the colour of the nearest solid pixel. The matting leaves a faint trace of the
    background in edge colours it cannot separate (pale blue sleeve on white); the colour beside it is what the edge should be."""
    solid = ndi.binary_erosion(alpha >= solid_at, iterations=1)
    _, idx = ndi.distance_transform_edt(~solid, return_indices=True)
    nearest = fg[idx[0], idx[1]]
    edge = (alpha > 0) & (alpha < solid_at)
    out = fg.copy()
    out[edge] = nearest[edge]
    return out


def apply_floor(alpha, floor, body_open=3, protect=2):
    """Clear faint ghost strands: alpha well under half goes to zero and the rest is stretched. Only away from the body:
    the solid parts (found by opening the mask, which drops anything thinner than a few pixels) keep their own soft
    edge, because an anti-aliased edge legitimately has weak pixels and clearing them breaks the outline."""
    body = ndi.binary_opening(alpha > 0.5, structure=np.ones((2 * body_open + 1,) * 2))
    near_body = ndi.binary_dilation(body, iterations=protect)
    cleared = np.clip((alpha - floor * 0.8) / (1 - floor * 0.8), 0, 1)
    cleared = np.where(cleared < 0.12, 0, cleared)
    return np.where(near_body, alpha, cleared)


def cutout(rgb, keep_boxes=(), band=BAND, key="white", strands=False, snap=False, floor=0.3):
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
    fg = np.clip(estimate_foreground_ml(img, alpha), 0, 1) * 255
    if strands:
        alpha = clear_pale_strands(alpha, fg, keep_boxes)
    if snap:
        fg = snap_edge_colour(alpha, fg)
    if floor:
        alpha = apply_floor(alpha, floor)
    return alpha, fg, bg, trimap

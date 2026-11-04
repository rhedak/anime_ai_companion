import { KEYS, pickKey, type KeyName } from "./cutout.ts";
import { bbox, crop, flatten, makeRaster, type Raster } from "./raster.ts";

/**
 * A neutral picture the user uploads (a new character's first picture). It is cut out in code when that can be done safely:
 *  - `alpha`: the picture has real transparency around her; the opaque part is kept.
 *  - `flat`: the border is one colour and the colour touches the edge; the area of that colour that is joined to the border is removed.
 *  - `redraw`: neither; the background has to be drawn over by the model first (a model call, which the user is asked about).
 */
export type UploadRoute = "alpha" | "flat" | "redraw";

export interface PreparedUpload {
  /** Her picture on the key colour (for `alpha` and `flat`), or the whole picture flattened on white (for `redraw`). */
  picture: Raster;
  key: KeyName;
  route: UploadRoute;
}

/** How far a channel may differ from the background colour and still count as background. */
const SIMILAR = 28;
/** Below this alpha a pixel is transparent. */
const ALPHA_EDGE = 128;
/** A border that has more than this share of pixels off the background colour is not a flat background. */
const BORDER_SLACK = 0.02;

const same = (r: Raster, i: number, rgb: readonly [number, number, number]) =>
  Math.abs(r.data[i * 4] - rgb[0]) <= SIMILAR && Math.abs(r.data[i * 4 + 1] - rgb[1]) <= SIMILAR && Math.abs(r.data[i * 4 + 2] - rgb[2]) <= SIMILAR;

/** The picture's own colour behind her: the four corners agree, and nearly all of the border is that colour. Null when it is not flat. */
function borderColour(r: Raster): [number, number, number] | null {
  const at = (x: number, y: number) => y * r.w + x;
  const corners = [at(0, 0), at(r.w - 1, 0), at(0, r.h - 1), at(r.w - 1, r.h - 1)];
  const first: [number, number, number] = [r.data[corners[0] * 4], r.data[corners[0] * 4 + 1], r.data[corners[0] * 4 + 2]];
  if (!corners.every((i) => same(r, i, first))) return null;
  let off = 0;
  let total = 0;
  for (let x = 0; x < r.w; x++) for (const y of [0, r.h - 1]) {
    total++;
    if (!same(r, at(x, y), first)) off++;
  }
  for (let y = 0; y < r.h; y++) for (const x of [0, r.w - 1]) {
    total++;
    if (!same(r, at(x, y), first)) off++;
  }
  return off / total <= BORDER_SLACK ? first : null;
}

/** The pixels of the background: those like `rgb` that are joined to the border through such pixels (so a white dress in the middle stays). */
function backgroundFrom(r: Raster, rgb: readonly [number, number, number]): Uint8Array {
  const back = new Uint8Array(r.w * r.h);
  const queue: number[] = [];
  const push = (i: number) => {
    if (back[i] || !same(r, i, rgb)) return;
    back[i] = 1;
    queue.push(i);
  };
  for (let x = 0; x < r.w; x++) (push(x), push((r.h - 1) * r.w + x));
  for (let y = 0; y < r.h; y++) (push(y * r.w), push(y * r.w + r.w - 1));
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % r.w;
    if (x > 0) push(i - 1);
    if (x < r.w - 1) push(i + 1);
    if (i >= r.w) push(i - r.w);
    if (i < r.w * (r.h - 1)) push(i + r.w);
  }
  return back;
}

/** Cuts her out of an upload, or says the background has to be redrawn. */
export function prepareUpload(raw: Raster): PreparedUpload {
  const n = raw.w * raw.h;
  let transparent = 0;
  for (let i = 0; i < n; i++) if (raw.data[i * 4 + 3] < ALPHA_EDGE) transparent++;
  if (transparent > 0 && transparent < n) {
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = raw.data[i * 4 + 3] >= ALPHA_EDGE ? 1 : 0;
    const box = bbox(mask, raw.w, raw.h);
    if (box) {
      const cut = crop(raw, box[0], box[1], box[2], box[3]);
      const { key } = pickKey(flatten(cut, [255, 255, 255]));
      return { picture: flatten(cut, KEYS[key]), key, route: "alpha" };
    }
  }
  const bg = borderColour(raw);
  if (bg) {
    const back = backgroundFrom(raw, bg);
    const out = makeRaster(raw.w, raw.h);
    const figure = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (back[i]) continue;
      figure[i] = 1;
      out.data.set(raw.data.subarray(i * 4, i * 4 + 4), i * 4);
    }
    const box = bbox(figure, raw.w, raw.h);
    if (box) {
      const cut = crop(out, box[0], box[1], box[2], box[3]);
      const { key } = pickKey(flatten(cut, [255, 255, 255]));
      return { picture: flatten(cut, KEYS[key]), key, route: "flat" };
    }
  }
  const whole = flatten(raw, [255, 255, 255]);
  const { key } = pickKey(whole);
  return { picture: whole, key, route: "redraw" };
}

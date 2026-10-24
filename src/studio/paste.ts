import { makeRaster, type Raster } from "./raster.ts";

/** x0, y0, x1, y1 in pixels (x1 and y1 are the first pixel outside). */
export type Box = [number, number, number, number];

export const scaleBox = (b: Box, sx: number, sy: number): Box => [Math.round(b[0] * sx), Math.round(b[1] * sy), Math.round(b[2] * sx), Math.round(b[3] * sy)];

export const padBox = (b: Box, pad: number, w: number, h: number): Box => [Math.max(0, b[0] - pad), Math.max(0, b[1] - pad), Math.min(w, b[2] + pad), Math.min(h, b[3] + pad)];

/** A mask that is 1 inside the box and fades to 0 outside it over a few sigma (a gaussian blur of the rectangle). */
export function featherMask(w: number, h: number, box: Box, sigma = 6): Float32Array {
  const radius = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)));
  const sum = kernel.reduce((a, b) => a + b, 0);
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  // The rectangle is separable, so the blur is a product of two one-dimensional blurs.
  const line = (n: number, a: number, b: number) => {
    const out = new Float32Array(n);
    for (let p = 0; p < n; p++) {
      let v = 0;
      for (let k = -radius; k <= radius; k++) {
        const q = p + k;
        if (q >= a && q < b) v += kernel[k + radius];
        else if (q < 0 && a <= 0) v += kernel[k + radius]; // the picture's own edge continues the box
        else if (q >= n && b >= n) v += kernel[k + radius];
      }
      out[p] = v;
    }
    return out;
  };
  const mx = line(w, box[0], box[2]);
  const my = line(h, box[1], box[3]);
  const mask = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = mx[x] * my[y];
  return mask;
}

/**
 * The edited picture inside the box (feathered), the base everywhere else. A model changes pixels all over the picture even when asked
 * to change one thing; this keeps what it was asked to change and nothing else, so every frame of an outfit has the same everything-but-face.
 */
export function pasteBack(base: Raster, edited: Raster, box: Box, sigma = 6, keep?: Uint8Array): Raster {
  const out = makeRaster(base.w, base.h);
  const mask = featherMask(base.w, base.h, box, sigma);
  for (let i = 0; i < base.w * base.h; i++) {
    // `keep` is where the base is the plain key colour: a model that repaints the backdrop near her face (a slightly pinker pink) must not
    // leave a rectangle of it, so the backdrop stays the base's.
    const m = keep && keep[i] ? 0 : mask[i];
    for (let c = 0; c < 3; c++) out.data[i * 4 + c] = Math.round(edited.data[i * 4 + c] * m + base.data[i * 4 + c] * (1 - m));
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

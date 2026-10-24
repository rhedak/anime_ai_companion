import sharp, { type Sharp } from "sharp";

/**
 * Pixels the pack studio works on: 8-bit RGBA, row by row. `sharp` reads and writes the files; everything between
 * (masks, morphology, labelling) is here, because the Python version got it from numpy and scipy and the app ships no Python.
 */
export interface Raster {
  w: number;
  h: number;
  /** RGBA, 4 bytes a pixel. */
  data: Uint8ClampedArray;
}

export function makeRaster(w: number, h: number, fill: [number, number, number, number] = [0, 0, 0, 0]): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(fill, i * 4);
  return { w, h, data };
}

export async function decode(input: Buffer | string): Promise<Raster> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

function toSharp(r: Raster): Sharp {
  return sharp(Buffer.from(r.data.buffer, r.data.byteOffset, r.data.length), { raw: { width: r.w, height: r.h, channels: 4 } });
}

export const encodePng = (r: Raster): Promise<Buffer> => toSharp(r).png().toBuffer();

/** Lossless WebP keeps the colour under clear pixels (`exact`), which the pack archive compares; lossy takes a quality and keeps the alpha exact. */
export function encodeWebp(r: Raster, options: { lossless: true } | { quality: number }): Promise<Buffer> {
  if ("lossless" in options) return toSharp(r).webp({ lossless: true, exact: true, effort: 4 }).toBuffer();
  return toSharp(r).webp({ quality: options.quality, alphaQuality: 100, effort: 4 }).toBuffer();
}

/** Scales with the alpha premultiplied (sharp does that for RGBA), so an edge keeps its colour. */
export async function resize(r: Raster, w: number, h: number): Promise<Raster> {
  if (r.w === w && r.h === h) return r;
  const { data, info } = await toSharp(r).resize(w, h, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

/** The picture laid on one flat colour, opaque. */
export function flatten(r: Raster, rgb: readonly [number, number, number]): Raster {
  const out = makeRaster(r.w, r.h, [0, 0, 0, 255]);
  for (let i = 0; i < r.w * r.h; i++) {
    const a = r.data[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) out.data[i * 4 + c] = Math.round(r.data[i * 4 + c] * a + rgb[c] * (1 - a));
  }
  return out;
}

export function crop(r: Raster, x0: number, y0: number, x1: number, y1: number): Raster {
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(r.w, x1);
  y1 = Math.min(r.h, y1);
  const out = makeRaster(Math.max(0, x1 - x0), Math.max(0, y1 - y0));
  for (let y = y0; y < y1; y++) out.data.set(r.data.subarray((y * r.w + x0) * 4, (y * r.w + x1) * 4), (y - y0) * out.w * 4);
  return out;
}

// --- masks: one byte a pixel, 0 or 1 ---

export type Mask = Uint8Array;

/** Grows a mask by `iterations` pixels, each step to the four neighbours (what scipy's default structure does). */
export function dilate(mask: Mask, w: number, h: number, iterations = 1): Mask {
  let cur = mask;
  for (let k = 0; k < iterations; k++) {
    const next = cur.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (cur[i]) continue;
        if ((x > 0 && cur[i - 1]) || (x < w - 1 && cur[i + 1]) || (y > 0 && cur[i - w]) || (y < h - 1 && cur[i + w])) next[i] = 1;
      }
    }
    cur = next;
  }
  return cur;
}

export function erode(mask: Mask, w: number, h: number, iterations = 1): Mask {
  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  // A border pixel next to the picture's edge counts as set outside the picture, like scipy's default border value of 0 for erosion.
  const grown = dilate(inv, w, h, iterations);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = grown[i] ? 0 : mask[i];
  return out;
}

/** Square structuring element of radius `r`, separable (a max or min over a row, then a column). */
function squareFilter(mask: Mask, w: number, h: number, r: number, keepMax: boolean): Mask {
  const pass = (src: Mask, horizontal: boolean): Mask => {
    const out = new Uint8Array(src.length);
    const n = horizontal ? w : h;
    const lines = horizontal ? h : w;
    for (let line = 0; line < lines; line++) {
      for (let p = 0; p < n; p++) {
        let v = keepMax ? 0 : 1;
        for (let q = Math.max(0, p - r); q <= Math.min(n - 1, p + r); q++) {
          const s = horizontal ? src[line * w + q] : src[q * w + line];
          if (keepMax ? s : !s) {
            v = keepMax ? 1 : 0;
            break;
          }
        }
        if (!keepMax && (p - r < 0 || p + r > n - 1)) v = 0; // outside the picture is empty
        if (horizontal) out[line * w + p] = v;
        else out[p * w + line] = v;
      }
    }
    return out;
  };
  return pass(pass(mask, true), false);
}

export const dilateSquare = (m: Mask, w: number, h: number, r: number): Mask => squareFilter(m, w, h, r, true);
export const erodeSquare = (m: Mask, w: number, h: number, r: number): Mask => squareFilter(m, w, h, r, false);
/** Opening: what is left of a mask when everything thinner than 2r+1 pixels is taken away and the rest is grown back. */
export const openSquare = (m: Mask, w: number, h: number, r: number): Mask => dilateSquare(erodeSquare(m, w, h, r), w, h, r);

/** Connected components (four neighbours). Label 0 is the background; labels run 1..count. */
export function label(mask: Mask, w: number, h: number): { labels: Int32Array; count: number } {
  const labels = new Int32Array(mask.length);
  let count = 0;
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    count++;
    labels[start] = count;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop() as number;
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0 && mask[i - 1] && !labels[i - 1]) (labels[i - 1] = count), stack.push(i - 1);
      if (x < w - 1 && mask[i + 1] && !labels[i + 1]) (labels[i + 1] = count), stack.push(i + 1);
      if (y > 0 && mask[i - w] && !labels[i - w]) (labels[i - w] = count), stack.push(i - w);
      if (y < h - 1 && mask[i + w] && !labels[i + w]) (labels[i + w] = count), stack.push(i + w);
    }
  }
  return { labels, count };
}

/** The labels of the components that touch the picture's edge. */
export function borderLabels(labels: Int32Array, w: number, h: number): Set<number> {
  const found = new Set<number>();
  for (let x = 0; x < w; x++) (found.add(labels[x]), found.add(labels[(h - 1) * w + x]));
  for (let y = 0; y < h; y++) (found.add(labels[y * w]), found.add(labels[y * w + w - 1]));
  found.delete(0);
  return found;
}

export function bbox(mask: Mask, w: number, h: number): [number, number, number, number] | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

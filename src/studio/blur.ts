import { readFileSync } from "node:fs";
import type { Raster } from "./raster.ts";

/**
 * The blur check for picture pack pictures: sharpness features and a small multinomial logistic regression trained on pictures the owner labelled
 * (0 fine, 1 somewhat blurry, 2 very blurry). A port of the reference in local_models (`studio/blur.py`): the same features in the same order, and
 * the same weights (`blur-model.json`). A try whose chance of "very blurry" is 0.5 or more is flagged, and a retry is drawn (src/studio/build.ts).
 *
 * One known difference: where the reference takes a random sample of up to 3000 strong edges for the edge width, this takes an evenly spaced one.
 * Pictures with fewer strong edges (every synthetic test picture) match the reference exactly.
 */

const EPS = 1e-6;
const REACH = 12;
const MAX_EDGES = 3000;
/** The index of "very blurry" in the model's levels. */
export const VERY_BLURRY = 2;

interface BlurModel {
  W: number[][];
  b: number[];
  mu: number[];
  sd: number[];
  features: string[];
  levels: string[];
}

const MODEL: BlurModel = JSON.parse(readFileSync(new URL("./blur-model.json", import.meta.url), "utf8"));

/** A grey picture from the RGB of a raster, with the same integer weights PIL uses for its "L" mode (the alpha is not used). */
export function greyOf(r: Raster): Float64Array {
  const out = new Float64Array(r.w * r.h);
  for (let i = 0; i < r.w * r.h; i++) {
    const d = r.data;
    out[i] = (d[i * 4] * 19595 + d[i * 4 + 1] * 38470 + d[i * 4 + 2] * 7471 + 0x8000) >> 16;
  }
  return out;
}

/** numpy's percentile (linear between the two nearest values). */
function percentile(values: Float64Array, p: number): number {
  const sorted = Float64Array.from(values).sort();
  const at = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(at), hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

function median(values: Float64Array): number {
  const sorted = Float64Array.from(values).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Mean filter of radius r, edge pixels repeated (the reference's `_box_blur`). */
function boxBlur(g: Float64Array, h: number, w: number, r: number): Float64Array {
  const k = 2 * r + 1;
  const across = new Float64Array(h * w);
  const out = new Float64Array(h * w);
  const clamp = (v: number, n: number) => Math.min(n - 1, Math.max(0, v));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += g[y * w + clamp(x + d, w)];
      across[y * w + x] = s / k;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += across[clamp(y + d, h) * w + x];
      out[y * w + x] = s / k;
    }
  }
  return out;
}

/** The Laplacian of the picture's inside (one pixel less on each side). */
function laplacian(g: Float64Array, h: number, w: number): Float64Array {
  const out = new Float64Array((h - 2) * (w - 2));
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      out[(y - 1) * (w - 2) + (x - 1)] = g[y * w + x] * 4 - g[(y - 1) * w + x] - g[(y + 1) * w + x] - g[y * w + x - 1] - g[y * w + x + 1];
    }
  }
  return out;
}

const variance = (v: Float64Array) => {
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length;
};

/** The average width of the strong edges (Marziliano-style): blur widens an edge. NaN when there is no usable edge. */
function edgeWidth(g: Float64Array, h: number, w: number): number {
  const mag = new Float64Array(h * w);
  for (let y = 0; y < h; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx = (g[y * w + x + 1] - g[y * w + x - 1]) / 2;
      let gy = 0;
      if (y >= 1 && y < h - 1) gy = (g[(y + 1) * w + x] - g[(y - 1) * w + x]) / 2;
      mag[y * w + x] = Math.hypot(gx, gy);
    }
  }
  const threshold = percentile(mag, 98);
  const edges: number[] = [];
  for (let i = 0; i < mag.length; i++) if (mag[i] > threshold) edges.push(i);
  if (edges.length === 0) return NaN;
  const chosen = edges.length > MAX_EDGES ? Array.from({ length: MAX_EDGES }, (_, k) => edges[Math.floor((k * edges.length) / MAX_EDGES)]) : edges;
  const widths: number[] = [];
  for (const i of chosen) {
    const y = Math.floor(i / w), x = i % w;
    if (x - REACH < 0 || x + REACH >= w || y - REACH < 0 || y + REACH >= h) continue;
    const across = Array.from({ length: 2 * REACH + 1 }, (_, k) => g[y * w + x - REACH + k]);
    const down = Array.from({ length: 2 * REACH + 1 }, (_, k) => g[(y - REACH + k) * w + x]);
    for (const prof of [across, down]) {
      const width = profileWidth(prof);
      if (width !== null) widths.push(width);
    }
  }
  return widths.length ? widths.reduce((a, b) => a + b, 0) / widths.length : NaN;
}

/** One profile's edge width: from the last rise before the centre to the first fall after it, if the step is at least 20 levels. */
function profileWidth(prof: number[]): number | null {
  const c = REACH;
  const d = prof.slice(1).map((v, k) => v - prof[k]);
  let lastLeft = -1;
  for (let i = 0; i <= c - 2; i++) if (d[i] > 0 && d[i + 1] <= 0) lastLeft = i;
  let firstRight = -1;
  for (let j = c; j <= d.length - 2; j++) if (d[j] <= 0 && d[j + 1] > 0) { firstRight = j; break; }
  if (lastLeft < 0 || firstRight < 0) return null;
  const lp = lastLeft + 1, rp = firstRight + 1;
  return Math.abs(prof[rp] - prof[lp]) >= 20 ? rp - lp : null;
}

/** The eight features of one picture (or of its centre), in the reference's order. */
function scopeFeatures(g: Float64Array, h: number, w: number): number[] {
  const lap = laplacian(g, h, w);
  const lapvar = variance(lap) + EPS;
  const b1 = boxBlur(g, h, w, 1), b3 = boxBlur(g, h, w, 3);
  let hf = 0, md = 0;
  for (let i = 0; i < g.length; i++) {
    const fine = g[i] - b1[i], mid = b1[i] - b3[i];
    hf += fine * fine;
    md += mid * mid;
  }
  hf = hf / g.length + EPS;
  md = md / g.length + EPS;
  const noise = median(lap.map((v) => Math.abs(v))) / (Math.sqrt(lapvar) + EPS);
  const mag = new Float64Array((h - 2) * (w - 2));
  for (let y = 0; y < h - 2; y++) {
    for (let x = 0; x < w - 2; x++) {
      const gx = g[y * w + x + 2] + 2 * g[(y + 1) * w + x + 2] + g[(y + 2) * w + x + 2] - (g[y * w + x] + 2 * g[(y + 1) * w + x] + g[(y + 2) * w + x]);
      const gy = g[(y + 2) * w + x] + 2 * g[(y + 2) * w + x + 1] + g[(y + 2) * w + x + 2] - (g[y * w + x] + 2 * g[y * w + x + 1] + g[y * w + x + 2]);
      mag[y * (w - 2) + x] = Math.hypot(gx, gy) + EPS;
    }
  }
  const p99 = percentile(mag, 99), p90 = percentile(mag, 90);
  const share = (test: (v: number) => boolean, of: Float64Array) => of.filter(test).length / of.length;
  const dark = g.filter((v) => v < 90).length / g.length;
  return [
    Math.log(lapvar),
    Math.log(hf / md),
    Math.log(md),
    edgeWidth(g, h, w),
    share((v) => v > p99, mag) / Math.max(share((v) => v > p90, mag), EPS),
    dark,
    Math.log(noise + EPS),
    Math.log(p99 / (p90 + EPS)),
  ];
}

/** The nine features of a grey picture: the whole picture, then the centre's log variance of the Laplacian. NaN (no edges) counts as 0. */
export function blurFeatures(g: Float64Array, h: number, w: number): number[] {
  const whole = scopeFeatures(g, h, w);
  const top = Math.floor(h / 5), left = Math.floor(w / 5), ch = Math.floor((4 * h) / 5) - top, cw = Math.floor((4 * w) / 5) - left;
  const centre = new Float64Array(ch * cw);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) centre[y * cw + x] = g[(top + y) * w + left + x];
  const centreLapvar = scopeFeatures(centre, ch, cw)[0];
  return [...whole, centreLapvar].map((v) => (Number.isNaN(v) ? 0 : v));
}

/** The chance of each level ("fine", "somewhat", "very") for a feature vector. */
export function blurProbabilities(features: number[], model: BlurModel = MODEL): number[] {
  const xs = features.map((v, i) => (v - model.mu[i]) / model.sd[i]);
  const logits = model.b.map((bias, k) => xs.reduce((sum, x, i) => sum + x * model.W[i][k], bias));
  const top = Math.max(...logits);
  const e = logits.map((z) => Math.exp(z - top));
  const total = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / total);
}

/** The chance that a picture is very blurry (0 to 1). */
export function veryBlurryChance(picture: Raster): number {
  return blurProbabilities(blurFeatures(greyOf(picture), picture.h, picture.w))[VERY_BLURRY];
}

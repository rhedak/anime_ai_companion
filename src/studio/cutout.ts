import { dilate, dilateSquare, label, makeRaster, openSquare, type Mask, type Raster } from "./raster.ts";

/**
 * Cuts a figure off a flat background colour and gives the edge a soft alpha.
 *
 * The picture is made on a flat key colour that nothing of the figure has (the studio picks one from the source pack, see `pickKey`). The
 * background is every region of that hue, enclosed ones included (between hair strands, between fingers), so no guessing about white
 * gaps is needed. Along the edge an unknown band of a few pixels remains where the pixel is a blend of figure and key. For each such pixel
 * the solid colours around it are tried as the figure's colour F, and the one that explains the pixel best as `alpha * F + (1 - alpha) * K`
 * wins: that gives alpha, and F is the colour with the background taken out. (The Python tool in tools/pack-crop uses closed-form matting for
 * the same job; this needs no solver and ships in the app. `docs/pack-studio.md` says how the two compare.)
 */

export type KeyName = "magenta" | "green" | "cyan";
export const KEYS: Record<KeyName, readonly [number, number, number]> = { magenta: [255, 0, 255], green: [0, 255, 0], cyan: [0, 255, 255] };

/**
 * Is this pixel the key colour or a shaded version of it? A model's "flat" colour is never exactly the colour asked for, and a shadow near
 * the figure makes it darker, so the test is the hue (red and blue alike and green low, for magenta) and not a distance to one value. A
 * blend with the figure is further from that hue (half dark red hair and half magenta has far more red than blue) and goes to the matting.
 */
export function isKeyLike(key: KeyName, r: number, g: number, b: number): boolean {
  if (key === "magenta") {
    const hi = Math.max(r, b), lo = Math.min(r, b);
    return lo >= 70 && hi - lo <= 0.22 * hi && g <= 0.4 * lo;
  }
  if (key === "green") {
    const hi = Math.max(r, b), lo = Math.min(r, b);
    return g >= 70 && hi <= 0.4 * g && hi - lo <= 0.3 * g;
  }
  const hi = Math.max(g, b), lo = Math.min(g, b);
  return lo >= 70 && hi - lo <= 0.22 * hi && r <= 0.4 * lo;
}

/** How much of a figure's colours each key comes close to (pixels within its radius): the lowest is the safest key. */
export function pickKey(figure: Raster): { key: KeyName; shares: Record<KeyName, number> } {
  const shares: Record<KeyName, number> = { magenta: 0, green: 0, cyan: 0 };
  let seen = 0;
  for (let i = 0; i < figure.w * figure.h; i++) {
    if (figure.data[i * 4 + 3] < 230) continue;
    seen++;
    const r = figure.data[i * 4], g = figure.data[i * 4 + 1], b = figure.data[i * 4 + 2];
    for (const key of Object.keys(KEYS) as KeyName[]) {
      if (isKeyLike(key, r, g, b)) shares[key]++;
    }
  }
  const order = (Object.keys(KEYS) as KeyName[]).sort((a, b) => shares[a] - shares[b]);
  const total = Math.max(1, seen);
  for (const key of order) shares[key] = shares[key] / total;
  return { key: order[0], shares };
}

export interface CutoutOptions {
  key: KeyName;
  /** Unknown band around the background, in pixels. A soft video wants more than a sharp picture. */
  band?: number;
  /** Alpha below about this (before stretching) is cleared away from the solid body: the ghost strands a model draws beside hair. 0 turns it off. */
  floor?: number;
  /**
   * Clean the magenta a picture with props leaves behind (a magenta key only): a pale pink smudge that is a small piece of its own, and the pink that the strings of a
   * racket or a net keep from the background behind them. Off by default: a pink garment would be touched too (see `cleanPink`).
   */
  cleanPink?: boolean;
}

export interface Cutout {
  /** 0 to 1 */
  alpha: Float32Array;
  /** The figure's own colour at each pixel, RGB, background taken out of the edge. */
  fg: Float32Array;
  /** Fully background. */
  background: Mask;
}

/** The part of the picture that is the key colour, wherever it is: the open background and the enclosed gaps (between strands, between fingers) alike. */
export function keyBackground(pic: Raster, key: KeyName): Mask {
  const { w, h, data } = pic;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (isKeyLike(key, data[i * 4], data[i * 4 + 1], data[i * 4 + 2])) out[i] = 1;
  return out;
}

/** The colour the background really has in this picture: the middle of the background pixels, channel by channel. */
export function measureKey(pic: Raster, background: Mask, fallback: readonly [number, number, number]): [number, number, number] {
  const samples: number[][] = [[], [], []];
  for (let i = 0; i < background.length; i += 7) {
    if (!background[i]) continue;
    for (let c = 0; c < 3; c++) samples[c].push(pic.data[i * 4 + c]);
  }
  if (samples[0].length < 50) return [fallback[0], fallback[1], fallback[2]];
  const mid = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1];
  return [mid(samples[0]), mid(samples[1]), mid(samples[2])];
}

export function cutout(pic: Raster, options: CutoutOptions): Cutout {
  const { w, h, data } = pic;
  const n = w * h;
  const band = options.band ?? 4;
  const background = keyBackground(pic, options.key);
  const K = measureKey(pic, background, KEYS[options.key]);
  const grown = dilate(background, w, h, band);
  const alpha = new Float32Array(n);
  const fg = new Float32Array(n * 3);
  const unknown: number[] = [];
  for (let i = 0; i < n; i++) {
    if (background[i]) continue;
    if (grown[i]) unknown.push(i);
    else alpha[i] = 1;
    for (let c = 0; c < 3; c++) fg[i * 3 + c] = data[i * 4 + c];
  }
  // A pixel is a sure figure pixel when it is neither background nor in the band.
  const solid = (i: number) => !background[i] && !grown[i];
  const R = band + 2;
  /** The figure colour near pixel i that explains it best as alpha * F + (1 - alpha) * K; `usable` says which pixels may be F. */
  const explain = (i: number, radius: number, usable: (j: number) => boolean) => {
    const x = i % w;
    const y = (i - x) / w;
    const cr = data[i * 4], cg = data[i * 4 + 1], cb = data[i * 4 + 2];
    let best = Infinity;
    let bestA = 1;
    let bf: [number, number, number] = [cr, cg, cb];
    for (let yy = Math.max(0, y - radius); yy <= Math.min(h - 1, y + radius); yy++) {
      for (let xx = Math.max(0, x - radius); xx <= Math.min(w - 1, x + radius); xx++) {
        const j = yy * w + xx;
        if (!usable(j)) continue;
        const fr = data[j * 4], fgc = data[j * 4 + 1], fb = data[j * 4 + 2];
        const dr = fr - K[0], dg = fgc - K[1], db = fb - K[2];
        const dd = dr * dr + dg * dg + db * db;
        if (dd < 900) continue; // a figure colour that is the key's own cannot tell how much key is in a pixel
        const a = Math.min(1, Math.max(0, ((cr - K[0]) * dr + (cg - K[1]) * dg + (cb - K[2]) * db) / dd));
        const er = cr - (a * fr + (1 - a) * K[0]);
        const eg = cg - (a * fgc + (1 - a) * K[1]);
        const eb = cb - (a * fb + (1 - a) * K[2]);
        // A little pull toward the nearer sample, so two equally good colours do not pick one across a gap.
        const err = er * er + eg * eg + eb * eb + 2 * ((xx - x) ** 2 + (yy - y) ** 2);
        if (err < best) {
          best = err;
          bestA = a;
          bf = [fr, fgc, fb];
        }
      }
    }
    return { best, alpha: bestA, f: bf };
  };
  // A pixel far from the key colour is a pure figure colour (every colour a figure has is at least 200 from a key picked by `pickKey`).
  const pure = (j: number) => !background[j] && Math.hypot(data[j * 4] - K[0], data[j * 4 + 1] - K[1], data[j * 4 + 2] - K[2]) >= 200;
  for (const i of unknown) {
    let found = explain(i, R, solid);
    // A flyaway strand hangs in the air with no solid pixel near: look much further for a pure figure colour (the strand comes out of the hair mass).
    if (found.best === Infinity) found = explain(i, 24, pure);
    let { alpha: a, f } = found;
    if (found.best === Infinity) {
      const away = Math.hypot(data[i * 4] - K[0], data[i * 4 + 1] - K[1], data[i * 4 + 2] - K[2]);
      a = away > 120 ? 1 : 0;
      f = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
    }
    alpha[i] = a;
    // The colour of the figure there is the sample that explained the pixel, not the pixel with the key unmixed from it: where alpha is a
    // little off, unmixing leaves a trace of the key in the colour (a pink edge on dark red hair).
    for (let c = 0; c < 3; c++) fg[i * 3 + c] = f[c];
  }
  if (options.cleanPink && options.key === "magenta") cleanPink(alpha, fg, w, h);
  const floor = options.floor ?? 0.3;
  return { alpha: floor ? applyFloor(alpha, w, h, floor) : alpha, fg, background };
}

/** Red and blue well above green and near each other: the pink of a white thing that lets the magenta show through (not red hair, skin, lips or navy). */
const pinkish = (fg: Float32Array, i: number): boolean => {
  const r = fg[i * 3], g = fg[i * 3 + 1], b = fg[i * 3 + 2];
  return Math.min(r, b) - g > 25 && b >= 0.6 * r && r >= 0.6 * b;
};

/**
 * What the matting leaves of the key colour around props, in place.
 *  - A small piece of its own (under 0.7% of the picture, not the figure) that is mostly pink is dropped: a video model draws a pale pink smudge where a ball is
 *    about to appear, and nothing real is a piece of its own and pink.
 *  - Every pink pixel gets the green it lacks, so the strings of a racket (and the solid pale pink where a racket is seen edge-on) are white or grey.
 * A pink garment is not safe from the second (it would turn paler), which is why `CutoutOptions.cleanPink` is off unless asked for: a figure with pink clothes should
 * not use it (and a key other than magenta would suit her better, see `pickKey`).
 */
export function cleanPink(alpha: Float32Array, fg: Float32Array, w: number, h: number): { dropped: number; despilled: number } {
  const present = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) present[i] = alpha[i] > 0.1 ? 1 : 0;
  const { labels, count } = label(present, w, h);
  const area = new Int32Array(count + 1), pink = new Int32Array(count + 1);
  for (let i = 0; i < w * h; i++) if (labels[i]) (area[labels[i]]++, pinkish(fg, i) && pink[labels[i]]++);
  let biggest = 1;
  for (let k = 1; k <= count; k++) if (area[k] > area[biggest]) biggest = k;
  let dropped = 0;
  for (let k = 1; k <= count; k++) {
    if (k === biggest || area[k] > 0.007 * w * h || pink[k] < 0.5 * area[k]) continue;
    dropped++;
    for (let i = 0; i < w * h; i++) if (labels[i] === k) alpha[i] = 0;
  }
  let despilled = 0;
  for (let i = 0; i < w * h; i++) {
    if (alpha[i] > 0 && pinkish(fg, i)) {
      fg[i * 3 + 1] = Math.min(fg[i * 3], fg[i * 3 + 2]);
      despilled++;
    }
  }
  return { dropped, despilled };
}

/**
 * Clears faint ghost strands: alpha well under half goes to zero and the rest is stretched. Only away from the body: the solid parts
 * (what survives an opening, which drops anything thinner than seven pixels) keep their own soft edge, because an anti-aliased edge
 * has weak pixels on purpose and clearing them breaks the outline.
 */
export function applyFloor(alpha: Float32Array, w: number, h: number, floor: number): Float32Array {
  const half = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) half[i] = alpha[i] > 0.5 ? 1 : 0;
  const body = openSquare(half, w, h, 3);
  const nearBody = dilateSquare(body, w, h, 2);
  const out = new Float32Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) {
    if (nearBody[i]) {
      out[i] = alpha[i];
      continue;
    }
    let a = Math.min(1, Math.max(0, (alpha[i] - floor * 0.8) / (1 - floor * 0.8)));
    if (a < 0.12) a = 0;
    out[i] = a;
  }
  return out;
}

/** The cut-out as a picture with alpha. */
export function toRaster(w: number, h: number, c: Cutout): Raster {
  const out = makeRaster(w, h);
  for (let i = 0; i < w * h; i++) {
    out.data[i * 4] = c.fg[i * 3];
    out.data[i * 4 + 1] = c.fg[i * 3 + 1];
    out.data[i * 4 + 2] = c.fg[i * 3 + 2];
    out.data[i * 4 + 3] = Math.round(c.alpha[i] * 255);
  }
  return out;
}


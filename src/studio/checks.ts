import type { Box } from "./paste.ts";
import type { Raster } from "./raster.ts";

/** What a check found, in words a person can read next to the picture. An empty list is a pass. */
export type Flags = string[];

const diffAt = (a: Raster, b: Raster, i: number) =>
  Math.max(Math.abs(a.data[i * 4] - b.data[i * 4]), Math.abs(a.data[i * 4 + 1] - b.data[i * 4 + 1]), Math.abs(a.data[i * 4 + 2] - b.data[i * 4 + 2]));

/**
 * A face edit pasted back into `box`: did the edit run into the edge of the box (a wide mouth that reaches the chin, an eye that the box cut
 * off), and did it change anything at all? `box` is the padded box that was pasted. A hard change on the box's own border means the model
 * wanted to draw beyond it. (A few dozen pixels is a hair strand crossing the border; the real cut-offs seen so far were 160 and more.)
 */
export function checkFaceEdit(base: Raster, result: Raster, box: Box): Flags {
  const [x0, y0, x1, y1] = box;
  let edge = 0, inside = 0, area = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const d = diffAt(base, result, y * base.w + x);
      area++;
      if (d > 40) {
        inside++;
        if (x < x0 + 3 || x >= x1 - 3 || y < y0 + 3 || y >= y1 - 3) edge++;
      }
    }
  }
  const flags: Flags = [];
  if (edge > 100) flags.push(`the change runs into the edge of the face area (${edge} pixels), so something may be cut off`);
  if (inside < 0.004 * area) flags.push("the face hardly changed");
  return flags;
}

/** The share of a picture's silhouette (alpha above one half) inside a region, to see whether a limb survived an edit. */
export function silhouetteIn(alpha: Float32Array, w: number, region: Box): number {
  let n = 0;
  for (let y = region[1]; y < region[3]; y++) for (let x = region[0]; x < region[2]; x++) if (alpha[y * w + x] > 0.5) n++;
  return n;
}

/**
 * A gesture edit (a raised arm) is a whole-picture edit, and the model tends to drop the arm that was not mentioned, or, now and then, to
 * return a broken picture (two copies of her stacked). The lower part of the picture is where her legs and the lowered arms are: what is there
 * should be about what was there in the base picture, in size and in place.
 */
export function checkLowerBody(baseAlpha: Float32Array, poseAlpha: Float32Array, w: number, h: number): Flags {
  const region: Box = [0, Math.round(h * 0.55), w, h];
  let before = 0, after = 0, both = 0, either = 0;
  for (let y = region[1]; y < region[3]; y++) {
    for (let x = 0; x < w; x++) {
      const a = baseAlpha[y * w + x] > 0.5, b = poseAlpha[y * w + x] > 0.5;
      if (a) before++;
      if (b) after++;
      if (a && b) both++;
      if (a || b) either++;
    }
  }
  const flags: Flags = [];
  if (before > 0 && after < before * 0.9) flags.push(`the lower part of her is ${Math.round((100 * (before - after)) / before)}% smaller than in her neutral picture (a lowered arm may be gone)`);
  if (either > 0 && both / either < 0.8) flags.push(`the lower part of her does not line up with her neutral picture (${Math.round((100 * both) / either)}% overlap): the picture may be broken`);
  return flags;
}

/** A whole-picture edit must keep the background the key colour: a model that redraws the backdrop breaks the cut-out. */
export function checkBackground(background: Uint8Array, w: number, h: number): Flags {
  let edge = 0;
  for (let x = 0; x < w; x++) edge += background[x] + background[(h - 1) * w + x];
  for (let y = 0; y < h; y++) edge += background[y * w] + background[y * w + w - 1];
  const share = edge / (2 * (w + h));
  return share < 0.8 ? [`the background is no longer the flat key colour at the picture's edge (${Math.round(share * 100)}% of it is)`] : [];
}

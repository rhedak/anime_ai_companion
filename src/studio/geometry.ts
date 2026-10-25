import { bbox, type Raster } from "./raster.ts";
import { padBox, scaleBox, type Box } from "./paste.ts";

/**
 * Where the face is, learned from the source pack itself: its blink picture differs from its rest picture at the eyes, and its three mouth
 * pictures at the mouth. That works for every pack the app has (all of them have blinks and mouths), whatever the character looks like.
 * Boxes are in the working picture's pixels.
 */
export interface Geometry {
  eyes: Box;
  /** Mouth openings 1 to 3 (the wider the opening, the taller the box). */
  mouth: [Box, Box, Box];
  /** The union of all of them: the area a face edit may change. */
  face: Box;
  /** Where each box came from: the pack's own pictures, or the proportions of a typical picture. */
  from: "pack" | "proportions";
}

/** The proportions of the Risa pictures, for a pack that has no blink or mouth pictures to learn from. */
const TYPICAL = {
  eyes: [0.41, 0.17, 0.59, 0.25],
  mouth: [
    [0.42, 0.2, 0.58, 0.29],
    [0.42, 0.2, 0.58, 0.29],
    [0.42, 0.2, 0.58, 0.32],
  ],
} as const;

const CHANGED = 14; // levels: a difference above this is the pack's own edit (the pictures are flattened on one colour first)
const PAD = 12;

/** The pixels where two pictures of the same size differ by more than CHANGED. Both are flattened onto the same colour first. */
function changedBox(a: Raster, b: Raster): Box | null {
  const mask = new Uint8Array(a.w * a.h);
  for (let i = 0; i < a.w * a.h; i++) {
    const d = Math.max(Math.abs(a.data[i * 4] - b.data[i * 4]), Math.abs(a.data[i * 4 + 1] - b.data[i * 4 + 1]), Math.abs(a.data[i * 4 + 2] - b.data[i * 4 + 2]));
    if (d > CHANGED) mask[i] = 1;
  }
  return bbox(mask, a.w, a.h);
}

const union = (boxes: Box[]): Box => [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];

/**
 * `source` pictures are the pack's own (flattened, same size); `w` and `h` are the working size the boxes are returned in.
 * A box that covers more than a fifth of the picture is not a face edit, so that picture is not trusted.
 */
export function deriveGeometry(source: { rest: Raster; blink?: Raster; talk: (Raster | undefined)[] }, w: number, h: number): Geometry {
  const sx = w / source.rest.w, sy = h / source.rest.h;
  const fits = (b: Box | null): b is Box => b !== null && (b[2] - b[0]) * (b[3] - b[1]) < 0.2 * source.rest.w * source.rest.h;
  const eyes = source.blink ? changedBox(source.rest, source.blink) : null;
  const mouths = [0, 1, 2].map((k) => (source.talk[k] ? changedBox(source.rest, source.talk[k] as Raster) : null));
  const typical = (b: readonly [number, number, number, number]): Box => [Math.round(b[0] * w), Math.round(b[1] * h), Math.round(b[2] * w), Math.round(b[3] * h)];
  const learned = fits(eyes) && mouths.every(fits);
  const eyeBox = learned ? padBox(scaleBox(eyes as Box, sx, sy), PAD, w, h) : typical(TYPICAL.eyes);
  const mouth = (learned ? mouths.map((m) => padBox(scaleBox(m as Box, sx, sy), PAD, w, h)) : TYPICAL.mouth.map(typical)) as [Box, Box, Box];
  return { eyes: eyeBox, mouth, face: union([eyeBox, ...mouth]), from: learned ? "pack" : "proportions" };
}

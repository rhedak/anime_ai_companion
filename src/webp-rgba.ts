/**
 * Lossless WebP, as plain RGBA pixels. `sharp` reads and writes the pictures. The archive tool, its tests
 * and the pack installer (`src/pack-install.ts`) load this module. `exact` keeps the colour of fully
 * transparent pixels, which a pack relies on (the background is transparent, and those pixels still have to match).
 */
import sharp from "sharp";

export interface RgbaImage {
  width: number;
  height: number;
  /** Tightly packed RGBA, 4 bytes per pixel, top to bottom. */
  data: Buffer;
}

const encodeOptions = { lossless: true, exact: true, nearLossless: false, alphaQuality: 100, effort: 6 } as const;

/** True when the bytes are a lossless WebP (a VP8L bitstream, not a lossy VP8 one). */
export function isLosslessWebp(bytes: Buffer): boolean {
  if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return false;
  let offset = 12;
  let lossless = false;
  let lossy = false;
  while (offset + 8 <= bytes.length) {
    const tag = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (tag === "VP8L") lossless = true;
    if (tag === "VP8 ") lossy = true;
    const step = 8 + size + (size & 1);
    if (step < 8) return false;
    offset += step;
  }
  return lossless && !lossy;
}

export async function decodeRgba(bytes: Buffer): Promise<RgbaImage | null> {
  try {
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 4 || info.width < 1 || info.height < 1) return null;
    return { width: info.width, height: info.height, data };
  } catch {
    return null;
  }
}

export async function encodeRgba(image: RgbaImage): Promise<Buffer | null> {
  try {
    const out = await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } }).webp(encodeOptions).toBuffer();
    return out;
  } catch {
    return null;
  }
}

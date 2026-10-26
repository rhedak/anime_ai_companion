/**
 * A gallery preview of a picture pack: the neutral frame, about 200 px wide, as a WebP.
 * The file lives at `packs/thumbs/<id>.webp`, which is what an index entry's `thumbnail`
 * field points at (`thumbs/<id>.webp`, relative to the index). It is a preview, so it is
 * a small lossy WebP; the frames the pack shows stay lossless.
 */
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { isPackName, PACK_THUMBS_DIR } from "./frame-pack.ts";

export const THUMB_WIDTH = 200;
const NEUTRAL = ["neutral.webp", "neutral.png", "neutral.jpg", "neutral.jpeg"];

/** The rest picture in a pack folder, or null when the folder has none. */
export async function neutralFramePath(folder: string): Promise<string | null> {
  for (const name of NEUTRAL) {
    const path = join(folder, name);
    if (await stat(path).then((info) => info.isFile()).catch(() => false)) return path;
  }
  return null;
}

/** Resizes the neutral frame to about 200 px wide. Throws only when the picture cannot be read. */
export async function makePackThumb(source: string, width = THUMB_WIDTH): Promise<Buffer> {
  return Buffer.from(await sharp(source).resize({ width, withoutEnlargement: true }).webp({ quality: 80, alphaQuality: 100, effort: 4 }).toBuffer());
}

export interface WrittenThumb {
  id: string;
  /** The index field: `thumbs/<id>.webp`. */
  thumbnail: string;
  bytes: number;
  width: number;
  height: number;
}

/** One preview per pack folder under `packsDir`, written to `outDir` (by default `packsDir/thumbs`). */
export async function writePackThumbs(packsDir: string, outDir = join(packsDir, PACK_THUMBS_DIR)): Promise<WrittenThumb[]> {
  await mkdir(outDir, { recursive: true });
  const written: WrittenThumb[] = [];
  const entries = await readdir(packsDir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name === PACK_THUMBS_DIR || !isPackName(entry.name)) continue;
    const source = await neutralFramePath(join(packsDir, entry.name));
    if (!source) continue;
    const body = await makePackThumb(source);
    await writeFile(join(outDir, `${entry.name}.webp`), body);
    const meta = await sharp(body).metadata();
    written.push({
      id: entry.name,
      thumbnail: `thumbs/${entry.name}.webp`,
      bytes: body.length,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
    });
  }
  return written;
}

import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * A picture of a pack on this computer that the user drew again in the pack studio, in the pack itself (docs/pack-studio.md, "Draw one picture again").
 * The pack stays one folder the app already reads. Beside its pictures, in dotfiles that `readPack` ignores, it keeps what is needed to undo the change and
 * to tell the user about it when the pack list has a newer version: the first picture each edited name had (`.original/`), and a note of each edit.
 */

/** The note of the edits, inside the pack's folder. */
export const EDITS_FILE = ".local-edits.json";
/** The pictures as they were before the first edit of each name. */
export const ORIGINAL_DIR = ".original";

export interface FrameEdit {
  at: string;
  change: string;
  model: string;
}

/** The edits of a pack folder by picture name (none: the pack is as it was made or installed). A note that cannot be read counts as none. */
export async function readEdits(folder: string): Promise<Record<string, FrameEdit>> {
  try {
    const raw = JSON.parse(await readFile(join(folder, EDITS_FILE), "utf8")) as { frames?: Record<string, unknown> };
    const out: Record<string, FrameEdit> = {};
    for (const [name, value] of Object.entries(raw.frames ?? {})) {
      const v = value as Partial<FrameEdit> | null;
      if (/^[a-z0-9-]{1,40}$/.test(name) && v && typeof v === "object") out[name] = { at: String(v.at ?? ""), change: String(v.change ?? ""), model: String(v.model ?? "") };
    }
    return out;
  } catch {
    return {};
  }
}

async function writeEdits(folder: string, frames: Record<string, FrameEdit>): Promise<void> {
  const file = join(folder, EDITS_FILE);
  if (!Object.keys(frames).length) return void (await rm(file, { force: true }));
  await writeFile(`${file}.tmp`, `${JSON.stringify({ frames }, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}

/** Puts a new picture in the place of `<frame>.webp` in a pack folder: the picture it had is kept once (the first one stays the original), the new one is written whole or not at all. */
export async function applyEdit(folder: string, frame: string, webp: Buffer, edit: FrameEdit): Promise<void> {
  const file = join(folder, `${frame}.webp`);
  const original = join(folder, ORIGINAL_DIR, `${frame}.webp`);
  if (await stat(file).then(() => true, () => false)) {
    if (!(await stat(original).then(() => true, () => false))) {
      await mkdir(join(folder, ORIGINAL_DIR), { recursive: true });
      await copyFile(file, original);
    }
  }
  await writeFile(`${file}.tmp`, webp);
  await rename(`${file}.tmp`, file);
  await writeEdits(folder, { ...(await readEdits(folder)), [frame]: edit });
}

/** Puts the original picture of an edited name back and forgets the edit. False when there is nothing to restore. */
export async function restoreOriginal(folder: string, frame: string): Promise<boolean> {
  const edits = await readEdits(folder);
  const original = join(folder, ORIGINAL_DIR, `${frame}.webp`);
  if (!edits[frame] || !(await stat(original).then(() => true, () => false))) return false;
  await rename(original, join(folder, `${frame}.webp`));
  delete edits[frame];
  await writeEdits(folder, edits);
  if (!(await readdir(join(folder, ORIGINAL_DIR)).catch(() => ["x"])).length) await rm(join(folder, ORIGINAL_DIR), { recursive: true, force: true });
  return true;
}

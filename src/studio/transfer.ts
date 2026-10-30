import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

/**
 * Taking a pack out of the app and bringing one in (docs/pack-studio.md, "Import and export"). Only plain files of a pack are copied (pictures and its
 * text files; links are skipped), nothing is ever written over a folder that exists, and a text file the pack already has is never replaced.
 */

const PICTURE = /\.webp$/;
const TEXT = /\.(txt|md)$/;
const MAX_FILES = 600;
const MAX_BYTES = 40 * 1024 * 1024;

/** The files of a pack folder that travel: `.webp` pictures and `.txt` / `.md` texts, plain files only. */
async function packFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  const names = entries.filter((e) => e.isFile() && (PICTURE.test(e.name) || TEXT.test(e.name)) && !e.name.startsWith(".")).map((e) => e.name);
  if (names.length > MAX_FILES) throw new Error(`That folder has more than ${MAX_FILES} files; a pack does not.`);
  for (const name of names) if ((await stat(join(folder, name))).size > MAX_BYTES) throw new Error(`${name} is larger than ${MAX_BYTES / 1024 / 1024} MB.`);
  return names;
}

const exists = (path: string) => stat(path).then(() => true, () => false);

async function copyPack(from: string, to: string, names: string[], notes: Record<string, string>): Promise<void> {
  const staging = `${to}.partial`;
  await rm(staging, { recursive: true, force: true });
  try {
    await mkdir(staging, { recursive: true });
    for (const name of names) await copyFile(join(from, name), join(staging, name));
    // A text file the pack has is its own; the ones it lacks get the note, so a pack never leaves without saying where it is from.
    for (const [name, text] of Object.entries(notes)) if (!names.includes(name)) await writeFile(join(staging, name), text);
    await rename(staging, to);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

/** Copies the installed pack `from` into a new folder `<parent>/<name>`. Returns the folder written. */
export async function exportPack(from: string, parent: string, name: string): Promise<string> {
  if (!isAbsolute(parent)) throw new Error("Give the whole path of the folder to export into.");
  if (!(await stat(parent).then((s) => s.isDirectory(), () => false))) throw new Error("That folder does not exist.");
  const to = join(parent, name);
  if (await exists(to)) throw new Error(`${to} already exists. Nothing was replaced; pick another folder.`);
  const names = await packFiles(from);
  if (!names.includes("neutral.webp")) throw new Error(`${name} has no neutral.webp, so it is not a whole pack.`);
  await copyPack(from, to, names, {
    "NOTICE.md": `# ${name}\n\nA picture pack exported from the companion app. Check where its pictures come from and the terms that apply to them before sharing it.\n`,
  });
  return to;
}

/** Copies the pack in `from` into `<framesDir>/<name>`. Returns the number of pictures. */
export async function importPack(from: string, framesDir: string, name: string): Promise<number> {
  if (!isAbsolute(from)) throw new Error("Give the whole path of the pack's folder.");
  if (!(await stat(from).then((s) => s.isDirectory(), () => false))) throw new Error("That folder does not exist.");
  const target = join(framesDir, name);
  if (await exists(target)) throw new Error(`There is already a pack called ${name}. Nothing was replaced; pick another name.`);
  const names = await packFiles(from);
  if (!names.includes("neutral.webp")) throw new Error("That folder has no neutral.webp: a pack needs at least that picture (docs/frame-packs.md).");
  await mkdir(framesDir, { recursive: true });
  await copyPack(from, target, names, {
    "NOTICE.md": `# ${name}\n\nImported from a folder on this computer. Where its pictures come from, and the terms that apply to them, are for whoever imported it to know.\n`,
  });
  return names.filter((n) => PICTURE.test(n)).length;
}

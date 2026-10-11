/**
 * A frame pack is a folder of pictures she is shown with instead of the drawn avatar: `data/frames/<name>/`.
 * The file names say what each picture is, so there is no manifest to get wrong:
 *
 *   neutral.png          her face at rest (the only file that must exist)
 *   neutral-blink.png    eyes shut, for the blink
 *   neutral-talk1.png    mouth open a little; talk2, talk3 ... open wider. They play while she speaks.
 *   happy.png, happy-blink.png, happy-talk1.png ...   the same for any emotion in emotions.json
 *
 * An emotion without pictures falls back to neutral, a missing blink means no blink, and missing talk
 * frames mean the page only bobs her. Two optional text files describe where the pictures come from:
 * `credit.txt` (one line, shown on the page the whole time the pack is on) and `NOTICE.md` (terms of use,
 * which `/frames` points to). A pack of characters that belong to someone else needs both. PNG, WebP and JPEG are accepted; SVG is not, because an image the
 * server hands out must never be able to run script.
 */
import type { Dirent } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export interface PackEmotion {
  idle: string;
  blink?: string;
  /** Mouth-open frames, narrowest first. */
  talk: string[];
}

export interface FramePack {
  name: string;
  emotions: Record<string, PackEmotion>;
  /** Every servable file by its name in the folder. Anything not in here is never sent. */
  files: Map<string, { path: string; mtimeMs: number }>;
  /** Things the user should know: odd sizes, files that were not understood, emotions that fall back. */
  notes: string[];
  /** The one-line credit from credit.txt, shown wherever the pack is. */
  credit?: string;
}

export type PackResult = { ok: true; pack: FramePack } | { ok: false; reason: string };

/** What the page needs to show a pack. The urls carry the file's change time so a replaced picture is refetched. */
export interface PackInfo {
  name: string;
  credit?: string;
  emotions: Record<string, { idle: string; blink?: string; talk: string[] }>;
}

export const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_CREDIT = 300;
const MAX_FILES = 120;
const PACK_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$/;
const FRAME_FILE = /^([a-z][a-z0-9_]*)(?:-(blink)|-talk(\d{1,2}))?\.(png|webp|jpe?g)$/i;

export const isPackName = (name: string): boolean => PACK_NAME.test(name) && !name.includes("..");

export const frameMime = (file: string): string =>
  /\.png$/i.test(file) ? "image/png" : /\.webp$/i.test(file) ? "image/webp" : "image/jpeg";

/** The packs in these folders (the user's own first, then the ones shipped with the app), by name. */
export async function listPacks(...dirs: string[]): Promise<string[]> {
  const names = new Set<string>();
  for (const dir of dirs) {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory() && isPackName(e.name)) names.add(e.name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Reads a pack's folder and works out which picture is which. Never throws for a bad folder. */
export async function readPack(dirs: string | string[], name: string, emotions: string[]): Promise<PackResult> {
  if (!isPackName(name)) return { ok: false, reason: `"${name}" is not a usable pack name (letters, digits, space, . _ -).` };
  let folder = "";
  let entries: Dirent[] | null = null;
  for (const dir of [dirs].flat()) {
    entries = await readdir(join(dir, name), { withFileTypes: true }).catch(() => null);
    if (entries) {
      folder = join(dir, name);
      break;
    }
  }
  if (!entries) return { ok: false, reason: `There is no pack called "${name}" in data/frames.` };

  const notes: string[] = [];
  const files = new Map<string, { path: string; mtimeMs: number }>();
  const found: Record<string, { idle?: string; blink?: string; talk: [number, string][] }> = {};
  const sizes = new Map<string, string>();
  const ignored: string[] = [];

  const names = entries.filter((e) => e.isFile()).map((e) => e.name).sort();
  if (names.length > MAX_FILES) return { ok: false, reason: `Too many files in the pack (more than ${MAX_FILES}).` };
  for (const file of names) {
    const m = FRAME_FILE.exec(file);
    const emotion = m?.[1].toLowerCase();
    if (!m || !emotion || !emotions.includes(emotion)) {
      if (!file.startsWith(".")) ignored.push(file);
      continue;
    }
    const path = join(folder, file);
    const info = await stat(path);
    if (info.size > MAX_FRAME_BYTES) {
      notes.push(`${file} is larger than ${MAX_FRAME_BYTES / 1024 / 1024} MB and was left out.`);
      continue;
    }
    const slot = (found[emotion] ??= { talk: [] });
    if (m[2]) slot.blink = file;
    else if (m[3]) slot.talk.push([Number(m[3]), file]);
    else slot.idle = file;
    files.set(file, { path, mtimeMs: info.mtimeMs });
    const size = await imageSize(path);
    sizes.set(file, size ? `${size.width}×${size.height}` : "?");
  }

  const result: Record<string, PackEmotion> = {};
  for (const [emotion, slot] of Object.entries(found)) {
    if (!slot.idle) {
      notes.push(`${emotion} has no ${emotion}.png, so its other pictures are not used.`);
      for (const f of [slot.blink, ...slot.talk.map(([, f]) => f)]) if (f) files.delete(f);
      continue;
    }
    result[emotion] = { idle: slot.idle, blink: slot.blink, talk: slot.talk.sort((a, b) => a[0] - b[0]).map(([, f]) => f) };
  }
  if (!result.neutral) return { ok: false, reason: `the pack "${name}" needs a neutral.png (her face at rest).` };

  const reference = sizes.get(result.neutral.idle);
  const odd = [...files.keys()].filter((f) => sizes.get(f) !== reference);
  if (odd.length) {
    notes.push(
      `Pictures of a different size than neutral.png (${reference}) will jump when they swap: ` +
        odd.map((f) => `${f} (${sizes.get(f)})`).join(", ") + ".",
    );
  }
  const plain = emotions.filter((e) => !result[e]);
  if (plain.length) notes.push(`No pictures for ${plain.join(", ")}: she shows neutral for those.`);
  const known = new Set(["credit.txt", "NOTICE.md"]);
  const unused = ignored.filter((f) => !known.has(f));
  if (unused.length) notes.push(`Not used (the name is not <emotion>[-blink|-talkN].png/.webp/.jpg): ${unused.join(", ")}.`);
  const credit = (await readFile(join(folder, "credit.txt"), "utf8").catch(() => ""))
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim();
  if (credit.length > MAX_CREDIT) notes.push(`credit.txt is longer than ${MAX_CREDIT} characters and was not used.`);
  if (names.includes("NOTICE.md")) notes.push(`This pack comes with terms of use: read NOTICE.md in ${folder} before you use or share it.`);
  return { ok: true, pack: { name, emotions: result, files, notes, credit: credit && credit.length <= MAX_CREDIT ? credit : undefined } };
}

export function packInfo(pack: FramePack): PackInfo {
  const url = (file: string) => `/frames/${encodeURIComponent(pack.name)}/${encodeURIComponent(file)}?v=${Math.floor(pack.files.get(file)?.mtimeMs ?? 0)}`;
  const emotions: PackInfo["emotions"] = {};
  for (const [emotion, e] of Object.entries(pack.emotions)) {
    emotions[emotion] = { idle: url(e.idle), blink: e.blink && url(e.blink), talk: e.talk.map(url) };
  }
  return { name: pack.name, credit: pack.credit, emotions };
}

/** Width and height from the first bytes of a PNG, WebP or JPEG; null for anything else. */
export async function imageSize(path: string): Promise<{ width: number; height: number } | null> {
  const handle = await open(path, "r").catch(() => null);
  if (!handle) return null;
  try {
    const head = Buffer.alloc(65536);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    return sizeOf(head.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

export function sizeOf(b: Buffer): { width: number; height: number } | null {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString("ascii", 12, 16) === "IHDR") {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (kind === "VP8L") {
      const bits = b.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    return null;
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

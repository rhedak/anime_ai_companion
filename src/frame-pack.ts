/**
 * A frame pack is a folder of pictures she is shown with instead of the drawn avatar: `data/frames/<name>/`.
 * The file names say what each picture is, so there is no manifest to get wrong:
 *
 *   neutral.png          her face at rest (the only file that must exist)
 *   neutral-blink.png    eyes shut, for the blink
 *   neutral-talk1.png    mouth open a little; talk2, talk3 ... open wider. They play while she speaks.
 *   happy.png, happy-blink.png, happy-talk1.png ...   the same for any emotion in emotions.json
 *   wave-1.png, wave-2.png, cheer-1.png ...   the pictures she alternates while she makes that gesture (optional)
 *
 * An emotion without pictures falls back to neutral, a missing blink means no blink, and missing talk
 * frames mean the page only bobs her. Two optional text files describe where the pictures come from:
 * `credit.txt` (its first line is shown on the page the whole time the pack is on; any lines after it are the terms,
 * said in the chat when the pack is chosen or the page opens with it) and `NOTICE.md` (terms of use,
 * which `/frames` points to). A third, `look.txt`, says in plain words what she wears in these pictures, so she can describe herself: the pictures are
 * not hers to see otherwise. Its optional first line `character: <id>` names the character, whose shared description (build, age, face, hair colour)
 * is `characters/<id>.txt` beside the packs (first line the name, the rest the description), so several outfits of one character say the same things.
 * A pack of characters that belong to someone else needs both. PNG, WebP and JPEG are accepted; SVG is not, because an image the
 * server hands out must never be able to run script.
 */
import type { Dirent } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { GESTURES } from "../public/frames.js";

export interface PackEmotion {
  idle: string;
  blink?: string;
  /** Mouth-open frames, narrowest first. */
  talk: string[];
}

export interface FramePack {
  name: string;
  emotions: Record<string, PackEmotion>;
  /** Pictures that alternate while she makes a gesture (`wave-1.png`, `wave-2.png`), in order; only gestures the app knows. */
  gestures: Record<string, string[]>;
  /** Every servable file by its name in the folder. Anything not in here is never sent. */
  files: Map<string, { path: string; mtimeMs: number }>;
  /** Things the user should know: odd sizes, files that were not understood, emotions that fall back. */
  notes: string[];
  /** The first line of credit.txt, shown wherever the pack is. */
  credit?: string;
  /** The rest of credit.txt: a short statement of the terms, said in the chat when the pack comes on. */
  terms?: string;
  /** look.txt: what she wears in these pictures, in the pack author's words. Told to her when the pack comes on. */
  look?: string;
  /** The `character: <id>` line of look.txt, and that character's name and shared description (characters/<id>.txt), when there is one. */
  character?: { id: string; name: string; text: string };
  /** What look.txt's `character:` line asked for, before the character file has been looked up. */
  characterId?: string;
}

export type PackResult = { ok: true; pack: FramePack } | { ok: false; reason: string };

/** What the page needs to show a pack. The urls carry the file's change time so a replaced picture is refetched. */
export interface PackInfo {
  name: string;
  credit?: string;
  terms?: string;
  emotions: Record<string, { idle: string; blink?: string; talk: string[] }>;
  gestures: Record<string, string[]>;
}

export const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_CREDIT = 300;
const MAX_TERMS = 600;
const MAX_LOOK = 600;
const MAX_CHARACTER = 600;
const CHARACTER_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const CHARACTERS_DIR = "characters";
const MAX_FILES = 120;
const PACK_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$/;
const POSE_FILE = /^([a-z][a-z0-9_]*)-(\d{1,2})\.(png|webp|jpe?g)$/i;
const FRAME_FILE = /^([a-z][a-z0-9_]*)(?:-(blink)|-talk(\d{1,2}))?\.(png|webp|jpe?g)$/i;

export const isPackName = (name: string): boolean => PACK_NAME.test(name) && !name.includes("..");

export const frameMime = (file: string): string =>
  /\.png$/i.test(file) ? "image/png" : /\.webp$/i.test(file) ? "image/webp" : "image/jpeg";

/** Gallery previews live here, next to the shipped packs (`packs/thumbs/<id>.webp`). It is not itself a pack. */
export const PACK_THUMBS_DIR = "thumbs";

async function hasNeutralFrame(folder: string): Promise<boolean> {
  for (const name of ["neutral.png", "neutral.webp", "neutral.jpg", "neutral.jpeg"]) {
    if (await stat(join(folder, name)).then(() => true).catch(() => false)) return true;
  }
  return false;
}

/** The packs in these folders (the user's own first, then the ones shipped with the app), by name. */
export async function listPacks(...dirs: string[]): Promise<string[]> {
  const names = new Set<string>();
  for (const dir of dirs) {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory() || !isPackName(e.name)) continue;
      // `packs/thumbs` holds one small preview per pack. A real pack of that name (it has a neutral picture) still counts.
      if ((e.name === PACK_THUMBS_DIR || e.name === CHARACTERS_DIR) && !(await hasNeutralFrame(join(dir, e.name)))) continue;
      names.add(e.name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** A character's shared description from `characters/<id>.txt` in the first folder that has it: first line the name, the rest the text. Null when missing or too long. */
async function readCharacter(dirs: string[], id: string): Promise<{ id: string; name: string; text: string } | undefined> {
  for (const dir of dirs) {
    const raw = await readFile(join(dir, CHARACTERS_DIR, `${id}.txt`), "utf8").catch(() => null);
    if (raw === null) continue;
    const lines = clean(raw).split(/\n/).map((l) => l.trim()).filter(Boolean);
    const [name, ...rest] = lines;
    const text = rest.join(" ");
    if (name && name.length <= 60 && text && text.length <= MAX_CHARACTER) return { id, name, text };
    return undefined;
  }
  return undefined;
}

/** Text for her prompt from a file the pack author wrote: control characters (except line ends) and her own tag brackets and markup are dropped. */
const clean = (raw: string): string => raw.replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").replace(/[\[\]<>]/g, "");

/** Reads a pack's folder and works out which picture is which. Never throws for a bad folder. */
export async function readPack(dirs: string | string[], name: string, emotions: string[]): Promise<PackResult> {
  if (!isPackName(name)) return { ok: false, reason: `"${name}" is not a usable pack name (letters, digits, space, . _ -).` };
  // The first folder that holds a working pack of this name wins, so a half-made folder of the user's own
  // (just a base picture, say) does not hide a finished pack of the same name that ships with the app.
  let failure: PackResult | null = null;
  for (const dir of [dirs].flat()) {
    const result = await readPackIn(dir, name, emotions);
    if (result.ok) {
      const id = result.pack.characterId;
      if (id) result.pack.character = await readCharacter([dirs].flat(), id);
      return result;
    }
    if (result.reason !== MISSING) failure ??= result;
  }
  return failure ?? { ok: false, reason: `There is no pack called "${name}" in data/frames.` };
}

const MISSING = "no such folder";

async function readPackIn(dir: string, name: string, emotions: string[]): Promise<PackResult> {
  const folder = join(dir, name);
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => null);
  if (!entries) return { ok: false, reason: MISSING };

  const notes: string[] = [];
  const files = new Map<string, { path: string; mtimeMs: number }>();
  const found: Record<string, { idle?: string; blink?: string; talk: [number, string][] }> = {};
  const poses: Record<string, [number, string][]> = {};
  const sizes = new Map<string, string>();
  const ignored: string[] = [];

  const names = entries.filter((e) => e.isFile()).map((e) => e.name).sort();
  if (names.length > MAX_FILES) return { ok: false, reason: `Too many files in the pack (more than ${MAX_FILES}).` };
  for (const file of names) {
    const pose = POSE_FILE.exec(file);
    const gesture = pose?.[1].toLowerCase();
    if (pose && gesture && gesture in GESTURES) {
      const path = join(folder, file);
      const info = await stat(path);
      if (info.size > MAX_FRAME_BYTES) {
        notes.push(`${file} is larger than ${MAX_FRAME_BYTES / 1024 / 1024} MB and was left out.`);
        continue;
      }
      (poses[gesture] ??= []).push([Number(pose[2]), file]);
      files.set(file, { path, mtimeMs: info.mtimeMs });
      const size = await imageSize(path);
      sizes.set(file, size ? `${size.width}×${size.height}` : "?");
      continue;
    }
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
  const gestures: Record<string, string[]> = {};
  for (const [gesture, list] of Object.entries(poses)) gestures[gesture] = list.sort((a, b) => a[0] - b[0]).map(([, f]) => f);
  const plain = emotions.filter((e) => !result[e]);
  if (plain.length) notes.push(`No pictures for ${plain.join(", ")}: she shows neutral for those.`);
  const known = new Set(["credit.txt", "NOTICE.md", "look.txt"]);
  const unused = ignored.filter((f) => !known.has(f));
  if (unused.length) notes.push(`Not used (the name is not <emotion>[-blink|-talkN] or <gesture>-N, as .png/.webp/.jpg): ${unused.join(", ")}.`);
  const lines = (await readFile(join(folder, "credit.txt"), "utf8").catch(() => ""))
    .split(/\r?\n/)
    .map((line) => line.replace(/[\u0000-\u001f\u007f]+/g, " ").trim())
    .filter(Boolean);
  const credit = lines[0] ?? "";
  const terms = lines.slice(1).join(" ");
  if (credit.length > MAX_CREDIT) notes.push(`credit.txt is longer than ${MAX_CREDIT} characters and was not used.`);
  if (terms.length > MAX_TERMS) notes.push(`The terms in credit.txt (after its first line) are longer than ${MAX_TERMS} characters and were not used.`);
  if (names.includes("NOTICE.md")) notes.push(`This pack comes with terms of use: read NOTICE.md in ${folder} before you use or share it.`);
  const usable = credit && credit.length <= MAX_CREDIT;
  const lookRaw = clean(await readFile(join(folder, "look.txt"), "utf8").catch(() => ""));
  const lookLines = lookRaw.split(/\n/).map((l) => l.trim());
  const named = /^character:\s*(\S+)\s*$/i.exec(lookLines[0] ?? "");
  const characterId = named && CHARACTER_ID.test(named[1].toLowerCase()) ? named[1].toLowerCase() : undefined;
  const lookText = (named ? lookLines.slice(1) : lookLines).filter(Boolean).join(" ");
  if (lookText.length > MAX_LOOK) notes.push(`look.txt is longer than ${MAX_LOOK} characters and was not used.`);
  return {
    ok: true,
    pack: {
      name,
      emotions: result,
      gestures,
      files,
      notes,
      credit: usable ? credit : undefined,
      terms: usable && terms && terms.length <= MAX_TERMS ? terms : undefined,
      look: lookText && lookText.length <= MAX_LOOK ? lookText : undefined,
      characterId,
    },
  };
}

export function packInfo(pack: FramePack, staticBase?: string): PackInfo {
  // The app serves the pictures itself, with the change time in the url; a static copy (the browser demo) has them in a folder, by a relative path.
  const url = (file: string) =>
    staticBase === undefined
      ? `/frames/${encodeURIComponent(pack.name)}/${encodeURIComponent(file)}?v=${Math.floor(pack.files.get(file)?.mtimeMs ?? 0)}`
      : `${staticBase}${encodeURIComponent(file)}`;
  const emotions: PackInfo["emotions"] = {};
  for (const [emotion, e] of Object.entries(pack.emotions)) {
    emotions[emotion] = { idle: url(e.idle), blink: e.blink && url(e.blink), talk: e.talk.map(url) };
  }
  const gestures = Object.fromEntries(Object.entries(pack.gestures).map(([name, list]) => [name, list.map(url)]));
  return { name: pack.name, credit: pack.credit, terms: pack.terms, emotions, gestures };
}

/** What to tell the model about gestures while this pack is on: which ones show a picture, and that the rest change nothing. */
export function gestureNote(pack: FramePack | null): string {
  const have = Object.keys(pack?.gestures ?? {});
  return have.length ? `Of the gestures, only ${have.join(" and ")} show a picture; the others change nothing.` : "Gestures change nothing either.";
}

/**
 * What she is told when a pack comes on, and at the start of a new conversation while one is on: that her look is fixed, what it is (look.txt),
 * and which gestures work. Without the description she would go on describing the drawn character.
 */
export function packNote(pack: FramePack): string {
  const who = pack.character ? `You are ${pack.character.name}. ${pack.character.text} ` : "";
  const look = who || pack.look ? ` The pictures show you like this: ${who}${pack.look ?? ""} Describe yourself that way, not as the drawn character you were before. If a picture of you is attached, it is how you look now.` : "";
  return (
    "The user switched you to a fixed set of pictures: your look cannot change now, so [avatar ...] tags do nothing." +
    look +
    " " +
    gestureNote(pack) +
    " Your emotions and talking still drive which picture is shown."
  );
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

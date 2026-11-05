import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImageBackend } from "./backend.ts";
import { cutout, KEYS, keyBackground, pickKey, toRaster } from "./cutout.ts";
import { deriveGeometry } from "./geometry.ts";
import { featherMask, pasteBack, scaleBox, type Box } from "./paste.ts";
import { talkPrompt } from "./prompts.ts";
import { FRAME_WORKING_HEIGHT } from "./frame-edit.ts";
import { decode, encodePng, encodeWebp, flatten, makeRaster, resize, type Raster } from "./raster.ts";

/**
 * An activity being made in the pack studio (docs/pack-studio.md, "Making an activity"): a loop of pictures `activity-<name>-N` drawn one at a time,
 * each from a picture the user chose and a few words. The pictures wait in a working folder of their own, `data/studio/activity-<id>/`, until the user
 * saves the activity into the pack, so stopping in the middle loses nothing and the pack is not touched before the yes.
 *
 *   draft.json     what the draft is: the pack it is for, the activity's name, and its pictures in order
 *   frames/<f>.webp  a loop picture, lossless, at the pack's size (`f` is a stable id: renaming or removing one does not rename the others)
 *   talk/<f>.webp    the same picture with her mouth open, for while she speaks
 */

/** `activity-<name>-<n>` in a pack (src/frame-pack.ts, ACTIVITY_FILE): a lower-case word that can have digits and underscores, and a number of at most two digits. */
export const ACTIVITY_NAME = /^[a-z][a-z0-9_]{0,23}$/;
export const MAX_ACTIVITY_FRAMES = 99;
const DRAFT_ID = /^activity-[0-9a-f]{8}$/;
const FILE_ID = /^[0-9a-f]{8}$/;

export interface DraftFrame {
  /** Stable id of the picture's file. */
  file: string;
  /** The words the picture was drawn with, and what it was drawn from (`neutral`, or `#3` for the third picture of the loop). */
  change: string;
  from: string;
  model: string;
  at: string;
}

export interface ActivityDraft {
  id: string;
  /** The pack the activity is for. */
  source: string;
  name: string;
  created: string;
  updated: string;
  frames: DraftFrame[];
  /** Files (of `frames`) that have a talking picture. */
  talk: string[];
}

export const isDraftId = (id: unknown): id is string => typeof id === "string" && DRAFT_ID.test(id);
export const isFileId = (id: unknown): id is string => typeof id === "string" && FILE_ID.test(id);

const folder = (studioDir: string, id: string) => join(studioDir, id);

export async function readDraft(studioDir: string, id: string): Promise<ActivityDraft | null> {
  if (!isDraftId(id)) return null;
  try {
    const raw = JSON.parse(await readFile(join(folder(studioDir, id), "draft.json"), "utf8")) as Partial<ActivityDraft>;
    if (raw.id !== id || typeof raw.source !== "string" || typeof raw.name !== "string" || !ACTIVITY_NAME.test(raw.name) || !Array.isArray(raw.frames)) return null;
    const frames = raw.frames.filter((f): f is DraftFrame => !!f && isFileId(f.file)).map((f) => ({ file: f.file, change: String(f.change ?? ""), from: String(f.from ?? ""), model: String(f.model ?? ""), at: String(f.at ?? "") }));
    const talk = (Array.isArray(raw.talk) ? raw.talk : []).filter((f): f is string => frames.some((x) => x.file === f));
    return { id, source: raw.source, name: raw.name, created: String(raw.created ?? ""), updated: String(raw.updated ?? ""), frames, talk };
  } catch {
    return null;
  }
}

export async function writeDraft(studioDir: string, draft: ActivityDraft): Promise<void> {
  const dir = folder(studioDir, draft.id);
  await mkdir(dir, { recursive: true });
  draft.updated = new Date().toISOString();
  await writeFile(join(dir, "draft.json.tmp"), `${JSON.stringify(draft, null, 2)}\n`);
  await rename(join(dir, "draft.json.tmp"), join(dir, "draft.json"));
}

export async function createDraft(studioDir: string, source: string, name: string): Promise<ActivityDraft> {
  const now = new Date().toISOString();
  const draft: ActivityDraft = { id: `activity-${randomBytes(4).toString("hex")}`, source, name, created: now, updated: now, frames: [], talk: [] };
  await writeDraft(studioDir, draft);
  return draft;
}

/** The drafts on this computer, newest first (the unfinished activities the panel offers to carry on). */
export async function listDrafts(studioDir: string): Promise<ActivityDraft[]> {
  const out: ActivityDraft[] = [];
  for (const id of await readdir(studioDir).catch(() => [] as string[])) {
    const draft = await readDraft(studioDir, id);
    if (draft) out.push(draft);
  }
  return out.sort((a, b) => b.updated.localeCompare(a.updated));
}

export const deleteDraft = (studioDir: string, id: string) => (isDraftId(id) ? rm(folder(studioDir, id), { recursive: true, force: true }) : Promise.resolve());

export const framePath = (studioDir: string, draft: ActivityDraft, file: string, talk = false) => join(folder(studioDir, draft.id), talk ? "talk" : "frames", `${file}.webp`);

/** Adds a picture at the end of the loop (the 99 pictures a pack can number are the limit). */
export async function addFrame(studioDir: string, draft: ActivityDraft, webp: Buffer, info: Omit<DraftFrame, "file" | "at">): Promise<DraftFrame> {
  if (draft.frames.length >= MAX_ACTIVITY_FRAMES) throw new Error(`An activity can have ${MAX_ACTIVITY_FRAMES} pictures at most.`);
  const file = randomBytes(4).toString("hex");
  await mkdir(join(folder(studioDir, draft.id), "frames"), { recursive: true });
  await writeFile(framePath(studioDir, draft, file), webp);
  const frame = { ...info, file, at: new Date().toISOString() };
  draft.frames.push(frame);
  await writeDraft(studioDir, draft);
  return frame;
}

/** Takes a picture (and its talking one) out of the loop; the ones after it move up. */
export async function removeFrame(studioDir: string, draft: ActivityDraft, file: string): Promise<boolean> {
  if (!draft.frames.some((f) => f.file === file)) return false;
  draft.frames = draft.frames.filter((f) => f.file !== file);
  draft.talk = draft.talk.filter((f) => f !== file);
  await rm(framePath(studioDir, draft, file), { force: true });
  await rm(framePath(studioDir, draft, file, true), { force: true });
  await writeDraft(studioDir, draft);
  return true;
}

export async function setTalk(studioDir: string, draft: ActivityDraft, file: string, webp: Buffer): Promise<void> {
  await mkdir(join(folder(studioDir, draft.id), "talk"), { recursive: true });
  await writeFile(framePath(studioDir, draft, file, true), webp);
  if (!draft.talk.includes(file)) draft.talk.push(file);
  await writeDraft(studioDir, draft);
}

export const clearTalk = async (studioDir: string, draft: ActivityDraft): Promise<void> => {
  for (const file of draft.talk) await rm(framePath(studioDir, draft, file, true), { force: true });
  draft.talk = [];
  await writeDraft(studioDir, draft);
};

/** The names an activity's pictures get in the pack: `activity-<name>-<n>` and, when it has them, `activity-<name>-talk-<n>`. */
export const frameName = (name: string, n: number, talk = false) => `activity-${name}${talk ? "-talk" : ""}-${n}`;

/** The picture `patch` inside `box` (feathered) laid over `base`, with the base's own alpha: nothing outside the box changes, byte for byte. */
export function blendBox(base: Raster, patch: Raster, box: Box, sigma = 6): Raster {
  const mask = featherMask(base.w, base.h, box, sigma);
  const out = makeRaster(base.w, base.h);
  for (let i = 0; i < base.w * base.h; i++) {
    const m = mask[i];
    if (m < 0.004) {
      for (let c = 0; c < 4; c++) out.data[i * 4 + c] = base.data[i * 4 + c];
      continue;
    }
    for (let c = 0; c < 3; c++) out.data[i * 4 + c] = Math.round(patch.data[i * 4 + c] * m + base.data[i * 4 + c] * (1 - m));
    out.data[i * 4 + 3] = base.data[i * 4 + 3];
  }
  return out;
}

/** The pack's own pictures the mouth is learned from, and copied from. */
export interface MouthSource {
  neutral: Buffer;
  blink?: Buffer;
  talk: (Buffer | undefined)[];
}

/** Where her mouth is in a picture of the pack's size, learned from the pack's own mouth pictures, and the opening to copy (the second, else the first or third). Null: the pack has no mouth pictures. */
export async function mouthOf(source: MouthSource, w: number, h: number): Promise<{ box: Box; opening: Raster } | null> {
  const index = [1, 0, 2].find((k) => source.talk[k]);
  if (index === undefined) return null;
  const white = [255, 255, 255] as const;
  const flat = async (b?: Buffer) => (b ? flatten(await decode(b), white) : undefined);
  const rest = await decode(source.neutral);
  const geometry = deriveGeometry({ rest: flatten(rest, white), blink: await flat(source.blink), talk: await Promise.all(source.talk.map(flat)) }, rest.w, rest.h);
  const sx = w / rest.w, sy = h / rest.h;
  const opening = await decode(source.talk[index] as Buffer);
  return { box: scaleBox(geometry.mouth[index], sx, sy), opening: await resize(opening, w, h) };
}

/** The script way: the mouth of the pack's own talking picture copied onto the loop picture. Right while her head stays where it is in the pack's rest picture. */
export async function talkByScript(frame: Buffer, source: MouthSource): Promise<Buffer | null> {
  const base = await decode(frame);
  const mouth = await mouthOf(source, base.w, base.h);
  if (!mouth) return null;
  return encodeWebp(blendBox(base, mouth.opening, mouth.box), { lossless: true });
}

/**
 * The model way: the model opens her mouth in this very picture. With paste-back on (the user's choice; off by default), only the mouth's box
 * is kept; off, the whole picture the model drew is kept, cut out on its key colour like a loop picture. Throws what the backend throws.
 */
export async function talkByModel(frame: Buffer, source: MouthSource, seed: number, backend: ImageBackend, signal?: AbortSignal, pasteOn = false): Promise<Buffer | null> {
  const base = await decode(frame);
  const mouth = await mouthOf(source, base.w, base.h);
  if (!mouth) return null;
  const { key } = pickKey(base);
  const height = FRAME_WORKING_HEIGHT;
  const width = Math.min(1536, Math.max(256, Math.round(((base.w / base.h) * height) / 16) * 16));
  const onKey = await resize(flatten(base, KEYS[key]), width, height);
  const edited = await resize(await decode(await backend.edit({ image: await encodePng(onKey), prompt: talkPrompt(2), seed, width, height }, signal)), width, height);
  if (!pasteOn) {
    const whole = toRaster(width, height, cutout(edited, { key }));
    return encodeWebp(await resize(whole, base.w, base.h), { lossless: true });
  }
  const box = scaleBox(mouth.box, width / base.w, height / base.h);
  const pasted = pasteBack(onKey, edited, box, 6, keyBackground(onKey, key));
  const patch = await resize(pasted, base.w, base.h);
  return encodeWebp(blendBox(base, patch, mouth.box), { lossless: true });
}

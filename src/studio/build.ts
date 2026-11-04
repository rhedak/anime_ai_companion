import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImageBackend } from "./backend.ts";
import { checkBackground, checkFaceEdit, checkLowerBody, type Flags } from "./checks.ts";
import { veryBlurryChance } from "./blur.ts";
import { cutout, keyBackground, toRaster, type Cutout } from "./cutout.ts";
import type { Job } from "./job.ts";
import { padBox, pasteBack, type Box } from "./paste.ts";
import type { Geometry } from "./geometry.ts";
import { blinkPrompt, emotionPrompt, EMOTIONS, POSES, talkPrompt, thinkingPrompt } from "./prompts.ts";
import { decode, encodePng, encodeWebp, flatten, makeRaster, resize, type Raster } from "./raster.ts";
import type { StudioEvent } from "./runner.ts";

/** One picture of the pack and how it is made. */
export interface FramePlan {
  name: string;
  /** The picture it is an edit of: `base`, or the name of another frame. */
  from: string;
  prompt: string;
  /** `paste`: only this box of the edit is kept; `whole`: the whole edited picture is kept. */
  mode: "paste" | "whole";
  box?: Box;
  /** The frame whose outline this one shares (its group's rest picture): a face edit shares the outline of the picture it was pasted into. */
  group: string;
}

/** The two versions of a face edit: pasted back into the base's face, or the whole picture as the model drew it. */
export type Variant = "pasted" | "whole";
const OTHER: Record<Variant, Variant> = { pasted: "whole", whole: "pasted" };

export const PACK_W = 940;
export const PACK_H = 1070;
const ATTEMPTS = 3;
/** Between one attempt and the next the seed jumps, so the same prompt gives another picture. */
const SEED_STEP = 1000;

/** What to draw, in the order it can be drawn (a frame comes after the one it edits, and what the review shows comes first). */
export function planFrames(job: Job, geometry: Geometry, w: number, h: number): FramePlan[] {
  // The pictures the review shows come first (every emotion at rest, then the poses), so they can be looked at, and the job stopped, within
  // minutes; the blinks and mouths, which are edits of those, come after.
  const rests: FramePlan[] = [];
  const details: FramePlan[] = [];
  const key = job.key;
  const padded = (b: Box) => padBox(b, 0, w, h);
  for (const emotion of EMOTIONS) {
    if (emotion === "thinking") rests.push({ name: "thinking", from: "base", prompt: thinkingPrompt(key), mode: "whole", group: "thinking" });
    else if (emotion !== "neutral") rests.push({ name: emotion, from: "base", prompt: emotionPrompt(emotion, key), mode: "paste", box: padded(geometry.face), group: "base" });
    const group = emotion === "thinking" ? "thinking" : "base";
    const rest = emotion === "neutral" ? "base" : emotion;
    details.push({ name: `${emotion}-blink`, from: rest, prompt: blinkPrompt(key), mode: "paste", box: padded(geometry.eyes), group });
    for (const level of [1, 2, 3] as const) {
      details.push({ name: `${emotion}-talk${level}`, from: rest, prompt: talkPrompt(level), mode: "paste", box: padded(geometry.mouth[level - 1]), group });
    }
  }
  for (const [name, prompt] of Object.entries(POSES)) rests.push({ name, from: "base", prompt: prompt(key), mode: "whole", group: name });
  const plans = [...rests, ...details];
  return plans;
}

export interface BuildDeps {
  dir: string;
  backend: ImageBackend;
  emit(event: StudioEvent): void;
  signal?: AbortSignal;
}

export interface FrameRecord {
  seed: number;
  attempts: number;
  /** The checks of the version in the pack. */
  flags: Flags;
  /** A face edit: true when the pack has the pasted version, false when it has the whole picture. Older records have none. */
  pasted?: boolean;
  /** A face edit: the checks of the version that is not in the pack (it can be switched to without a redraw). */
  other?: Flags;
}

/** What a redraw asks for: one seed for every picture drawn again (else the usual seeds, or the same ones with `sameSeed`), and whether face edits are pasted back. */
export interface RedrawOptions {
  seed?: number;
  pasteBack?: boolean;
}

const framesFile = (dir: string) => join(dir, "frames.json");
export async function readRecords(dir: string): Promise<Record<string, FrameRecord>> {
  try {
    return JSON.parse(await readFile(framesFile(dir), "utf8"));
  } catch {
    return {};
  }
}

async function load(dir: string, name: string, w: number, h: number): Promise<Raster> {
  return resize(await decode(await readFile(name === "base" ? join(dir, "base/chosen.png") : join(dir, `frames/${name}.png`))), w, h);
}

/** A version a face edit kept (`variants/<name>-<variant>.png`), or null when there is none (an older job). */
async function variantRaster(dir: string, name: string, variant: Variant, w: number, h: number): Promise<Raster | null> {
  const bytes = await readFile(join(dir, `variants/${name}-${variant}.png`)).catch(() => null);
  return bytes ? resize(await decode(bytes), w, h) : null;
}

/**
 * One picture: asks the model, makes both versions of a face edit (pasted back, and the whole picture), checks them, and tries again with another
 * seed when the chosen version fails a check. The pictures of both versions are returned; `chosen` is the one the pack will use.
 */
async function makeFrame(job: Job, plan: FramePlan, source: Raster, baseAlpha: Float32Array | null, deps: BuildDeps, firstAttempt: number, fixedSeed: number | undefined, chosen: Variant, allowPaste: boolean): Promise<{ pictures: Record<Variant, Raster>; flags: Record<Variant, Flags>; record: FrameRecord }> {
  const input = await encodePng(source);
  const seed0 = job.seeds[0] + hash(plan.name);
  // Paste-back needs the face areas of this character; without them (typical proportions) only the whole picture is kept.
  const paired = plan.mode === "paste" && Boolean(plan.box) && allowPaste;
  // Only a face edit has two versions: anything else is its whole picture, whatever was asked.
  const pick: Variant = paired ? chosen : "whole";
  let best: { pictures: Record<Variant, Raster>; flags: Record<Variant, Flags>; seed: number; blur: Record<Variant, number> } | null = null;
  let attempt = firstAttempt;
  for (let tries = 0; tries < (deps.backend.maxTries ?? ATTEMPTS); tries++, attempt++) {
    if (deps.signal?.aborted) throw new Error("stopped");
    const seed = fixedSeed ?? seed0 + attempt * SEED_STEP;
    const edited = await resize(await decode(await deps.backend.edit({ image: input, prompt: plan.prompt, seed, width: job.width, height: job.height }, deps.signal)), job.width, job.height);
    const cut = cutout(edited, { key: job.key });
    const wholeFlags = [...checkBackground(cut.background, job.width, job.height), ...(baseAlpha ? checkLowerBody(baseAlpha, cut.alpha, job.width, job.height) : [])];
    const pictures: Record<Variant, Raster> = { whole: edited, pasted: edited };
    const flags: Record<Variant, Flags> = { whole: wholeFlags, pasted: wholeFlags };
    if (paired && plan.box) {
      pictures.pasted = pasteBack(source, edited, plan.box, 6, keyBackground(source, job.key));
      flags.pasted = checkFaceEdit(source, pictures.pasted, plan.box);
    }
    // The blur check (src/studio/blur.ts): a soft try is flagged, so a retry is drawn; of equal tries the sharper one is kept. Measured once per version.
    const blur: Record<Variant, number> = { whole: veryBlurryChance(pictures.whole), pasted: paired ? veryBlurryChance(pictures.pasted) : 1 };
    for (const v of ["whole", "pasted"] as const) if (blur[v] >= 0.5 && (v === "whole" || paired)) flags[v] = [...flags[v], "very blurry"];
    const better = !best || flags[pick].length < best.flags[pick].length || (flags[pick].length === best.flags[pick].length && blur[pick] < best.blur[pick]);
    if (better) best = { pictures, flags, seed, blur };
    if (flags[pick].length === 0) break;
  }
  const done = best as NonNullable<typeof best>;
  const record: FrameRecord = { seed: done.seed, attempts: attempt - firstAttempt, flags: done.flags[pick] };
  if (paired) {
    record.pasted = pick === "pasted";
    record.other = done.flags[OTHER[pick]];
  }
  return { pictures: done.pictures, flags: done.flags, record };
}

/** A small number from a name, so the frames of one pack do not all start from the same seed. */
function hash(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997;
  return h;
}

/**
 * Step 2: every other picture of the pack, from the picked base. Pictures already on disk are kept (a job that stopped carries on).
 * `only` makes just those frames again (with new seeds), and every frame that was an edit of one of them. `sameSeed` names the ones of `only`
 * that are drawn again with the seed they had: the composition stays, and only what the checks found is tried again (the blur, mostly).
 */
export async function runBuild(job: Job, geometry: Geometry, deps: BuildDeps, only?: string[], sameSeed?: string[], options: RedrawOptions = {}): Promise<void> {
  const { dir, emit } = deps;
  await mkdir(join(dir, "frames"), { recursive: true });
  const plans = planFrames(job, geometry, job.width, job.height);
  const records = await readRecords(dir);
  const redo = new Set<string>();
  for (const name of only ?? []) {
    redo.add(name);
    // What was drawn from a picture is drawn again with it.
    for (const p of plans) if (redo.has(p.from)) redo.add(p.name);
  }
  const base = await load(dir, "base", job.width, job.height);
  const baseAlpha = cutout(base, { key: job.key }).alpha;
  const keepSeed = new Set(sameSeed ?? []);
  // What is already drawn (a job that was stopped and carried on) is shown again, from the thumbnails already on disk when there are some.
  for (const name of REVIEW_FRAMES) {
    const drawn = name === "neutral" || records[name] !== undefined;
    if (!drawn || redo.has(name)) continue;
    const flags = records[name]?.flags ?? [];
    const flagged = flags.length > 0;
    if (await stat(join(dir, `review/${name}.webp`)).then(() => true, () => false)) emit({ type: "preview", name, thumb: `review/${name}.webp`, flagged, flags });
    else await previewFrame(job, dir, name, name === "neutral" ? base : await load(dir, name, job.width, job.height), flags, emit);
  }
  // Only the pictures that are drawn now count: a redraw of a few says "1 of 5", not "5 of 38" with the kept ones in between.
  const todo = plans.filter((p) => records[p.name] === undefined || redo.has(p.name));
  let done = 0;
  for (const plan of plans) {
    const file = join(dir, `frames/${plan.name}.png`);
    const have = records[plan.name] !== undefined && !redo.has(plan.name);
    if (have) continue;
    done++;
    emit({ type: "status", text: `Drawing ${plan.name.replace("-", " ")} (${done} of ${todo.length})…` });
    const source = await load(dir, plan.from, job.width, job.height);
    // The pack takes the pasted version of a face edit unless the redraw says the whole picture (paste-back off).
    // Paste-back is on when the face areas were learned from the pack, and off otherwise unless the redraw asks for it.
    // Both versions of a face edit exist whenever her face areas are the pack's own; which one is in the pack follows paste-back.
    const faceAreas = geometry.from === "pack";
    const pasteOn = options.pasteBack ?? faceAreas;
    const chosen: Variant = plan.mode === "paste" && pasteOn ? "pasted" : "whole";
    // A seed given for the redraw is used for every picture drawn again; otherwise the same seed (sameSeed) or the usual ones.
    const fixed = redo.has(plan.name) && options.seed !== undefined ? options.seed : keepSeed.has(plan.name) && only?.includes(plan.name) ? records[plan.name]?.seed : undefined;
    const made = await makeFrame(job, plan, source, baseAlpha, deps, records[plan.name]?.attempts ?? 0, fixed, chosen, faceAreas);
    const picture = made.pictures[chosen];
    await writeFile(file, await encodePng(picture));
    if (plan.mode === "paste" && faceAreas) {
      // Both versions are kept, so the review can switch between them without another draw.
      await mkdir(join(dir, "variants"), { recursive: true });
      for (const v of ["pasted", "whole"] as const) await writeFile(join(dir, `variants/${plan.name}-${v}.png`), await encodePng(made.pictures[v]));
    }
    records[plan.name] = { ...made.record, attempts: (records[plan.name]?.attempts ?? 0) + made.record.attempts };
    await writeFile(framesFile(dir), JSON.stringify(records, null, 2));
    emit({ type: "frame", name: plan.name, done, total: todo.length, flags: made.record.flags });
    await previewFrame(job, dir, plan.name, picture, made.record.flags, emit);
  }
  await runAssemble(job, geometry, deps);
}

/**
 * Puts the other version of a face edit into the pack, without drawing anything, and assembles the pack again. Only what the record says
 * is the other version is used: the pictures drawn from it (its blink and mouths) are not redrawn.
 */
export async function switchVariant(job: Job, geometry: Geometry, deps: Pick<BuildDeps, "dir" | "emit">, name: string, variant: Variant): Promise<void> {
  const { dir } = deps;
  const records = await readRecords(dir);
  const rec = records[name];
  if (!rec || rec.pasted === undefined || !rec.other) throw new Error(`${name} has no other version to switch to.`);
  const wantPasted = variant === "pasted";
  if (rec.pasted === wantPasted) return;
  const bytes = await readFile(join(dir, `variants/${name}-${variant}.png`)).catch(() => null);
  if (!bytes) throw new Error(`The ${variant} version of ${name} was not kept.`);
  await writeFile(join(dir, `frames/${name}.png`), bytes);
  records[name] = { ...rec, pasted: wantPasted, flags: rec.other, other: rec.flags };
  await writeFile(framesFile(dir), JSON.stringify(records, null, 2));
  await runAssemble(job, geometry, deps);
}

/** What goes into the review: the pictures worth a look. */
/** Flagged blinks and mouths that get a tile of their own besides the eleven (a run that flags everything must not bury them). */
const MAX_EXTRA_TILES = 8;
export const REVIEW_FRAMES = [...EMOTIONS, ...Object.keys(POSES)];

const REVIEW_BACKDROP = [40, 20, 80] as const;
export const REVIEW_THUMB = 180;

/** A picture of the review, cut out on a dark backdrop: a small one for the grid and a full-size one for the pointer to enlarge. */
async function writeReview(dir: string, name: string, cut: Raster): Promise<void> {
  const dark = flatten(cut, REVIEW_BACKDROP);
  await writeFile(join(dir, `review/${name}.webp`), await encodeWebp(await resize(dark, REVIEW_THUMB, Math.round((REVIEW_THUMB * dark.h) / dark.w)), { quality: 80 }));
  await writeFile(join(dir, `review/${name}.full.webp`), await encodeWebp(dark, { quality: 85 }));
}

/** A frame as soon as it is drawn: cut out on its own (the final pack shares one outline per group, so this is only for looking at). */
async function previewFrame(job: Job, dir: string, name: string, picture: Raster, flags: string[], emit: BuildDeps["emit"]): Promise<void> {
  if (!REVIEW_FRAMES.includes(name)) return;
  await mkdir(join(dir, "review"), { recursive: true });
  await writeReview(dir, name, toRaster(picture.w, picture.h, cutout(picture, { key: job.key })));
  emit({ type: "preview", name, thumb: `review/${name}.webp`, flagged: flags.length > 0, flags });
}

/**
 * One picture on its outline: the group's outline everywhere, and the picture's own colours inside it (inside the face box for a shared
 * outline, everywhere when the picture was kept whole).
 */
function compose(picture: Raster, g: { picture: Raster; cut: Cutout }, shared: boolean, whole: boolean, face: ReturnType<typeof padBox>, w: number, h: number): Raster {
  const out = makeRaster(w, h);
  for (let i = 0; i < w * h; i++) {
    const x = i % w, y = (i - x) / w;
    const inside = !shared || whole || (x >= face[0] && x < face[2] && y >= face[1] && y < face[3]);
    // Face frames are the group's picture everywhere but the face, so the outline cannot differ from frame to frame.
    const useOwn = picture !== g.picture && inside && g.cut.alpha[i] === 1;
    for (let c = 0; c < 3; c++) out.data[i * 4 + c] = useOwn ? picture.data[i * 4 + c] : g.cut.fg[i * 3 + c];
    out.data[i * 4 + 3] = Math.round(g.cut.alpha[i] * 255);
  }
  return out;
}

/**
 * Step 3: the pack folder from the pictures: cut out, one shared outline for the pictures of a group, scaled to the pack size, lossless.
 * Also the thumbnails and the list of what the checks found, for the review. A face edit's other version is in the review too, to compare.
 */
export async function runAssemble(job: Job, geometry: Geometry, deps: Pick<BuildDeps, "dir" | "emit">): Promise<void> {
  const { dir, emit } = deps;
  emit({ type: "status", text: "Cutting her out…" });
  await mkdir(join(dir, "out"), { recursive: true });
  await mkdir(join(dir, "review"), { recursive: true });
  const w = job.width, h = job.height;
  const plans = planFrames(job, geometry, w, h);
  const records = await readRecords(dir);
  const groups = new Map<string, { picture: Raster; cut: Cutout }>();
  const groupOf = async (name: string) => {
    let g = groups.get(name);
    if (!g) {
      const picture = await load(dir, name === "base" ? "base" : name, w, h);
      g = { picture, cut: cutout(picture, { key: job.key }) };
      groups.set(name, g);
    }
    return g;
  };
  const face = padBox(geometry.face, 12, w, h);
  const everything: { name: string; picture: Raster; group: string }[] = [{ name: "neutral", picture: await load(dir, "base", w, h), group: "base" }];
  for (const plan of plans) if (records[plan.name]) everything.push({ name: plan.name, picture: await load(dir, plan.name, w, h), group: plan.group });
  const flagged: { name: string; flags: Flags }[] = [];
  const tiles: { name: string; thumb: string; flagged: boolean; flags: string[]; variant?: Variant; alt?: string; altVariant?: Variant; altFlags?: string[] }[] = [];
  let extraTiles = 0;
  for (const frame of everything) {
    const g = await groupOf(frame.group);
    const shared = frame.group === "base" || frame.group === "thinking";
    const rec = records[frame.name];
    const variant: Variant | undefined = rec?.pasted === undefined ? undefined : rec.pasted ? "pasted" : "whole";
    // A picture that is not pasted back is kept whole, everywhere inside the outline (also when no paste-back was made at all).
    const scaled = await resize(compose(frame.picture, g, shared, rec?.pasted !== true, face, w, h), PACK_W, PACK_H);
    await writeFile(join(dir, `out/${frame.name}.webp`), await encodeWebp(scaled, { lossless: true }));
    if (rec && rec.flags.length) flagged.push({ name: frame.name, flags: rec.flags });
    if (REVIEW_FRAMES.includes(frame.name) || (rec?.flags.length && ++extraTiles <= MAX_EXTRA_TILES)) {
      await writeReview(dir, frame.name, scaled);
      const tile: (typeof tiles)[number] = { name: frame.name, thumb: `review/${frame.name}.webp`, flagged: Boolean(rec?.flags.length), flags: rec?.flags ?? [] };
      if (variant && rec?.other) {
        // The other version, assembled the same way, so the review can show the two side by side.
        const altVariant = OTHER[variant];
        const alt = await variantRaster(dir, frame.name, altVariant, w, h);
        if (alt) {
          await writeReview(dir, `${frame.name}.alt`, await resize(compose(alt, g, shared, altVariant === "whole", face, w, h), PACK_W, PACK_H));
          tile.alt = `review/${frame.name}.alt.webp`;
          tile.altVariant = altVariant;
          tile.altFlags = rec.other;
        }
        tile.variant = variant;
      }
      tiles.push(tile);
    }
  }
  // The page offers paste-back only when the face areas are the pack's own (otherwise it would be placed by typical proportions).
  emit({ type: "review", tiles, flagged, pasteAvailable: geometry.from === "pack" });
}

/** Every name a pack job draws, for checking a name that came from outside (the brain's proposal, the page). */
export function knownFrameNames(): Set<string> {
  const names = new Set<string>(Object.keys(POSES));
  for (const e of EMOTIONS) {
    names.add(e);
    names.add(`${e}-blink`);
    for (const k of [1, 2, 3]) names.add(`${e}-talk${k}`);
  }
  names.delete("neutral"); // the base picture is not drawn again here
  return names;
}

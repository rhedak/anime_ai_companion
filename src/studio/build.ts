import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImageBackend } from "./backend.ts";
import { checkBackground, checkFaceEdit, checkLowerBody, type Flags } from "./checks.ts";
import { cutout, type Cutout } from "./cutout.ts";
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

export const PACK_W = 940;
export const PACK_H = 1070;
const ATTEMPTS = 3;
/** Between one attempt and the next the seed jumps, so the same prompt gives another picture. */
const SEED_STEP = 1000;

/** What to draw, in the order it can be drawn (a frame comes after the one it edits). */
export function planFrames(job: Job, geometry: Geometry, w: number, h: number): FramePlan[] {
  const plans: FramePlan[] = [];
  const key = job.key;
  const padded = (b: Box) => padBox(b, 0, w, h);
  for (const emotion of EMOTIONS) {
    if (emotion === "thinking") plans.push({ name: "thinking", from: "base", prompt: thinkingPrompt(key), mode: "whole", group: "thinking" });
    else if (emotion !== "neutral") plans.push({ name: emotion, from: "base", prompt: emotionPrompt(emotion, key), mode: "paste", box: padded(geometry.face), group: "base" });
    const group = emotion === "thinking" ? "thinking" : "base";
    const rest = emotion === "neutral" ? "base" : emotion;
    plans.push({ name: `${emotion}-blink`, from: rest, prompt: blinkPrompt(key), mode: "paste", box: padded(geometry.eyes), group });
    for (const level of [1, 2, 3] as const) {
      plans.push({ name: `${emotion}-talk${level}`, from: rest, prompt: talkPrompt(level), mode: "paste", box: padded(geometry.mouth[level - 1]), group });
    }
  }
  for (const [name, prompt] of Object.entries(POSES)) plans.push({ name, from: "base", prompt: prompt(key), mode: "whole", group: name });
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
  flags: Flags;
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

/** One picture: asks the model, keeps the part that was asked for, checks it, and tries again with another seed when a check fails. */
async function makeFrame(job: Job, plan: FramePlan, source: Raster, baseAlpha: Float32Array | null, deps: BuildDeps, firstAttempt: number): Promise<{ picture: Raster; record: FrameRecord }> {
  const input = await encodePng(source);
  const seed0 = job.seeds[0] + hash(plan.name);
  let best: { picture: Raster; flags: Flags; seed: number } | null = null;
  let attempt = firstAttempt;
  for (let tries = 0; tries < ATTEMPTS; tries++, attempt++) {
    if (deps.signal?.aborted) throw new Error("stopped");
    const seed = seed0 + attempt * SEED_STEP;
    const edited = await resize(await decode(await deps.backend.edit({ image: input, prompt: plan.prompt, seed, width: job.width, height: job.height }, deps.signal)), job.width, job.height);
    let picture: Raster;
    let flags: Flags;
    if (plan.mode === "paste" && plan.box) {
      picture = pasteBack(source, edited, plan.box);
      flags = checkFaceEdit(source, picture, plan.box);
    } else {
      picture = edited;
      const cut = cutout(edited, { key: job.key });
      flags = [...checkBackground(cut.background, job.width, job.height), ...(baseAlpha ? checkLowerBody(baseAlpha, cut.alpha, job.width, job.height) : [])];
    }
    if (!best || flags.length < best.flags.length) best = { picture, flags, seed };
    if (flags.length === 0) break;
  }
  const chosen = best as NonNullable<typeof best>;
  return { picture: chosen.picture, record: { seed: chosen.seed, attempts: attempt - firstAttempt, flags: chosen.flags } };
}

/** A small number from a name, so the frames of one pack do not all start from the same seed. */
function hash(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997;
  return h;
}

/**
 * Step 2: every other picture of the pack, from the picked base. Pictures already on disk are kept (a job that stopped carries on).
 * `only` makes just those frames again (with new seeds), and every frame that was an edit of one of them.
 */
export async function runBuild(job: Job, geometry: Geometry, deps: BuildDeps, only?: string[]): Promise<void> {
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
  let done = 0;
  for (const plan of plans) {
    done++;
    const file = join(dir, `frames/${plan.name}.png`);
    const have = records[plan.name] !== undefined && !redo.has(plan.name);
    if (have) continue;
    emit({ type: "status", text: `Drawing ${plan.name.replace("-", " ")} (${done} of ${plans.length})…` });
    const source = await load(dir, plan.from, job.width, job.height);
    const made = await makeFrame(job, plan, source, plan.mode === "whole" ? baseAlpha : null, deps, records[plan.name]?.attempts ?? 0);
    await writeFile(file, await encodePng(made.picture));
    records[plan.name] = { ...made.record, attempts: (records[plan.name]?.attempts ?? 0) + made.record.attempts };
    await writeFile(framesFile(dir), JSON.stringify(records, null, 2));
    emit({ type: "frame", name: plan.name, done, total: plans.length, flags: made.record.flags });
  }
  await runAssemble(job, geometry, deps);
}

/** What goes into the review: the pictures worth a look. */
export const REVIEW_FRAMES = [...EMOTIONS, ...Object.keys(POSES)];

/**
 * Step 3: the pack folder from the pictures: cut out, one shared outline for the pictures of a group, scaled to the pack size, lossless.
 * Also the thumbnails and the list of what the checks found, for the review.
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
  const tiles: { name: string; thumb: string; flagged: boolean }[] = [];
  for (const frame of everything) {
    const g = await groupOf(frame.group);
    const out = makeRaster(w, h);
    const shared = frame.group === "base" || frame.group === "thinking";
    for (let i = 0; i < w * h; i++) {
      const x = i % w, y = (i - x) / w;
      const inside = !shared || (x >= face[0] && x < face[2] && y >= face[1] && y < face[3]);
      // Face frames are the group's picture everywhere but the face, so the outline cannot differ from frame to frame.
      const useOwn = frame.picture !== g.picture && inside && g.cut.alpha[i] === 1;
      for (let c = 0; c < 3; c++) out.data[i * 4 + c] = useOwn ? frame.picture.data[i * 4 + c] : g.cut.fg[i * 3 + c];
      out.data[i * 4 + 3] = Math.round(g.cut.alpha[i] * 255);
    }
    const scaled = await resize(out, PACK_W, PACK_H);
    await writeFile(join(dir, `out/${frame.name}.webp`), await encodeWebp(scaled, { lossless: true }));
    const rec = records[frame.name];
    if (rec && rec.flags.length) flagged.push({ name: frame.name, flags: rec.flags });
    if (REVIEW_FRAMES.includes(frame.name)) {
      const dark = flatten(await resize(out, 180, Math.round((180 * h) / w)), [40, 20, 80]);
      await writeFile(join(dir, `review/${frame.name}.webp`), await encodeWebp(dark, { quality: 80 }));
      tiles.push({ name: frame.name, thumb: `review/${frame.name}.webp`, flagged: Boolean(rec?.flags.length) });
    }
  }
  emit({ type: "review", tiles, flagged });
}

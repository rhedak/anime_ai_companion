import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImageBackend } from "./backend.ts";
import { keyRgb, outfitPrompt, referenceCharacterPrompt, referenceOutfitPrompt, stepPrompt } from "./prompts.ts";
import { decode, encodePng, encodeWebp, flatten, resize } from "./raster.ts";
import { deriveGeometry } from "./geometry.ts";
import type { Job } from "./job.ts";

/** What the runner tells the service as it goes. Paths are relative to the job's folder. */
export type StudioEvent =
  | { type: "status"; text: string }
  | { type: "candidate"; seed: number; file: string; thumb: string; done: number; total: number }
  | { type: "base-done" }
  /** One step of an edit chain (see runStep): picture `seed` of step `n`, in the step's folder. */
  | { type: "step-candidate"; n: number; seed: number; file: string; thumb: string; done: number; total: number }
  | { type: "step-done"; n: number }
  | { type: "frame"; name: string; done: number; total: number; flags: string[] }
  | { type: "preview"; name: string; thumb: string; flagged: boolean; flags: string[] }
  | { type: "review"; tiles: { name: string; thumb: string; flagged: boolean; flags: string[]; variant?: "pasted" | "whole"; alt?: string; altVariant?: "pasted" | "whole"; altFlags?: string[] }[]; flagged: { name: string; flags: string[] }[]; pasteAvailable?: boolean }
  /** What the pack has cost so far, in dollars (a paid backend only). */
  | { type: "spend"; usd: number }
  /** The by-hand maker waits for the user to give picture `n` back (its files are in `assist/` of the job's folder). */
  | { type: "assist"; n: number; prompt: string; error?: string }
  | { type: "error"; message: string };

export interface RunDeps {
  /** data/studio/<id>/ */
  dir: string;
  backend: ImageBackend;
  emit(event: StudioEvent): void;
  signal?: AbortSignal;
  /** The source pack's neutral picture as it is on disk (any format sharp reads). */
  source: Buffer;
  /** Its blink and mouth pictures, when it has them: the face area is learned from how they differ from the rest picture. */
  sourceFrames?: { blink?: Buffer; talk: (Buffer | undefined)[] };
}

export const THUMB_WIDTH = 240;

/**
 * Step 1 of a redraw: the new neutral picture. The source pack's neutral goes onto the key colour, the model changes the outfit once for
 * each seed, and the user picks one (nothing else is made before that: it is the cheapest place to fail, and every other picture is an edit of it).
 */
export async function runBase(job: Job, deps: RunDeps): Promise<void> {
  const { dir, backend, emit, signal } = deps;
  await mkdir(join(dir, "base"), { recursive: true });
  emit({ type: "status", text: "Preparing the reference picture…" });
  const source = await decode(deps.source);
  const reference = await resize(flatten(source, keyRgb(job.key)), job.width, job.height);
  const referencePng = await encodePng(reference);
  await writeFile(join(dir, "source.png"), referencePng);
  const white = [255, 255, 255] as const;
  const flat = async (b?: Buffer) => (b ? flatten(await decode(b), white) : undefined);
  const rest = flatten(source, white);
  const geometry = deriveGeometry(
    { rest, blink: await flat(deps.sourceFrames?.blink), talk: await Promise.all((deps.sourceFrames?.talk ?? []).map(flat)) },
    job.width,
    job.height,
  );
  await writeFile(join(dir, "geometry.json"), JSON.stringify(geometry, null, 2));
  emit({ type: "status", text: geometry.from === "pack" ? "Learned where her face is from the pack's own blink and mouth pictures." : "The pack has no blink and mouth pictures to learn her face from; using typical proportions." });
  // With a reference picture the model sees the base first and the reference second (image 1 and image 2 in the words); without one it is the old one-picture outfit change.
  const referenceFile = job.reference ? await readFile(join(dir, "reference.png")) : null;
  const prompt = referenceFile ? (job.reference === "character" ? referenceCharacterPrompt(job.key) : referenceOutfitPrompt(job.key)) : outfitPrompt(job.outfit, job.key);
  let done = 0;
  for (const seed of job.seeds) {
    if (signal?.aborted) return;
    emit({ type: "status", text: `Drawing the new ${job.reference === "character" ? "character" : "outfit"} (${done + 1} of ${job.seeds.length})…` });
    const out = await backend.edit({ image: referencePng, ...(referenceFile ? { references: [referenceFile] } : {}), prompt, seed, width: job.width, height: job.height }, signal);
    const picture = await resize(await decode(out), job.width, job.height);
    const file = `base/seed-${seed}.png`;
    const thumb = `base/seed-${seed}.thumb.webp`;
    await writeFile(join(dir, file), await encodePng(picture));
    const tw = THUMB_WIDTH;
    await writeFile(join(dir, thumb), await encodeWebp(await resize(picture, tw, Math.round((tw * job.height) / job.width)), { quality: 80 }));
    await writeFile(join(dir, `base/seed-${seed}.full.webp`), await encodeWebp(picture, { quality: 85 })); // what the page shows when the pointer is over the small one
    done++;
    emit({ type: "candidate", seed, file, thumb, done, total: job.seeds.length });
  }
  emit({ type: "base-done" });
}

/**
 * One step of an edit chain on a base that is not approved yet: one change (a hair colour, a haircut, the head, one piece of clothing),
 * drawn once per seed from the picture `input` (a file in the job's folder). Each step is kept in `steps/<n>/`; the service copies the one
 * the user keeps to `base/chosen.png`, so the chain of steps is what the user approves, and nothing reaches the pack before that.
 */
export interface StepRequest {
  n: number;
  /** What changes, in words (see stepPrompt): one thing. */
  change: string;
  /** The picture to change, relative to the job's folder (the base, or a step's picture that the user kept). */
  input: string;
  /** Optional picture the change is taken from (image 2 in the words), e.g. a jacket or a haircut. */
  reference?: Buffer;
  seeds: number[];
}

export async function runStep(job: Job, step: StepRequest, deps: RunDeps): Promise<void> {
  const { dir, backend, emit, signal } = deps;
  const folder = join(dir, "steps", String(step.n));
  await mkdir(folder, { recursive: true });
  const input = await encodePng(await resize(await decode(await readFile(join(dir, step.input))), job.width, job.height));
  const prompt = stepPrompt(step.change, job.key);
  let done = 0;
  for (const seed of step.seeds) {
    if (signal?.aborted) return;
    emit({ type: "status", text: `Step ${step.n}: drawing "${step.change}" (${done + 1} of ${step.seeds.length})…` });
    const out = await backend.edit({ image: input, ...(step.reference ? { references: [step.reference] } : {}), prompt, seed, width: job.width, height: job.height }, signal);
    const picture = await resize(await decode(out), job.width, job.height);
    const file = `steps/${step.n}/seed-${seed}.png`;
    const thumb = `steps/${step.n}/seed-${seed}.thumb.webp`;
    await writeFile(join(dir, file), await encodePng(picture));
    await writeFile(join(dir, thumb), await encodeWebp(await resize(picture, THUMB_WIDTH, Math.round((THUMB_WIDTH * job.height) / job.width)), { quality: 80 }));
    done++;
    emit({ type: "step-candidate", n: step.n, seed, file, thumb, done, total: step.seeds.length });
  }
  emit({ type: "step-done", n: step.n });
}

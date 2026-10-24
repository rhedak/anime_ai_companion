import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImageBackend } from "./backend.ts";
import { keyRgb, outfitPrompt } from "./prompts.ts";
import { decode, encodePng, encodeWebp, flatten, resize } from "./raster.ts";
import type { Job } from "./job.ts";

/** What the runner tells the service as it goes. Paths are relative to the job's folder. */
export type StudioEvent =
  | { type: "status"; text: string }
  | { type: "candidate"; seed: number; file: string; thumb: string; done: number; total: number }
  | { type: "base-done" }
  | { type: "error"; message: string };

export interface RunDeps {
  /** data/studio/<id>/ */
  dir: string;
  backend: ImageBackend;
  emit(event: StudioEvent): void;
  signal?: AbortSignal;
  /** The source pack's neutral picture as it is on disk (any format sharp reads). */
  source: Buffer;
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
  const prompt = outfitPrompt(job.outfit, job.key);
  let done = 0;
  for (const seed of job.seeds) {
    if (signal?.aborted) return;
    emit({ type: "status", text: `Drawing the new outfit (${done + 1} of ${job.seeds.length})…` });
    const out = await backend.edit({ image: referencePng, prompt, seed, width: job.width, height: job.height }, signal);
    const picture = await resize(await decode(out), job.width, job.height);
    const file = `base/seed-${seed}.png`;
    const thumb = `base/seed-${seed}.thumb.webp`;
    await writeFile(join(dir, file), await encodePng(picture));
    const tw = THUMB_WIDTH;
    await writeFile(join(dir, thumb), await encodeWebp(await resize(picture, tw, Math.round((tw * job.height) / job.width)), { quality: 80 }));
    done++;
    emit({ type: "candidate", seed, file, thumb, done, total: job.seeds.length });
  }
  emit({ type: "base-done" });
}

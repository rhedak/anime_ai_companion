import { parentPort, workerData } from "node:worker_threads";
import { makeBackend } from "./backend.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runAssemble, runBuild, switchVariant } from "./build.ts";
import type { Geometry } from "./geometry.ts";
import { runBase, runStep, type StudioEvent } from "./runner.ts";
import { parseJob } from "./job.ts";

/** Runs one phase of a job off the server's thread. The service starts it with `{ phase, dir, job, source }` and stops it with `terminate()`. */
const port = parentPort;
if (!port) throw new Error("studio-worker.ts is a worker thread");
const send = (event: StudioEvent | { type: "finished" }) => port.postMessage(event);

try {
  // A job may be given other seeds for this run (a base drawn again with new ones: studio-service.ts moreBase).
  const parsed = parseJob(Array.isArray(workerData.seeds) ? { ...workerData.job, seeds: workerData.seeds } : workerData.job);
  if (!parsed.ok) throw new Error(parsed.reason);
  const backend = makeBackend(parsed.job.backend.url, {
    dir: workerData.dir,
    limitUsd: Number(workerData.limitUsd) || 0,
    spentUsd: Number(workerData.spentUsd) || 0,
    onSpend: (usd) => send({ type: "spend", usd }),
    onAssist: (request) => send({ type: "assist", ...request }),
  });
  if (workerData.phase === "base") {
    const frames = workerData.sourceFrames as { blink?: Uint8Array; talk: (Uint8Array | undefined)[] } | undefined;
    await runBase(parsed.job, {
      dir: workerData.dir,
      backend,
      emit: send,
      source: Buffer.from(workerData.source),
      sourceFrames: frames && { blink: frames.blink && Buffer.from(frames.blink), talk: frames.talk.map((t) => (t ? Buffer.from(t) : undefined)) },
    });
  } else if (workerData.phase === "build") {
    const geometry = JSON.parse(await readFile(join(workerData.dir, "geometry.json"), "utf8")) as Geometry;
    await runBuild(parsed.job, geometry, { dir: workerData.dir, backend, emit: send }, Array.isArray(workerData.only) ? workerData.only.map(String) : undefined, Array.isArray(workerData.sameSeed) ? workerData.sameSeed.map(String) : undefined, {
      seed: typeof workerData.options?.seed === "number" ? workerData.options.seed : undefined,
      // Undefined when the run does not say (a build that carries on): the choice saved in the job's folder decides, off at the start.
      pasteBack: typeof workerData.options?.pasteBack === "boolean" ? workerData.options.pasteBack : undefined,
    });
  } else if (workerData.phase === "step") {
    const step = workerData.step as { n: number; change: string; input: string; reference?: string; seeds: number[] };
    await runStep(parsed.job, { n: step.n, change: step.change, input: step.input, reference: step.reference ? await readFile(join(workerData.dir, step.reference)) : undefined, seeds: step.seeds }, {
      dir: workerData.dir,
      backend,
      emit: send,
      source: Buffer.alloc(0),
    });
  } else if (workerData.phase === "assemble") {
    const geometry = JSON.parse(await readFile(join(workerData.dir, "geometry.json"), "utf8")) as Geometry;
    // A version switched in the review (`switchTo`) is put into the pack first; the pack is then assembled again either way.
    const switchTo = workerData.switchTo as { name: string; variant: "pasted" | "whole" } | undefined;
    if (switchTo) await switchVariant(parsed.job, geometry, { dir: workerData.dir, emit: send }, String(switchTo.name), switchTo.variant === "whole" ? "whole" : "pasted");
    else await runAssemble(parsed.job, geometry, { dir: workerData.dir, emit: send });
  } else {
    throw new Error(`Unknown phase ${String(workerData.phase)}.`);
  }
  send({ type: "finished" });
} catch (error) {
  send({ type: "error", message: error instanceof Error ? error.message : String(error) });
}

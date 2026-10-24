import { parentPort, workerData } from "node:worker_threads";
import { makeBackend } from "./backend.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runAssemble, runBuild } from "./build.ts";
import type { Geometry } from "./geometry.ts";
import { runBase, type StudioEvent } from "./runner.ts";
import { parseJob } from "./job.ts";

/** Runs one phase of a job off the server's thread. The service starts it with `{ phase, dir, job, source }` and stops it with `terminate()`. */
const port = parentPort;
if (!port) throw new Error("studio-worker.ts is a worker thread");
const send = (event: StudioEvent | { type: "finished" }) => port.postMessage(event);

try {
  const parsed = parseJob(workerData.job);
  if (!parsed.ok) throw new Error(parsed.reason);
  const backend = makeBackend(parsed.job.backend.url, {
    limitUsd: Number(workerData.limitUsd) || 0,
    spentUsd: Number(workerData.spentUsd) || 0,
    onSpend: (usd) => send({ type: "spend", usd }),
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
    await runBuild(parsed.job, geometry, { dir: workerData.dir, backend, emit: send }, Array.isArray(workerData.only) ? workerData.only.map(String) : undefined);
  } else if (workerData.phase === "assemble") {
    const geometry = JSON.parse(await readFile(join(workerData.dir, "geometry.json"), "utf8")) as Geometry;
    await runAssemble(parsed.job, geometry, { dir: workerData.dir, emit: send });
  } else {
    throw new Error(`Unknown phase ${String(workerData.phase)}.`);
  }
  send({ type: "finished" });
} catch (error) {
  send({ type: "error", message: error instanceof Error ? error.message : String(error) });
}

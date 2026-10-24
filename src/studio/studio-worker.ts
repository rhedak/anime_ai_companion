import { parentPort, workerData } from "node:worker_threads";
import { httpBackend } from "./backend.ts";
import { runBase, type StudioEvent } from "./runner.ts";
import { parseJob } from "./job.ts";

/** Runs one phase of a job off the server's thread. The service starts it with `{ phase, dir, job, source }` and stops it with `terminate()`. */
const port = parentPort;
if (!port) throw new Error("studio-worker.ts is a worker thread");
const send = (event: StudioEvent | { type: "finished" }) => port.postMessage(event);

try {
  const parsed = parseJob(workerData.job);
  if (!parsed.ok) throw new Error(parsed.reason);
  const backend = httpBackend(parsed.job.backend.url);
  if (workerData.phase === "base") {
    await runBase(parsed.job, { dir: workerData.dir, backend, emit: send, source: Buffer.from(workerData.source) });
  } else {
    throw new Error(`Unknown phase ${String(workerData.phase)}.`);
  }
  send({ type: "finished" });
} catch (error) {
  send({ type: "error", message: error instanceof Error ? error.message : String(error) });
}

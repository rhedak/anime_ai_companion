/**
 * The renderer's thread: a message loop around `handle` (src/render-ops.ts), started by AvatarService as a worker thread.
 *
 * It takes the place of the Python child process the app used to run, with the same shape: one request in, one reply out, as JSON text
 *   {"id": 2, "op": "base", "name": "linnea"}  ->  {"ok": true, "character": {...}, "id": 2}
 * A request that fails is a reply with {"ok": false, "error": "ClassName: text"}, never an exception, so one bad request cannot end
 * the thread. A render that never ends is cut off from outside: AvatarService terminates this thread after 15 seconds and starts another.
 *
 * `workerData.creatorSrc` is the creator's `ts/src` folder, loaded here by path (src/creator.ts says where it is).
 */
import { parentPort, workerData } from "node:worker_threads";
import { createRenderOps, loadCreator } from "./render-ops.ts";

if (!parentPort) throw new Error("src/render-worker.ts runs as a worker thread (AvatarService starts it)");
const port = parentPort;

const ops = createRenderOps(await loadCreator((workerData as { creatorSrc: string }).creatorSrc));
port.on("message", (line: string) => {
  port.postMessage(ops.handleLine(line));
});

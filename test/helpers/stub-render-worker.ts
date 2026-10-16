/**
 * A renderer thread for tests that goes wrong on purpose. It is src/render-worker.ts (the real renderer) except for the first `frames`
 * request ever made, which does what STUB_RENDER_MODE says:
 *   hang   never answers: it spins, writing a line to STUB_RENDER_LOG every few milliseconds, so a test can see when it is really gone
 *   exit   ends the thread with process.exit(3)
 *   throw  lets an exception escape the message handler
 * "First ever" is kept in the file STUB_RENDER_FLAG (a thread that replaces this one finds it and behaves). Every start is logged too.
 */
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { parentPort, threadId, workerData } from "node:worker_threads";
import { loadCreator } from "../../src/creator-load.ts";
import { createRenderOps } from "../../src/render-ops.ts";

const port = parentPort!;
const log = process.env.STUB_RENDER_LOG as string;
const flag = process.env.STUB_RENDER_FLAG as string;
appendFileSync(log, `start ${threadId}\n`);

const ops = createRenderOps(await loadCreator((workerData as { creatorSrc: string }).creatorSrc));
port.on("message", (line: string) => {
  if (JSON.parse(line).op === "frames" && !existsSync(flag)) {
    writeFileSync(flag, "gone wrong once");
    if (process.env.STUB_RENDER_MODE === "exit") process.exit(3);
    if (process.env.STUB_RENDER_MODE === "throw") throw new Error("the renderer broke");
    for (;;) {
      appendFileSync(log, `spin ${threadId}\n`);
      const until = Date.now() + 10;
      while (Date.now() < until);
    }
  }
  port.postMessage(ops.handleLine(line));
});

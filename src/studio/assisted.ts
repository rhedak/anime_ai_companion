import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BackendInfo, EditRequest, ImageBackend } from "./backend.ts";
import { decode } from "./raster.ts";

/**
 * The image maker that is a person: for each picture the app puts the picture and the words in `<dir>/assist/`, tells the page (`onAssist`), and waits for the
 * result. The user draws it on any website or tool they like and gives the picture back (dropped or pasted into the panel, or saved into that folder as
 * `<n>-out.png`). Nothing here talks to a site, drives a browser or needs a brain, so it works with every one, costs nothing in this app and breaks when no site
 * changes. It is slow by nature: one picture at a time, at the user's pace, with no time limit (stopping the job ends the wait).
 *
 * The hand-over is a folder, not a message, so it behaves the same in the studio's worker thread and in the main thread (a single picture drawn again).
 */

export interface AssistRequest {
  /** The number of this picture in this run; the files are `<n>-in.png`, `<n>-prompt.txt` and (the answer) `<n>-out.*`. */
  n: number;
  prompt: string;
  /** What was wrong with the last thing given back for this picture, if anything: the same request is announced again with it. */
  error?: string;
}

export interface AssistedOptions {
  /** The job's folder (or a single picture's working folder): the files go in its `assist/`. */
  dir: string;
  onAssist(request: AssistRequest): void;
  pollMs?: number;
}

const OUT = /^(\d+)-out\.(png|jpe?g|webp)$/i;

export const assistFolder = (dir: string): string => join(dir, "assist");

export function assistedBackend(options: AssistedOptions): ImageBackend {
  const folder = assistFolder(options.dir);
  const pollMs = options.pollMs ?? 400;
  let counter = 0;

  /** The answer to picture `n`, once a file for it has been written completely (a size that stops changing), else null. */
  async function answer(n: number): Promise<{ name: string; bytes: Buffer } | null> {
    const names = (await readdir(folder).catch(() => [] as string[])).filter((f) => Number(OUT.exec(f)?.[1]) === n);
    for (const name of names) {
      const first = await stat(join(folder, name)).catch(() => null);
      if (!first || !first.isFile() || first.size === 0) continue;
      await new Promise((r) => setTimeout(r, 120));
      const second = await stat(join(folder, name)).catch(() => null);
      if (second && second.size === first.size) return { name, bytes: await readFile(join(folder, name)) };
    }
    return null;
  }

  return {
    // A person decides after seeing it: one try each, and a picture that fails a check is shown in the review to be done again by hand.
    maxTries: 1,
    async info(): Promise<BackendInfo> {
      return { name: "your own choice of website or tool, drawn by hand", model: null, revision: null, licence: null, edit: true, generate: false, assisted: true };
    },
    async edit(req: EditRequest, signal?: AbortSignal): Promise<Buffer> {
      const n = ++counter;
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, `${n}-in.png`), req.image);
      const refs = (req.references ?? []).map((_, i) => `${n}-ref-${i + 1}.png`);
      await Promise.all((req.references ?? []).map((r, i) => writeFile(join(folder, refs[i]), r)));
      await writeFile(join(folder, `${n}-prompt.txt`), req.prompt);
      try {
        let request: AssistRequest = { n, prompt: req.prompt };
        options.onAssist(request);
        for (;;) {
          if (signal?.aborted) throw Object.assign(new Error("stopped"), { name: "AbortError" });
          const got = await answer(n);
          if (got) {
            try {
              await decode(got.bytes);
              return got.bytes;
            } catch {
              // Not a picture (a file of another kind, cut short): the file goes, and the page is asked again with what went wrong.
              await rm(join(folder, got.name), { force: true });
              request = { n, prompt: req.prompt, error: "That file is not a picture the app can read. Give it a PNG, JPEG or WebP." };
              options.onAssist(request);
            }
          }
          await new Promise<void>((resolve) => {
            const timer = setTimeout(done, pollMs);
            const onAbort = () => done();
            signal?.addEventListener("abort", onAbort, { once: true });
            function done() {
              clearTimeout(timer);
              signal?.removeEventListener("abort", onAbort);
              resolve();
            }
          });
        }
      } finally {
        await Promise.all([`${n}-in.png`, `${n}-prompt.txt`, ...refs, ...(await readdir(folder).catch(() => [] as string[])).filter((f) => Number(OUT.exec(f)?.[1]) === n)].map((f) => rm(join(folder, f), { force: true })));
      }
    },
    async generate(): Promise<Buffer> {
      throw new Error("Drawing by hand only changes a picture.");
    },
  };
}

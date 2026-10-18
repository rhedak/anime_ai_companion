import { readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Helpers for tests that touch the file system or start programs, so the same suite runs on macOS, Linux and Windows. Nothing is skipped on Windows
 * any more: a test that has to say something in a system's own words (a shell command, a permission bit, a path) branches on
 * `process.platform` inside the test and still asserts the same thing. See also standin.ts for the fake `claude`, `opencode` and `cursor-agent`.
 */

/**
 * A link to a folder. On Windows a real symlink needs Developer Mode or an administrator, a junction does not, and both resolve through
 * `realpath` the way the code under test expects; elsewhere this is an ordinary symlink (the type argument is ignored).
 */
export function symlinkDir(target: string, path: string): void {
  symlinkSync(target, path, "junction");
}

/**
 * Deletes a test's scratch folder. On Windows a folder whose programs have only just ended can stay held for a while (the virus scanner and the
 * indexer open new files), so it is tried again for several seconds, and a folder that is still held then is left in the temp folder with a note
 * instead of failing a test that already passed. Elsewhere it is a plain `rmSync` and any error is real.
 */
export function removeDir(dir: string): void {
  // `rmSync`'s own `maxRetries` does nothing here (the synchronous call gives up at once), so the waiting is done by hand.
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (process.platform !== "win32" || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw err;
      if (Date.now() >= deadline) {
        console.warn(`note: could not delete ${dir} (${code}); it is left in the temp folder`);
        return;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

/** Deletes scratch folders that an earlier run could not (see removeDir): anything in the temp folder with this prefix that is older than ten minutes. */
export function sweepStale(prefix: string, keep: string[] = []): void {
  const root = tmpdir();
  for (const name of readdirSync(root)) {
    if (!name.startsWith(prefix) || keep.includes(name)) continue;
    const path = join(root, name);
    try {
      if (Date.now() - statSync(path).mtimeMs > 10 * 60_000) removeDir(path);
    } catch {
      // gone already, or still held: the next run tries again
    }
  }
}

/** A link to a file, or null when Windows will not make one without privileges (the test that needs it should then skip). */
export function trySymlinkFile(target: string, path: string): boolean {
  try {
    symlinkSync(target, path, "file");
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EPERM") return false;
    throw err;
  }
}

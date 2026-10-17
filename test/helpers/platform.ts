import { readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The tests that assume a POSIX machine (stand-in programs written as shell scripts, `ls`, `/`-separated fake paths, file permission bits)
 * are skipped on Windows until Windows has been tried for real. The rest of the suite runs there, so the Windows CI job still guards it.
 * Remove a skip when its test has been made portable.
 */
export const winSkip: string | false = process.platform === "win32" ? "assumes a POSIX machine; not yet ported to Windows" : false;

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
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (process.platform === "win32" && (code === "EPERM" || code === "EBUSY" || code === "EACCES")) {
      console.warn(`note: could not delete ${dir} (${code}); it is left in the temp folder`);
      return;
    }
    throw err;
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

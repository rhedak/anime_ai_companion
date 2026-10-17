import { symlinkSync } from "node:fs";

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

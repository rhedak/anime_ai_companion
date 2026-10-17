/**
 * The tests that assume a POSIX machine (stand-in programs written as shell scripts, `ls`, `/`-separated fake paths, file permission bits)
 * are skipped on Windows until Windows has been tried for real. The rest of the suite runs there, so the Windows CI job still guards it.
 * Remove a skip when its test has been made portable.
 */
export const winSkip: string | false = process.platform === "win32" ? "assumes a POSIX machine; not yet ported to Windows" : false;

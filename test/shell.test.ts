import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runShell, shellDisabled } from "../src/shell.ts";
import { removeDir } from "./helpers/platform.ts";

// The command line is the user's shell's own: sh on macOS and Linux, cmd.exe on Windows. The tests say the same things in each one's words, and use
// Node (always on the PATH here) for what both can run the same way.
const win = process.platform === "win32";
const node = (script: string) => `node -e "${script}"`;

test("runs in the given folder and reports output and exit code", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shell-"));
  try {
    await writeFile(join(dir, "marker.txt"), "x");
    const ls = await runShell(win ? "dir /b" : "ls", dir);
    assert.equal(ls.code, 0);
    assert.equal(ls.output.trim(), "marker.txt");
    const bad = await runShell(win ? "echo oops 1>&2 & exit 3" : "echo oops >&2; exit 3", dir);
    assert.deepEqual([bad.code, bad.output.trim()], [3, "oops"]);
  } finally {
    removeDir(dir);
  }
});

test("has no input, no colour codes, and caps the output", async () => {
  // Nothing is typed to it: a command that reads its input sees the end at once and goes on.
  const stdin = await runShell(win ? 'findstr "^" & echo done' : "cat; echo done", tmpdir(), { timeoutMs: 5000 });
  assert.equal(stdin.output.trim(), "done");
  const colour = await runShell(node("process.stdout.write(String.fromCharCode(27)+'[31mred'+String.fromCharCode(27)+'[0m')"), tmpdir());
  assert.equal(colour.output, "red");
  const big = await runShell(node("process.stdout.write('a'.repeat(5000))"), tmpdir(), { maxBytes: 100 });
  assert.equal(big.output.length, 100);
  assert.equal(big.truncated, true);
});

test("a command that runs too long is killed with everything it started", async () => {
  const started = Date.now();
  // Two long-running programs, one of them started in the background: both must go.
  const slow = await runShell(win ? `start /b ${node("setTimeout(() => {}, 30000)")} & ${node("setTimeout(() => {}, 30000)")}` : "sleep 30 & sleep 30", tmpdir(), { timeoutMs: 300 });
  assert.equal(slow.timedOut, true);
  assert.equal(slow.code, null);
  assert.ok(Date.now() - started < 5000);
});

test("COMPANION_NO_SHELL turns the !command box off, for the usual spellings of yes", () => {
  assert.equal(shellDisabled({}), false);
  assert.equal(shellDisabled({ COMPANION_NO_SHELL: "" }), false);
  assert.equal(shellDisabled({ COMPANION_NO_SHELL: "0" }), false);
  for (const on of ["1", "true", "TRUE", " yes ", "on"]) assert.equal(shellDisabled({ COMPANION_NO_SHELL: on }), true, on);
});

import { winSkip } from "./helpers/platform.ts";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runShell, shellDisabled } from "../src/shell.ts";

test("runs in the given folder and reports output and exit code", { skip: winSkip }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "shell-"));
  try {
    await writeFile(join(dir, "marker.txt"), "x");
    const ls = await runShell("ls", dir);
    assert.equal(ls.code, 0);
    assert.equal(ls.output.trim(), "marker.txt");
    const bad = await runShell("echo oops >&2; exit 3", dir);
    assert.deepEqual([bad.code, bad.output.trim()], [3, "oops"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("has no input, no colour codes, and caps the output", { skip: winSkip }, async () => {
  const stdin = await runShell("cat; echo done", tmpdir(), { timeoutMs: 5000 });
  assert.equal(stdin.output.trim(), "done"); // cat saw end of input at once
  const colour = await runShell("printf '\\033[31mred\\033[0m'", tmpdir());
  assert.equal(colour.output, "red");
  const big = await runShell("head -c 5000 /dev/zero | tr '\\0' a", tmpdir(), { maxBytes: 100 });
  assert.equal(big.output.length, 100);
  assert.equal(big.truncated, true);
});

test("a command that runs too long is killed with everything it started", { skip: winSkip }, async () => {
  const started = Date.now();
  const slow = await runShell("sleep 30 & sleep 30", tmpdir(), { timeoutMs: 300 });
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

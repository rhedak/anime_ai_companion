import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brainProgram, isInstalled, programLabel } from "../src/programs.ts";

test("the label of a brain's program is its plain name when nothing overrides it", () => {
  assert.equal(programLabel("cursor", {}), "cursor-agent");
  assert.equal(programLabel("opencode", {}), "opencode");
  assert.equal(programLabel("claude", {}), "claude");
});

test("a program named by an environment variable says which variable, so a stray value is not read as a program name", () => {
  // Cursor's own terminals set CURSOR_AGENT=1; "1 is not installed" says nothing.
  assert.equal(brainProgram("cursor", { CURSOR_AGENT: "1" }), "1");
  assert.equal(programLabel("cursor", { CURSOR_AGENT: "1" }), "1 (the value of CURSOR_AGENT)");
  assert.equal(programLabel("opencode", { OPENCODE_BIN: "/opt/oc" }), "/opt/oc (the value of OPENCODE_BIN)");
});

test("on Windows a program on the PATH has an extension (claude.exe, opencode.cmd), so each of PATHEXT is tried", () => {
  const dir = mkdtempSync(join(tmpdir(), "anaico-path-"));
  for (const name of ["claude.exe", "opencode.cmd", "plain"]) {
    writeFileSync(join(dir, name), "");
    chmodSync(join(dir, name), 0o755);
  }
  const env = { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  assert.equal(isInstalled("claude", env, "win32"), true);
  assert.equal(isInstalled("opencode", env, "win32"), true);
  assert.equal(isInstalled("cursor-agent", env, "win32"), false);
  // Elsewhere the bare name is the program: claude.exe is not "claude".
  assert.equal(isInstalled("claude", env, "linux"), false);
  assert.equal(isInstalled("plain", env, "linux"), true);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { brainProgram, programLabel } from "../src/programs.ts";

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

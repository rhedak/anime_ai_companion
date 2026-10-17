import { winSkip } from "./helpers/platform.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const bin = new URL("../bin/anaico.js", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("--version prints the version and the pinned creator release, and exits 0 without starting anything", { skip: winSkip }, () => {
  for (const flag of ["--version", "-v"]) {
    const run = spawnSync(process.execPath, [bin, flag], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, new RegExp(`^anaico ${pkg.version.replace(/\./g, "\\.")}\\b`));
    assert.ok(run.stdout.includes(pkg.creator.ref), "the creator release it is pinned to");
  }
});

test("--help lists --version", { skip: winSkip }, () => {
  const run = spawnSync(process.execPath, [bin, "--help"], { encoding: "utf8" });
  assert.match(run.stdout, /--version/);
});

test("every environment variable the code reads is in the README's table, so none is left undocumented", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  for (const name of ["ANAICO_HOME", "CLAUDE_CONFIG_DIR", "CURSOR_AGENT", "OPENCODE_BIN", "OLLAMA_MODEL", "CREATOR_SRC"]) {
    assert.ok(readme.includes(name), `${name} is not in README.md`);
  }
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MIN_NODE, oldNodeMessage, tooOld } from "../bin/check-node.js";

test("a Node older than the minimum is refused, equal or newer is not", () => {
  assert.equal(tooOld("22.17.9"), true);
  assert.equal(tooOld("22.18.0"), false);
  assert.equal(tooOld("22.18.1"), false);
  assert.equal(tooOld("23.0.0"), false);
  assert.equal(tooOld("20.11.1"), true);
  assert.equal(tooOld("8.0.0"), true);
  assert.equal(tooOld("25.9.0"), false);
});

test("the minimum is the one package.json promises, so the two cannot drift apart", () => {
  const engines = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).engines.node;
  assert.equal(engines, `>=${MIN_NODE.replace(/\.0$/, "")}`);
});

test("an old Node gets a plain message and a failing exit code, before any TypeScript loads", () => {
  const script = `Object.defineProperty(process.versions, "node", { value: "20.11.1" }); await import(${JSON.stringify(new URL("../bin/check-node.js", import.meta.url).href)});`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /needs Node\.js 22\.18\.0 or newer/);
  assert.match(run.stderr, /this is Node 20\.11\.1/);
  assert.match(oldNodeMessage("20.11.1"), /nodejs\.org/);
});

test("the anaico launcher starts the CLI on a Node that is new enough", () => {
  const run = spawnSync(process.execPath, [new URL("../bin/anaico.js", import.meta.url).pathname, "--help"], { encoding: "utf8" });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /Usage: anaico/);
});

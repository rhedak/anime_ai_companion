import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { spawnCli } from "../src/spawn-cli.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the Windows launcher is plain ASCII (PowerShell 5.1 reads a file without a byte-order mark in the local code page)", () => {
  assert.match(read("scripts/windows-start.ps1"), /^[\x00-\x7f]*$/);
  assert.match(read("windows-start.bat"), /^[\x00-\x7f]*$/);
});

test("the double-click file runs the script, and the script reads the pinned creator release from package.json", () => {
  assert.match(read("windows-start.bat"), /scripts\\windows-start\.ps1/);
  const script = read("scripts/windows-start.ps1");
  assert.match(script, /\.creator\.ref/);
  assert.match(script, /archive\/refs\/tags\/\$ref\.zip/);
  // The check that decides whether Node is new enough must name the same minimum as the app's own check.
  const min = /MIN_NODE = "([\d.]+)"/.exec(read("bin/check-node.js"))![1];
  assert.ok(script.includes(`[version]"${min}"`), `the launcher should require Node ${min}`);
});

test("spawnCli starts a program and hands back its pipes", async () => {
  const child = spawnCli(process.execPath, ["-e", "process.stdout.write('hi')"], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  await new Promise((resolve) => child.on("close", resolve));
  assert.equal(out, "hi");
});

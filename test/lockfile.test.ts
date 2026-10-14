import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => JSON.parse(readFileSync(join(root, name), "utf8"));

test("package-lock.json describes this package as package.json does, so a first npm install leaves the checkout unchanged", () => {
  const pkg = read("package.json");
  const lock = read("package-lock.json");
  const own = lock.packages[""];
  assert.equal(lock.version, pkg.version, "the version: a release bump has to be carried into the lockfile too (npm install --package-lock-only)");
  assert.equal(own.version, pkg.version);
  assert.deepEqual(own.bin, pkg.bin, "the anaico command");
  assert.deepEqual(own.dependencies, pkg.dependencies);
  assert.deepEqual(own.devDependencies, pkg.devDependencies);
  assert.deepEqual(own.engines, pkg.engines);
});

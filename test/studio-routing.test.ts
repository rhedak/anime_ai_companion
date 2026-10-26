import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const types = (source: string, pattern: RegExp) => new Set([...source.matchAll(pattern)].map((m) => m[1]));

// The page hands a message to the studio only for the types its switch lists, so a message the studio sends and the page
// does not list is dropped without a sound (the handover prompt, the live spend and the check report once were).
test("every message the pack studio sends is passed on to it by the page", () => {
  const sent = types(read("../src/studio-service.ts"), /type: "(studio-[a-z-]+)"/g);
  const routed = types(read("../public/app.js"), /case "(studio-[a-z-]+)"/g);
  const handled = types(read("../public/studio.js"), /case "(studio-[a-z-]+)"/g);
  assert.ok(sent.size > 10);
  for (const type of sent) {
    assert.ok(routed.has(type), `public/app.js does not pass "${type}" on to the studio`);
    assert.ok(handled.has(type), `public/studio.js does not handle "${type}"`);
  }
});

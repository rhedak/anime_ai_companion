import assert from "node:assert/strict";
import { test } from "node:test";
import { processText } from "../src/studio/process.ts";

test("PROCESS.md: one row per picture with its tries, seed and flags, and no contact address", () => {
  const text = processText(
    { name: "risa-winter", outfit: "a dark green winter coat", source: "risa-dress" },
    "FLUX test model",
    {
      neutral: { seed: 7, attempts: 0, flags: [] },
      happy: { seed: 9, attempts: 2, flags: ["very blurry"] },
    },
  );
  assert.match(text, /^# How the risa-winter pack was made/);
  assert.match(text, /\| neutral \| seed 7, 1 try \| no flags \|/);
  assert.match(text, /\| happy \| seed 9, 3 tries \| flags: very blurry \|/);
  assert.match(text, /Image maker: FLUX test model\./);
  assert.doesNotMatch(text, /@/, "no address is written into the pack");
});

test("PROCESS.md: a pack with no records still says so", () => {
  assert.match(processText({ name: "x", outfit: "y", source: "z" }, "m", {}), /\(none recorded\)/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { orderPresets } from "../public/preset-order.js";

test("Risa and Franzi come first in the presets, the others keep the creator's order", () => {
  assert.deepEqual(orderPresets(["katherina", "gero", "risa", "franzi"]), ["risa", "franzi", "katherina", "gero"]);
  assert.deepEqual(orderPresets(["a", "franzi", "b", "risa"]), ["risa", "franzi", "a", "b"]);
});

test("a missing Risa or Franzi is not invented, and an empty list stays empty", () => {
  assert.deepEqual(orderPresets(["katherina", "franzi"]), ["franzi", "katherina"]);
  assert.deepEqual(orderPresets(["katherina"]), ["katherina"]);
  assert.deepEqual(orderPresets([]), []);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { findAvatarTags, parseAvatarTag } from "../src/avatar-tags.ts";

test("parses key=value pairs", () => {
  assert.deepEqual(parseAvatarTag("hair_color=#ff88cc outfit.hat_color=none glasses=true"), {
    hair_color: "#ff88cc",
    "outfit.hat_color": "none",
    glasses: "true",
  });
});

test("strips quotes and ignores tokens without a value", () => {
  assert.deepEqual(parseAvatarTag(`eye_color="#112233" junk`), { eye_color: "#112233" });
});

test("finds only complete tags, in order", () => {
  const text = "[emotion:happy] Sure! [avatar hair_color=#111111] and [avatar glasses=true] then [avatar hair_c";
  assert.deepEqual(findAvatarTags(text), [{ hair_color: "#111111" }, { glasses: "true" }]);
});

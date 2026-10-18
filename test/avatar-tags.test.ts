import assert from "node:assert/strict";
import { test } from "node:test";
import { findAvatarTags, findOutfitTags, normalizeTags, parseAvatarTag } from "../src/avatar-tags.ts";

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

test("tags written a little differently by small models are rewritten to the exact forms", () => {
  assert.equal(normalizeTags("Sure. [remember]Favourite colour: teal[/remember] How is your day?"), "Sure. [remember Favourite colour: teal] How is your day?");
  assert.deepEqual(findOutfitTags(normalizeTags("Okay [outfit: Casual] there")), ["casual"]);
  assert.deepEqual(findOutfitTags(normalizeTags("Okay [outfit=casual] there")), ["casual"]);
  assert.equal(normalizeTags("[emotion happy] hi [gesture wave]"), "[emotion:happy] hi [gesture:wave]");
  // things that are not tags are left alone
  assert.equal(normalizeTags("see [the docs](https://x.y) and [remember to breathe]"), "see [the docs](https://x.y) and [remember to breathe]");
  assert.equal(normalizeTags("[remember]unfinished"), "[remember]unfinished");
});

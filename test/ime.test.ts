import assert from "node:assert/strict";
import { test } from "node:test";
import { composing } from "../public/ime.js";

test("Enter that confirms an input-method conversion is not a send", () => {
  assert.equal(composing({ isComposing: true, keyCode: 13 }), true); // Chrome, Firefox
  assert.equal(composing({ isComposing: false, keyCode: 229 }), true); // Safari, after the composition ended
  assert.equal(composing({ isComposing: false, keyCode: 13 }), false); // a plain Enter
  assert.equal(composing({}), false);
});

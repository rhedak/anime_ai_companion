import assert from "node:assert/strict";
import { test } from "node:test";
import { parseUserEffort, resolveEffort } from "../src/claude-settings.ts";

const user = parseUserEffort({
  effortLevel: "medium",
  modelSettings: {
    "claude-sonnet-5": { effortLevel: "low" },
    "claude-sonnet-5-5": { effortLevel: "high" },
    "claude-opus-5-5": { effortLevel: "xhigh" },
    "claude-haiku-5-5": { effortLevel: "bogus" },
  },
  unrelated: "ignored",
});

test("reads only valid effort levels", () => {
  assert.equal(user.effortLevel, "medium");
  assert.deepEqual(Object.keys(user.perModel).sort(), ["claude-opus-5-5", "claude-sonnet-5", "claude-sonnet-5-5"]);
  assert.deepEqual(parseUserEffort(null), { effortLevel: null, perModel: {} });
  assert.equal(parseUserEffort({ effortLevel: "enormous" }).effortLevel, null);
});

test("an alias means the newest model of that family with a setting; otherwise the general level", () => {
  assert.equal(resolveEffort(user, "sonnet"), "high"); // 5.5 beats 5
  assert.equal(resolveEffort(user, "opus"), "xhigh");
  assert.equal(resolveEffort(user, "haiku"), "medium"); // its own entry was invalid
  assert.equal(resolveEffort(user, "claude-sonnet-5"), "low"); // a full id matches exactly
  assert.equal(resolveEffort(parseUserEffort({}), "sonnet"), null);
});

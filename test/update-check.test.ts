import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const { isNewer, newestTag, dueNow, TAGS_URL } = createRequire(import.meta.url)("../app/update-check.cjs");

test("compares x.y.z numerically, and ignores anything else", () => {
  assert.equal(isNewer("v0.10.0", "0.9.5"), true, "numbers, not text");
  assert.equal(isNewer("v0.8.0", "0.8.0"), false);
  assert.equal(isNewer("v0.7.9", "0.8.0"), false);
  assert.equal(isNewer("v0.9.0-rc1", "0.8.0"), false, "a pre-release is not offered");
  assert.equal(isNewer("nightly", "0.8.0"), false);
});

test("picks the highest release tag out of GitHub's list", () => {
  assert.equal(newestTag([{ name: "v0.8.0" }, { name: "v0.10.1" }, { name: "v0.9.0" }, { name: "pack-test" }, { name: "v1.0.0-beta" }]), "v0.10.1");
  assert.equal(newestTag([]), null);
  assert.equal(newestTag({ message: "rate limited" }), null);
});

test("the automatic check needs the opt-in and happens at most once a day", () => {
  const now = 10 * 24 * 3600 * 1000;
  assert.equal(dueNow({}, now), false, "never asked");
  assert.equal(dueNow({ auto: false }, now), false, "declined");
  assert.equal(dueNow({ auto: true }, now), true);
  assert.equal(dueNow({ auto: true, lastCheck: now - 3600 * 1000 }, now), false, "an hour ago");
  assert.equal(dueNow({ auto: true, lastCheck: now - 25 * 3600 * 1000 }, now), true);
  assert.equal(dueNow({ auto: true, lastCheck: now + 3600 * 1000 }, now), true, "a clock set back");
});

test("the only address it contacts is GitHub's tags list", () => {
  assert.equal(new URL(TAGS_URL).host, "api.github.com");
});

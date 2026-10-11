import assert from "node:assert/strict";
import { test } from "node:test";
import { CACHE_LIFETIME_MS, DEFAULT_AUTOCOMPACT, coldCache, formatIdle, formatTokens, parseAutocompact } from "../src/cache-guard.ts";

const now = 1_700_000_000_000;
const ago = (ms: number) => now - ms;

test("a big conversation idle past the cache lifetime is cold", () => {
  assert.deepEqual(coldCache({ contextTokens: 354_000, lastReplyAt: ago(8 * 3_600_000) }, now), { tokens: 354_000, idleMinutes: 480 });
});

test("a recent reply keeps the cache warm", () => {
  assert.equal(coldCache({ contextTokens: 354_000, lastReplyAt: ago(CACHE_LIFETIME_MS - 60_000) }, now), null);
});

test("a small conversation is never worth a warning", () => {
  assert.equal(coldCache({ contextTokens: 40_000, lastReplyAt: ago(24 * 3_600_000) }, now), null);
});

test("without a known size or time there is nothing to warn about", () => {
  assert.equal(coldCache({ contextTokens: null, lastReplyAt: ago(3_600_000 * 9) }, now), null);
  assert.equal(coldCache({ contextTokens: 300_000, lastReplyAt: null }, now), null);
});

test("idle time and token counts read naturally", () => {
  assert.equal(formatIdle(75), "75 minutes");
  assert.equal(formatIdle(480), "8 hours");
  assert.equal(formatIdle(3 * 24 * 60), "3 days");
  assert.equal(formatTokens(353_855), "354k");
  assert.equal(formatTokens(800), "800");
});

test("the compaction size is auto or 100k to 1M, anything else falls back to the default", () => {
  assert.equal(parseAutocompact(undefined), DEFAULT_AUTOCOMPACT);
  assert.equal(parseAutocompact("auto"), "auto");
  assert.equal(parseAutocompact("150000"), "150000");
  assert.equal(parseAutocompact("300k"), "300000");
  assert.equal(parseAutocompact("50000"), DEFAULT_AUTOCOMPACT); // the CLI would refuse it
  assert.equal(parseAutocompact("2000000"), DEFAULT_AUTOCOMPACT);
  assert.equal(parseAutocompact("lots"), DEFAULT_AUTOCOMPACT);
});

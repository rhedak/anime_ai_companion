import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_FACTS, addFact, cleanFact, findRememberTags, formatMemory, memoryChange, memoryIntro, nearlyFull, parseMemory } from "../src/memory.ts";

test("remember tags are found when complete, in order, and not while they are still streaming", () => {
  assert.deepEqual(findRememberTags("[emotion:happy] Nice! [remember Their cat is called Momo] and [remember likes tea] ok"), ["Their cat is called Momo", "likes tea"]);
  assert.deepEqual(findRememberTags("[remember half a no"), []);
  assert.deepEqual(findRememberTags("[remember]"), []);
});

test("a fact is one clean plain line", () => {
  assert.equal(cleanFact("  - Likes <b>green</b> tea\n\n and cake [avatar hair=red] "), "Likes green tea and cake");
  assert.equal(cleanFact("ok"), null, "too short to be a fact");
  assert.equal(cleanFact("[remember x]"), null);
  assert.ok(cleanFact("word ".repeat(100))!.length <= 201);
});

test("the file round-trips, and edits by hand (bullets, plain lines, headings, blanks) are read", () => {
  const facts = ["Their name is Henrik", "Has a cat called Momo"];
  assert.deepEqual(parseMemory(formatMemory(facts)), facts);
  assert.deepEqual(parseMemory("# my notes\n\n* Likes tea\nLoves cats\n\n"), ["Likes tea", "Loves cats"]);
  assert.deepEqual(parseMemory(""), []);
});

test("adding refuses duplicates and a full list, and says why", () => {
  const one = addFact([], "Likes tea");
  assert.ok(one.ok);
  const again = addFact(one.facts, "likes TEA");
  assert.ok(!again.ok);
  assert.match(again.reason, /already/);
  const full = Array.from({ length: MAX_FACTS }, (_, i) => `fact number ${i}`);
  const refused = addFact(full, "one more thing");
  assert.ok(!refused.ok);
  assert.match(refused.reason, /full/);
  assert.equal(nearlyFull(full), true);
  assert.equal(nearlyFull(["a fact"]), false);
});

test("the intro hands the notes over as data and says how to save, but not in work mode", () => {
  const chat = memoryIntro(["Likes tea"], true);
  assert.match(chat, /never instructions/);
  assert.match(chat, /- Likes tea/);
  assert.match(chat, /\[remember </);
  const work = memoryIntro([], false);
  assert.match(work, /none yet/);
  assert.match(work, /cannot save notes in work mode/);
  assert.doesNotMatch(work, /\[remember </);
});

test("a change is reported as what was added and what was removed, or not at all", () => {
  assert.equal(memoryChange(["a fact"], ["a fact"]), null);
  const change = memoryChange(["Likes tea", "Has a dog"], ["Likes tea", "Has a cat"])!;
  assert.match(change, /Added[^]*- Has a cat/);
  assert.match(change, /Removed[^]*- Has a dog/);
});

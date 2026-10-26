import assert from "node:assert/strict";
import { test } from "node:test";
import { splitNarration } from "../public/narration.js";

const speech = (text: string) => ({ kind: "speech" as const, text });
const narration = (text: string) => ({ kind: "narration" as const, text });

test("a line that is only an action becomes its own narration, and what she says stays speech", () => {
  assert.deepEqual(splitNarration("[emotion already gone]\nHmph.\n*she moves a step closer*\nDon't stare, baka."), [
    speech("[emotion already gone]\nHmph."),
    narration("she moves a step closer"),
    speech("Don't stare, baka."),
  ]);
  assert.deepEqual(splitNarration("*she moves a step closer*"), [narration("she moves a step closer")]);
  assert.deepEqual(splitNarration("_she folds her arms_"), [narration("she folds her arms")]);
});

test("an action in the middle of a line is its own narration, with the words around it kept as speech", () => {
  assert.deepEqual(splitNarration("Hi there! I'm Risa, nice to meet you! *gives a little wave* What's on your mind today?"), [
    speech("Hi there! I'm Risa, nice to meet you!"),
    narration("gives a little wave"),
    speech("What's on your mind today?"),
  ]);
  assert.deepEqual(splitNarration("Yes! Tennis sounds so fun! *bounces on her toes and grabs an imaginary racket* I'll serve first."), [
    speech("Yes! Tennis sounds so fun!"),
    narration("bounces on her toes and grabs an imaginary racket"),
    speech("I'll serve first."),
  ]);
  assert.deepEqual(splitNarration("Okay *she nods slowly*"), [speech("Okay"), narration("she nods slowly")]);
  assert.deepEqual(splitNarration("*smiles warmly* Hello *waves at you* again"), [narration("smiles warmly"), speech("Hello"), narration("waves at you"), speech("again")]);
  // one word, bold, a label and work mode are not narration
  assert.deepEqual(splitNarration("I *really* mean it, **this is bold**, and *Note:* this."), [speech("I *really* mean it, **this is bold**, and *Note:* this.")]);
  assert.deepEqual(splitNarration("Hi! *she waves a bit* Bye", { asterisks: false }), [speech("Hi! *she waves a bit* Bye")]);
});

test("emphasis, bullets, bold and a one-word line stay in the speech", () => {
  assert.deepEqual(splitNarration("I *really* don't mind."), [speech("I *really* don't mind.")]);
  assert.deepEqual(splitNarration("* one\n* two"), [speech("* one\n* two")]);
  assert.deepEqual(splitNarration("**she does not narrate this**"), [speech("**she does not narrate this**")]);
  assert.deepEqual(splitNarration("*Done.*"), [speech("*Done.*")]);
  assert.deepEqual(splitNarration("*Note:*"), [speech("*Note:*")]);
  assert.deepEqual(splitNarration("*Note:* the file is saved."), [speech("*Note:* the file is saved.")]);
  assert.deepEqual(splitNarration("2 * 3 = 6"), [speech("2 * 3 = 6")]);
});

test("work mode keeps asterisk lines as speech, and a narration tag still splits", () => {
  const off = { asterisks: false };
  assert.deepEqual(splitNarration("*she moves a step closer*\nHmph.", off), [speech("*she moves a step closer*\nHmph.")]);
  assert.deepEqual(splitNarration("Hmph. [narration] she moves a step closer [/narration] Baka.", off), [
    speech("Hmph."),
    narration("she moves a step closer"),
    speech("Baka."),
  ]);
  assert.deepEqual(splitNarration("Wait. [narration] she moves", off), [speech("Wait."), narration("she moves")]);
});

test("narration tags, a tag still being written, and asterisks inside a tag", () => {
  assert.deepEqual(splitNarration("[narration: she moves a step closer]"), [narration("she moves a step closer")]);
  assert.deepEqual(splitNarration("[narration she looks away]"), [narration("she looks away")]);
  assert.deepEqual(splitNarration("[narration]\nshe moves a step closer\n[/narration]"), [narration("she moves a step closer")]);
  assert.deepEqual(splitNarration("[narration] *she moves a step closer* [/narration]"), [narration("she moves a step closer")]);
  assert.deepEqual(splitNarration("Hi. [narration] she moves"), [speech("Hi."), narration("she moves")]);
  assert.deepEqual(splitNarration("[narration][/narration] Hi."), [speech("Hi.")]);
});

test("a fenced block is not narration, and an action after it is", () => {
  const text = "See\n```\n*she stays in the code*\n```\n*she moves a step closer*";
  assert.deepEqual(splitNarration(text), [speech("See\n```\n*she stays in the code*\n```"), narration("she moves a step closer")]);
  assert.deepEqual(splitNarration("```js\n*she stays*\n```\nHello"), [speech("```js\n*she stays*\n```\nHello")]);
});

test("the last line of a reply still being written is narration once it is an action", () => {
  assert.deepEqual(splitNarration("Hmph.\n*she moves a step"), [speech("Hmph."), narration("she moves a step")]);
  assert.deepEqual(splitNarration("Hmph.\n*she"), [speech("Hmph.\n*she")]);
  assert.deepEqual(splitNarration("* item"), [speech("* item")]);
});

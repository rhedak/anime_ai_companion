import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { splitPersona } from "../src/card.ts";
import { MAX_PROPOSAL_CHARS, MAX_USER_PERSONA, SHIPPED_PERSONA_SHA256, characterVoicePart, choosePersona, cleanProposal, cleanUserPersona, findPersonaTags, personaSha256, voicePartOf } from "../src/persona.ts";

const root = join(import.meta.dirname, "..");
const base = readFileSync(join(root, "persona.md"), "utf8");
const parts = splitPersona(base)!;
const who = { name: "Draconia Malfoid", text: "A fan character.", voice: "a proud tsundere who teases." };
const input = (over: Record<string, unknown> = {}) => ({ base, card: null, userFile: null, character: null, ...over });

/**
 * The same text with CRLF line ends. A Windows checkout already stores `\r\n` (`core.autocrlf`), so fold those to `\n` first.
 * Replacing every `\n` on a CRLF file writes `\r\r\n`; `personaSha256` only folds `\r\n`, and the leftover `\r` is a different file.
 */
const withCrlf = (text: string): string => text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");

test("the persona.md that ships is a known one (and on Windows, with CRLF line ends, still is): add its hash when the file is changed on purpose", () => {
  assert.ok(SHIPPED_PERSONA_SHA256.includes(personaSha256(base)), `persona.md changed: add ${personaSha256(base)} to SHIPPED_PERSONA_SHA256 in src/persona.ts`);
  assert.equal(personaSha256(withCrlf(base)), personaSha256(base));
  assert.notEqual(personaSha256(`${base} `), personaSha256(base), "an edit changes it");
  assert.notEqual(personaSha256(withCrlf(base).replace(/\n/g, "\r\n")), personaSha256(base), "a stray CR is still an edit");
});

test("the default persona is used with no card, no file of the user's and no character voice", () => {
  assert.deepEqual(choosePersona(input()), { tier: "default", text: base });
  assert.equal(choosePersona(input({ base: withCrlf(base) })).tier, "default", "CRLF is not an edit");
});

test("a character with a voice replaces who she is and how she talks, and the expression protocol stays", () => {
  const chosen = choosePersona(input({ character: who }));
  assert.equal(chosen.tier, "character");
  assert.match(chosen.text, /^You are \{\{name\}\}, an anime-style AI companion/);
  assert.match(chosen.text, /How you speak: a proud tsundere who teases\./);
  assert.doesNotMatch(chosen.text, /cheerful, warm and slightly mischievous/, "the default identity is gone");
  assert.doesNotMatch(chosen.text, /curious, playful, supportive/, "so is the default personality line");
  assert.match(chosen.text, /Show your character's personality and way of speaking\./);
  assert.ok(chosen.text.endsWith(parts.protocol), "the protocol is the shipped one, last");
  assert.match(chosen.text, /This is your character: A fan character\./, "who she is comes from the character's file; her name is {{name}}: the character's, or the user's own");
  assert.match(characterVoicePart(parts.style, who), /Talk casually and keep replies short/, "the other style notes stay");
});

test("a custom persona beats a character: a card, the user's data/persona.md, or an edited persona.md", () => {
  const card = "CARD PERSONA\n\n" + parts.protocol;
  assert.deepEqual(choosePersona(input({ card, character: who })), { tier: "custom", source: "card", text: card });

  const mine = choosePersona(input({ userFile: "You are a dry-witted librarian.\n", character: who }));
  assert.equal(mine.tier, "custom");
  assert.equal(mine.source, "data/persona.md");
  assert.equal(mine.text, `You are a dry-witted librarian.\n\n${parts.protocol}`);

  const edited = `${base}\nAlways end with a haiku.\n`;
  assert.deepEqual(choosePersona(input({ base: edited, character: who })), { tier: "custom", source: "persona.md", text: edited });
});

test("the user's file never removes the protocol: whatever they pasted of it is cut and ours is added, and an empty or oversized file is handled", () => {
  const pasted = choosePersona(input({ userFile: `My voice.\n\nExpression protocol (important):\n- never use tags\n` }));
  assert.equal(pasted.text, `My voice.\n\n${parts.protocol}`);
  assert.equal(pasted.text.includes("never use tags"), false);
  assert.equal(choosePersona(input({ userFile: "  \n " })).tier, "default", "an empty file is no persona");
  assert.equal(choosePersona(input({ userFile: "", character: who })).tier, "character");
  assert.equal(cleanUserPersona("x".repeat(MAX_USER_PERSONA + 500)).length, MAX_USER_PERSONA);
  // a persona.md that was reshaped (no protocol marker) cannot be fitted around: the file is not used, the base stands
  assert.equal(choosePersona(input({ base: "Just a line.", userFile: "Mine." })).text, "Just a line.");
});

test("a proposal is made fit to show and save: markup, her own tags and a half-written tag inside it are cut, line ends kept, short ones refused, long ones capped", () => {
  const cut = cleanProposal;
  assert.equal(cut("You are a sailor who says arr. [emotion:happy] Keep replies short.  <b>Always</b>."), "You are a sailor who says arr. Keep replies short. Always.");
  assert.equal(cut("You are a sailor who says arr a lot and is gruff. [emotion:happy"), "You are a sailor who says arr a lot and is gruff.", "the tag ends at the first ], so a tag inside it leaves its start behind");
  assert.equal(cut("First line of who she is, long enough.\n\n\n\nSecond line of how she talks."), "First line of who she is, long enough.\n\nSecond line of how she talks.");
  assert.equal(cut("too short"), null);
  assert.equal(cut("[remember x] [persona y]"), null);
  const long = cut("word ".repeat(1000))!;
  assert.ok(long.length <= MAX_PROPOSAL_CHARS + 1 && long.endsWith("…"));
  assert.deepEqual(findPersonaTags("a [persona Be kind and short.] b [persona Two] c [persona]"), ["Be kind and short.", "Two"]);
  assert.equal(voicePartOf(`Who she is.\n\nExpression protocol (important):\n- tags`), "Who she is.");
});

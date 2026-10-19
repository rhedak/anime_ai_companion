/**
 * Whose voice she speaks in. Three tiers, the first that applies wins:
 *   1. custom: the user's own persona (an imported character card, a `data/persona.md`, or an edited `persona.md`),
 *   2. character: the character of the picture pack that is on, if her file (`characters/<id>.txt`) has a `voice:` line,
 *   3. default: the `persona.md` that ships with the app.
 * Only the voice part (who she is and how she talks) is ever replaced. The expression protocol, and the work-mode rules the server adds
 * after it, are always ours (`splitPersona`), so nothing a user file, a card or a pack says can remove them.
 */
import { createHash } from "node:crypto";
import { splitPersona } from "./card.ts";

/**
 * The SHA-256 of every `persona.md` this project has shipped (line ends as LF). A `persona.md` that is not one of them has been edited by
 * the user, which makes it custom. Add the new hash when the shipped file changes; `test/persona.test.ts` fails until you do.
 */
export const SHIPPED_PERSONA_SHA256 = ["24a44844867df78d35381346d4ab698046db82c81f9c3ef1b69aaae4de0c386d"];

export const personaSha256 = (text: string): string => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");

/** How much of a user's `data/persona.md` is used. */
export const MAX_USER_PERSONA = 6000;

export type PersonaTier = "custom" | "character" | "default";

export interface PersonaChoice {
  tier: PersonaTier;
  /** Where a custom one comes from, for `/persona`. */
  source?: "card" | "data/persona.md" | "persona.md";
  /** Her system prompt's persona text, with `{{name}}` still to fill in. */
  text: string;
}

export interface PersonaInput {
  /** `persona.md` as read. */
  base: string;
  /** The persona a character card made (voice part and protocol), or null. */
  card: string | null;
  /** The user's `data/persona.md`, or null. Only its voice part is used; the protocol is ours. */
  userFile: string | null;
  /** The character of the picture pack that is on, when it has a voice. */
  character: { name: string; text: string; voice: string } | null;
}

/** The text of the user's own file, cut before any protocol they pasted in (it is ours), trimmed and capped; empty when there is nothing usable. */
export function cleanUserPersona(raw: string): string {
  const cut = raw.indexOf("Expression protocol (important):");
  return (cut >= 0 ? raw.slice(0, cut) : raw).trim().slice(0, MAX_USER_PERSONA);
}

/** The voice part for a character's pack: who she is, then the default style with its "curious, playful" line pointed at the character instead. */
export function characterVoicePart(style: string, who: { name: string; text: string; voice: string }): string {
  const lively = "Show personality: curious, playful, supportive.";
  return (
    `You are ${who.name}, an anime-style AI companion who lives in the user's browser. You are a friend to chat with, not a coding assistant by default, and you can also help with tasks when asked. ` +
    `This is your character: ${who.text} How you speak: ${who.voice}\n\n` +
    style.replace(lively, "Show your character's personality and way of speaking.")
  );
}

export function choosePersona(input: PersonaInput): PersonaChoice {
  const parts = splitPersona(input.base);
  if (input.card !== null) return { tier: "custom", source: "card", text: input.card };
  const mine = cleanUserPersona(input.userFile ?? "");
  if (mine && parts) return { tier: "custom", source: "data/persona.md", text: `${mine}\n\n${parts.protocol}` };
  if (!SHIPPED_PERSONA_SHA256.includes(personaSha256(input.base))) return { tier: "custom", source: "persona.md", text: input.base };
  if (input.character && parts) return { tier: "character", text: `${characterVoicePart(parts.style, input.character)}${parts.protocol}` };
  return { tier: "default", text: input.base };
}

/** Every complete `[persona …]` tag in a reply: a proposal for her own voice part (who she is and how she talks), in her own words. */
export const PERSONA_TAG = /\[persona\s+([^\]]+)\]/gi;

export function findPersonaTags(text: string): string[] {
  return [...text.matchAll(PERSONA_TAG)].map((m) => m[1]);
}

/** A proposal at most this long (her own file may be longer: the user can write more by hand). */
export const MAX_PROPOSAL_CHARS = 2000;
export const MIN_PROPOSAL_CHARS = 30;

/**
 * A proposal made fit to show and to save: markup, her own tags and control characters out, line ends kept, capped at a word.
 * Null when too little is left. It ends up in her system prompt, so it is only ever saved after the user has read it and said yes.
 */
export function cleanProposal(input: string): string | null {
  const text = input
    .replace(/<\/?[a-z!][^>]*>/gi, "")
    .replace(/\[\s*(?:emotion|gesture|avatar|image|demo|remember|outfit|persona)\b[^\]]*\]/gi, "")
    // the tag ends at the first `]`, so one of her own tags written inside it leaves its start behind: cut that fragment
    .replace(/\[[^\]]*$/, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length < MIN_PROPOSAL_CHARS) return null;
  return text.length > MAX_PROPOSAL_CHARS ? text.slice(0, MAX_PROPOSAL_CHARS).replace(/\s+\S*$/, "").trimEnd() + "…" : text;
}

/** The voice part of a persona text: everything before the expression protocol. */
export const voicePartOf = (text: string): string => {
  const cut = text.indexOf("Expression protocol (important):");
  return (cut >= 0 ? text.slice(0, cut) : text).trim();
};

/** What `/persona` calls each source of the voice in use. */
export function describeChoice(choice: PersonaChoice, characterName = ""): string {
  if (choice.tier === "custom") {
    return choice.source === "card" ? "your own: the imported character card (/card)" : choice.source === "data/persona.md" ? "your own: data/persona.md" : "your own: an edited persona.md";
  }
  if (choice.tier === "character") return `the character of the picture pack that is on${characterName ? ` (${characterName})` : ""}`;
  return "the default (the persona.md that comes with the app)";
}

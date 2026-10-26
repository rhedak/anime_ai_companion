import { reply as scriptedReply } from "../public/script.js";
import { findAvatarTags } from "./avatar-tags.ts";

/**
 * When a small model answers a clear request in words and writes no tag for it ("Yes! Tennis sounds so fun!" and no `[activity tennis]`), the app does what
 * the user asked itself, once, for the brains whose models often skip tags (docs/missing-tag-plan.md). Only explicit requests count: a look change the built-in
 * reader understands, or one of the activities she has, said as an invitation or an order. Nothing here talks to a model.
 */

/** The brains whose models are small enough to skip tags: Ollama's and opencode's free ones. Claude Code and Cursor write them. */
export const TAG_SKIPPING_BRAINS = ["ollama", "opencode"];

/** Her reply says no, or that she cannot: the app does not overrule it. */
const REFUSES = /\b(can'?t|cannot|won'?t|not now|not able|unable|sorry|rather not|no thanks?|no,)/i;

export const refuses = (reply: string): boolean => REFUSES.test(reply);

/** A leading filler word or two ("ok, so please …") does not change what the message asks. */
const normalise = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/^(?:\s*(?:ok(?:ay)?|hey|hi|hello|so|now|then|and|yes|yeah|oh|well|please|pls|risa|franzi)\b[\s,.!:-]*)+/, "")
    .trim();

/** A question about her ("do you like blue eyes?") is not a request; "can you …" and "could you …" are. */
const PLAIN_QUESTION = /^(?:what|why|how|who|when|where|which|do|does|did|is|are|was|were|have|has)\b/;
const POLITE = /^(?:can|could|would|will)\s+you\b/;

/** Words that ask for a change: used on top of what the built-in reader understands, so "your blue eyes are lovely" is not a request. */
const LOOK_ASK = /\b(?:make|put|give|change|dye|turn|wear|add|take off|remove|switch|become|try|use|let'?s see|show me|i want|i'?d like|i would like)\b|^(?:can|could|would|will)\s+you\b|^(?:please\s+)?(?:be|have|get)\b/;

/**
 * The `[avatar …]` changes the built-in reader would make for this message, when the message asks for them. The reader (public/script.js) is the one the demo and basic
 * mode use; here its tags are only used when her own reply had none.
 */
export function lookRequest(user: string, presets: string[]): Record<string, string>[] {
  const text = normalise(user);
  if (!text || text.startsWith("/")) return [];
  if (PLAIN_QUESTION.test(text) && !POLITE.test(text)) return [];
  if (!LOOK_ASK.test(text)) return [];
  const answer = scriptedReply(text, { presets, pack: false, basic: true }).text;
  return findAvatarTags(answer).filter((tag) => Object.keys(tag).length > 0);
}

/** "swimming" → swim, swimm; "dancing" → danc; "tennis" → tennis: the beginning of the word the user may use in any form. */
function stemOf(activity: string): string {
  const base = activity.replace(/ing$/, "");
  return base.replace(/(.)\1$/, "$1");
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordOf = (activity: string) => new RegExp(`\\b${escape(stemOf(activity))}(?:s|e|es|ing|ning|ming)?\\b`);

const INVITE = /^(?:let'?s|lets|let us|can we|could we|shall we|should we|we could|we should|how about|what about|wanna|want to|i want to|i'd like to|i would like to|would you like to|do you want to)\b/;
const ORDER = /^(?:play|go|start|try|have|begin|time for|join me)\b/;
const NOT_NOW = /\b(?:did|was|were|yesterday|last (?:night|week|time)|used to|don'?t|do not|not|never|no more|stop|enough|later|tomorrow)\b/;

/** Which of her activities this message asks to start, or null: "let's play tennis", "go swimming", "dance for me". */
export function wantedActivity(user: string, known: string[]): string | null {
  const text = normalise(user);
  if (!text || text.startsWith("/") || text.length > 160) return null;
  if (NOT_NOW.test(text)) return null;
  const sentence = text.split(/[.!?]/)[0] ?? text;
  if (PLAIN_QUESTION.test(sentence) && !INVITE.test(sentence)) return null; // "do you like dancing?" asks about her
  for (const name of known) {
    const word = wordOf(name);
    const at = sentence.search(word);
    if (at < 0) continue;
    const before = sentence.slice(0, at);
    if (INVITE.test(sentence) && before.length <= 45) return name;
    if (ORDER.test(sentence) && before.length <= 30) return name;
    // the activity first, as an order: "dance for me", "swim with me"
    if (at === 0 && /\b(?:for|with)\s+me\b|\btogether\b/.test(sentence)) return name;
  }
  return null;
}

/** The user ends the activity that is on: "stop", "that's enough", "stop swimming". Only while one is, and only when that is all the message says. */
export function wantsActivityEnd(user: string, active: string | null): boolean {
  if (!active) return false;
  const sentence = (normalise(user).split(/[.!?]/)[0] ?? "").trim();
  if (!sentence || sentence.startsWith("/")) return false;
  const filler = "(?:\\s+(?:the|this|that|it|now|playing|doing|please))*";
  const what = `(?:\\s+(?:activity|${escape(stemOf(active))}\\w*))?`;
  return new RegExp(`^(?:let'?s\\s+)?(?:stop|end|quit)${filler}${what}${filler}$`).test(sentence) || /^(?:that'?s\s+)?enough(?:\s+now)?$/.test(sentence);
}

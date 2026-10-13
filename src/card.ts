/**
 * Character cards (the community's V1, V2 and V3 persona format: a JSON file, or a PNG with the JSON in a text chunk).
 * A card is text from a stranger that ends up in her system prompt, so everything here is data: only a few fields are
 * read, markup and our own tags are removed, lengths are capped, and nothing in a card can touch the expression protocol.
 */

/** What we keep of a card. */
export interface Card {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  example: string;
}

export type CardResult = { ok: true; card: Card; ignored: string[] } | { ok: false; reason: string };

/** Per-field caps, in characters. A card is a prompt; a huge one costs money on every message. */
export const FIELD_LIMITS = { name: 24, description: 4000, personality: 1500, scenario: 1500, example: 2000 } as const;

/** The marker in persona.md where the fixed part (the expression protocol) starts. */
export const PROTOCOL_MARKER = "Expression protocol (important):";
const STYLE_MARKER = "Style:";

/** Card fields we deliberately do not use: they try to give orders that outrank ours, or are not about who she is. */
const IGNORED_FIELDS = ["system_prompt", "post_history_instructions", "character_book", "alternate_greetings", "first_mes", "extensions"];

export const MAX_CARD_BYTES = 15 * 1024 * 1024;

/** Strips HTML-like markup, our own tag syntax, control characters and runaway blank lines; swaps the card's placeholders. */
export function cleanText(input: unknown, limit: number): string {
  if (typeof input !== "string") return "";
  let text = input
    .replace(/\r\n?/g, "\n")
    // Bracketed tags our page and server act on: a card must not be able to write them into her instructions.
    .replace(/\[\s*(?:emotion|gesture|avatar|image|demo|remember)\b[^\]]*\]/gi, "")
    .replace(/<\/?[a-z!][^>]*>/gi, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\{\{\s*char\s*\}\}|<BOT>/gi, "{{name}}")
    .replace(/\{\{\s*user\s*\}\}|<USER>/gi, "the user")
    .replace(/<START>/gi, "")
    // Any other {{macro}} is a front end's feature, not ours.
    .replace(/\{\{(?!name\}\})[^}]*\}\}/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length > limit) text = text.slice(0, limit).replace(/\s+\S*$/, "").trimEnd() + "…";
  return text;
}

/** Reads a card from its JSON text. V1 has the fields at the top level; V2 and V3 put them under `data`. */
export function parseCardJson(source: string): CardResult {
  let json: any;
  try {
    json = JSON.parse(source);
  } catch {
    return { ok: false, reason: "That is not a character card: the file is not valid JSON." };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return { ok: false, reason: "That is not a character card." };
  const spec = typeof json.spec === "string" ? json.spec : "";
  const data = spec.startsWith("chara_card_v") && json.data && typeof json.data === "object" ? json.data : json;

  const description = cleanText(data.description, FIELD_LIMITS.description);
  const personality = cleanText(data.personality, FIELD_LIMITS.personality);
  const scenario = cleanText(data.scenario, FIELD_LIMITS.scenario);
  const example = cleanText(data.mes_example, FIELD_LIMITS.example);
  const name = cleanText(data.name, 80).replace(/\s+/g, " ");
  if (!description && !personality && !scenario) return { ok: false, reason: "That card has no description, personality or scenario to use." };

  const ignored = IGNORED_FIELDS.filter((f) => {
    const value = data[f];
    return value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0) && !(typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);
  });
  return { ok: true, card: { name, description, personality, scenario, example }, ignored };
}

/** Finds the card JSON inside a PNG: a tEXt (or uncompressed iTXt) chunk named `ccv3` (V3) or `chara` (V1, V2), base64 encoded. */
export function cardJsonFromPng(png: Uint8Array): string | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.length < 8 || signature.some((b, i) => png[i] !== b)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const found: Record<string, string> = {};
  let pos = 8;
  while (pos + 8 <= png.length) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(...png.subarray(pos + 4, pos + 8));
    const start = pos + 8;
    const end = start + length;
    if (end + 4 > png.length) break;
    if (type === "tEXt" || type === "iTXt") {
      const body = png.subarray(start, end);
      const zero = body.indexOf(0);
      if (zero > 0) {
        const keyword = new TextDecoder("latin1").decode(body.subarray(0, zero));
        let text = body.subarray(zero + 1);
        if (type === "iTXt") {
          // compression flag, method, then language tag and translated keyword, each ended by a zero byte
          if (text[0] !== 0) text = new Uint8Array(0); // compressed: not used by card tools
          else {
            let at = 2;
            for (let n = 0; n < 2 && at < text.length; n++) at = text.indexOf(0, at) + 1 || text.length;
            text = text.subarray(at);
          }
        }
        if (keyword === "ccv3" || keyword === "chara") found[keyword] = new TextDecoder("latin1").decode(text);
      }
    }
    if (type === "IEND") break;
    pos = end + 4; // chunk data, then its CRC
  }
  const encoded = found.ccv3 ?? found.chara;
  if (!encoded) return null;
  try {
    return Buffer.from(encoded.trim(), "base64").toString("utf8");
  } catch {
    return null;
  }
}

/** A card from a file's bytes: a PNG with a card in it, or JSON. */
export function parseCardFile(bytes: Uint8Array): CardResult {
  if (bytes.length > MAX_CARD_BYTES) return { ok: false, reason: "That file is too big for a character card (over 15 MB)." };
  const isPng = bytes.length > 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (isPng) {
    const json = cardJsonFromPng(bytes);
    return json ? parseCardJson(json) : { ok: false, reason: "That PNG has no character card in it." };
  }
  return parseCardJson(new TextDecoder("utf-8").decode(bytes));
}

/** The parts of persona.md: who she is, how she talks, and the fixed expression protocol. Null if the file was reshaped. */
export function splitPersona(text: string): { character: string; style: string; protocol: string } | null {
  const protocolAt = text.indexOf(PROTOCOL_MARKER);
  if (protocolAt < 0) return null;
  const styleAt = text.indexOf(`\n${STYLE_MARKER}`);
  if (styleAt < 0 || styleAt > protocolAt) return null;
  return {
    character: text.slice(0, styleAt + 1),
    style: text.slice(styleAt + 1, protocolAt),
    protocol: text.slice(protocolAt),
  };
}

/** The character part of her prompt built from a card, followed by her usual style notes. `{{name}}` is filled in later. */
export function characterFromCard(card: Card, style: string): string {
  const parts = [
    "You are {{name}}, an anime-style AI companion who lives in the user's browser. You are a friend to chat with, not a coding assistant by default, and you can also help with tasks when asked. This is your character:",
    card.description,
    card.personality && `Personality: ${card.personality}`,
    card.scenario && `Scenario: ${card.scenario}`,
    card.example && `Examples of how you talk (the style only, not things to repeat):\n${card.example}`,
  ].filter(Boolean);
  return parts.join("\n\n") + "\n\n" + style;
}

/** Her current character as a V2 card. Only the character paragraph: the style notes and protocol belong to the app. */
export function cardFromPersona(character: string, name: string): string {
  const description = character.trim().replaceAll("{{name}}", "{{char}}");
  return (
    JSON.stringify(
      {
        spec: "chara_card_v2",
        spec_version: "2.0",
        data: {
          name,
          description,
          personality: "",
          scenario: "",
          first_mes: "",
          mes_example: "",
          creator_notes: "Exported from Anime AI Companion.",
          system_prompt: "",
          post_history_instructions: "",
          alternate_greetings: [],
          tags: [],
          creator: "",
          character_version: "1",
          extensions: {},
        },
      },
      null,
      2,
    ) + "\n"
  );
}

/** A short look at what a card will add, for the confirmation. */
export function previewCard(card: Card, ignored: string[]): { name: string; lines: string[]; ignored: string[] } {
  // Show her name where the card has the placeholder, so the preview reads as it will be used.
  const brief = (text: string) => {
    const shown = text.replaceAll("{{name}}", card.name || "she");
    return shown.length > 220 ? shown.slice(0, 220).trimEnd() + "…" : shown;
  };
  const lines = [
    card.description && `Description: ${brief(card.description)}`,
    card.personality && `Personality: ${brief(card.personality)}`,
    card.scenario && `Scenario: ${brief(card.scenario)}`,
    card.example && `Example lines: ${brief(card.example)}`,
  ].filter(Boolean) as string[];
  return { name: card.name, lines, ignored };
}

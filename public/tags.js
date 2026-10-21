// `[avatar hair_color=#ff88cc glasses=true]` in a reply: how she redraws herself. One reading of it for the server (src/avatar-tags.ts
// re-exports these) and the browser demo.

export const AVATAR_TAG = /\[avatar\s+([^\]]*)\]/g;

export function parseAvatarTag(body) {
  const out = {};
  for (const token of body.trim().split(/\s+/)) {
    const eq = token.indexOf("=");
    if (eq > 0) out[token.slice(0, eq)] = token.slice(eq + 1).replace(/^["']|["']$/g, "");
  }
  return out;
}

/** `[outfit casual]` in a reply: she changes into another outfit of the picture pack she is shown with. */
export const OUTFIT_TAG = /\[outfit\s+([^\]]*)\]/g;

/** The outfit named by every complete outfit tag in `text` (its first word, lower case), in order. */
export function findOutfitTags(text) {
  return [...text.matchAll(OUTFIT_TAG)].map((m) => (m[1].trim().split(/\s+/)[0] ?? "").toLowerCase()).filter(Boolean);
}

/** `[activity swimming]` / `[activity end]` in a reply: she starts an activity (any word she likes), or ends the one that is on. */
export const ACTIVITY_TAG = /\[activity\s+([^\]]*)\]/g;

const ACTIVITY_NAME = /^[a-z][a-z0-9_]{0,23}$/;
const ACTIVITY_ENDS = ["end", "stop", "none", "off"];

/** The activity named by every complete activity tag in `text`, in order: its first word, lower case; `null` for one that ends it. A word that is no activity name is dropped. */
export function findActivityTags(text) {
  const out = [];
  for (const m of text.matchAll(ACTIVITY_TAG)) {
    const word = (m[1].trim().split(/\s+/)[0] ?? "").toLowerCase();
    if (ACTIVITY_ENDS.includes(word)) out.push(null);
    else if (ACTIVITY_NAME.test(word)) out.push(word);
  }
  return out;
}

/**
 * Small models write the tags a little differently: `[remember]fact[/remember]`, `[outfit: casual]`, `[emotion happy]`. These are the same tags, so they are rewritten
 * to the exact forms before anything reads them (the server's appliers and the page's display both do). Only complete, unambiguous shapes change; text that is not a tag is left alone.
 */
export function normalizeTags(text) {
  return text
    .replace(/\[remember\]([^\[\]]*?)\[\/remember\]/gi, (_, fact) => `[remember ${fact.trim()}]`)
    .replace(/\[outfit\s*[:=]\s*([^\]]*)\]/gi, "[outfit $1]")
    .replace(/\[activity\s*[:=]\s*([^\]]*)\]/gi, "[activity $1]")
    .replace(/\[(emotion|gesture)\s+([a-z_]+)\]/gi, "[$1:$2]");
}

/** Every complete avatar tag in `text`, in order. */
export function findAvatarTags(text) {
  return [...text.matchAll(AVATAR_TAG)].map((m) => parseAvatarTag(m[1]));
}

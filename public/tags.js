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

/**
 * Small models write the tags a little differently: `[remember]fact[/remember]`, `[outfit: casual]`, `[emotion happy]`. These are the same tags, so they are rewritten
 * to the exact forms before anything reads them (the server's appliers and the page's display both do). Only complete, unambiguous shapes change; text that is not a tag is left alone.
 */
export function normalizeTags(text) {
  return text
    .replace(/\[remember\]([^\[\]]*?)\[\/remember\]/gi, (_, fact) => `[remember ${fact.trim()}]`)
    .replace(/\[outfit\s*[:=]\s*([^\]]*)\]/gi, "[outfit $1]")
    .replace(/\[(emotion|gesture)\s+([a-z_]+)\]/gi, "[$1:$2]");
}

/** Every complete avatar tag in `text`, in order. */
export function findAvatarTags(text) {
  return [...text.matchAll(AVATAR_TAG)].map((m) => parseAvatarTag(m[1]));
}

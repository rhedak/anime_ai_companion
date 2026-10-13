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

/** Every complete avatar tag in `text`, in order. */
export function findAvatarTags(text) {
  return [...text.matchAll(AVATAR_TAG)].map((m) => parseAvatarTag(m[1]));
}

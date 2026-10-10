/** `[avatar hair_color=#ff88cc outfit.hat_color=#222 glasses=true]` in the model's reply. */
export const AVATAR_TAG = /\[avatar\s+([^\]]*)\]/g;

export function parseAvatarTag(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of body.trim().split(/\s+/)) {
    const eq = token.indexOf("=");
    if (eq > 0) out[token.slice(0, eq)] = token.slice(eq + 1).replace(/^["']|["']$/g, "");
  }
  return out;
}

/** Every complete avatar tag in `text`, in order. */
export function findAvatarTags(text: string): Record<string, string>[] {
  return [...text.matchAll(AVATAR_TAG)].map((m) => parseAvatarTag(m[1]));
}

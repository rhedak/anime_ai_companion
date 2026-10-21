// `[avatar hair_color=#ff88cc outfit.hat_color=#222 glasses=true]` in the model's reply: read by the code the browser demo shares (public/tags.js).
export { ACTIVITY_TAG, AVATAR_TAG, OUTFIT_TAG, findActivityTags, findAvatarTags, findOutfitTags, normalizeTags, parseAvatarTag } from "../public/tags.js";

/** `[image path/to/file.png]`: she shows a picture from the folder she works in. */
export const IMAGE_TAG = /\[image\s+([^\]]+)\]/g;

/** The paths named by every complete image tag in `text`, in order. */
export function findImageTags(text: string): string[] {
  return [...text.matchAll(IMAGE_TAG)].map((m) => m[1].trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

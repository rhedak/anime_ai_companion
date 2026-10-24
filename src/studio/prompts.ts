import { KEYS, type KeyName } from "./cutout.ts";

/** The colour's name as the model should hear it. */
export const keyWords: Record<KeyName, string> = {
  magenta: "pure magenta (#ff00ff)",
  green: "pure bright green (#00ff00)",
  cyan: "pure cyan (#00ffff)",
};

/**
 * The prompt for the new neutral picture. The wording is the one that worked for the Risa (casual) pack (docs/pack-image-models.md):
 * one thing changes, and everything that makes her herself is named as unchanged.
 */
export function outfitPrompt(outfit: string, key: KeyName): string {
  return (
    `change her outfit to ${outfit}; keep her face, hairstyle, hair colour, hair clip or accessories, eye colour, pose, expression and framing ` +
    `exactly the same, and keep the plain flat ${keyWords[key]} background exactly the same`
  );
}

export const keyRgb = (key: KeyName) => KEYS[key];

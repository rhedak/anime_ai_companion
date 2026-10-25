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
    `exactly the same (if the picture is cut off at its edge, it stays cut off at the same place: draw no more of her body than it shows, no legs or shoes below that edge, and do not make her smaller), and keep the plain flat ${keyWords[key]} background exactly the same`
  );
}

export const keyRgb = (key: KeyName) => KEYS[key];

/** The seven emotions of a pack, and the one that is the base. */
export const EMOTIONS = ["neutral", "happy", "sad", "angry", "surprised", "shy", "thinking"] as const;
export type EmotionName = (typeof EMOTIONS)[number];

const KEEP = (key: KeyName) => `keep her hair, clothes, pose, framing and the plain flat ${keyWords[key]} background identical`;

/** How each emotion looks, as words for a face edit. `thinking` is not here: a hand at her chin leaves the face box (see thinkingPrompt). */
const CUES: Record<Exclude<EmotionName, "neutral" | "thinking">, string> = {
  happy: "a warm happy smile with bright smiling eyes",
  sad: "a sad expression, sad eyes and a downturned mouth",
  angry: "an angry expression, furrowed eyebrows, narrowed eyes and a frowning mouth",
  surprised: "a surprised expression, wide open eyes, raised eyebrows and a small open mouth",
  shy: "a shy embarrassed expression, blushing cheeks, a small smile and eyes glancing aside",
};

export const emotionPrompt = (emotion: keyof typeof CUES, key: KeyName) => `change only her facial expression to ${CUES[emotion]}; ${KEEP(key)}`;

/** A whole-picture edit: the hand reaches her chin, so the face box cannot hold it. The other arm is named, or the model drops it. */
export const thinkingPrompt = (key: KeyName) =>
  `she is thinking: one hand raised with a finger resting on her chin, her eyes glancing up and to the side, a thoughtful closed mouth; ` +
  `her other arm (the one on the right side of the picture) hangs relaxed at her side with the hand visible; ${KEEP(key)}`;

export const blinkPrompt = (key: KeyName) => `change only her eyes: they are closed, as in a blink; keep her expression, mouth, hair, clothes, pose and background identical`;

const TALK = [
  "her lips slightly parted, as if speaking softly",
  "her mouth open a bit wider, as if speaking",
  "her mouth open wide, as if saying something loudly",
];
export const talkPrompt = (level: 1 | 2 | 3) => `change only her mouth: ${TALK[level - 1]}; keep her expression, eyes, hair, clothes, pose and background identical`;

const OTHER_ARM = "her other arm (the one on the right side of the picture) hangs relaxed at her side with the hand visible";
export const POSES: Record<string, (key: KeyName) => string> = {
  "wave-1": (key) => `raise her right hand (the one on the left side of the picture) to shoulder height and wave with an open palm; ${OTHER_ARM}; ${KEEP(key)}`,
  "wave-2": (key) => `raise her right hand (the one on the left side of the picture) higher, waving cheerfully with an open palm; ${OTHER_ARM}; ${KEEP(key)}`,
  "cheer-1": (key) => `raise both arms up in a cheer with her fists in the air, a joyful open-mouthed smile; keep both hands fully inside the picture; ${KEEP(key)}`,
  "cheer-2": (key) => `raise both arms high above her head in a cheer with her fists in the air, a big joyful open-mouthed smile; keep both hands fully inside the picture; ${KEEP(key)}`,
};

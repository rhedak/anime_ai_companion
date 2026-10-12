/**
 * What she shows when asked to show off ("show me all your animations", or `/show`): each emotion in
 * turn, a blink, talking, and the gestures. The model cannot pace this itself, because the tags in a
 * reply play as the text streams in, so the server only lists the steps and the page plays them one
 * by one, naming each (`public/demo.js`).
 */
import type { FramePack } from "./frame-pack.ts";

export type DemoStep =
  | { kind: "emotion"; name: string }
  | { kind: "blink" }
  | { kind: "talk" }
  | { kind: "gesture"; name: string };

export interface DemoMessage {
  type: "demo";
  steps: DemoStep[];
  /** How long each emotion is held, in milliseconds. */
  hold: number;
  /** Things left out, for the line at the end. */
  note?: string;
}

export const DEMO_HOLD_MS = 1000;

/** The steps for the drawn avatar, or for a picture pack (only what its pictures can show). */
export function demoMessage(emotions: string[], gestures: string[], pack: FramePack | null): DemoMessage {
  if (!pack) {
    return {
      type: "demo",
      hold: DEMO_HOLD_MS,
      steps: [
        ...emotions.map((name): DemoStep => ({ kind: "emotion", name })),
        { kind: "blink" },
        { kind: "talk" },
        ...gestures.map((name): DemoStep => ({ kind: "gesture", name })),
      ],
    };
  }
  const have = emotions.filter((name) => pack.emotions[name]);
  const missing = emotions.filter((name) => !pack.emotions[name]);
  const pictures = Object.values(pack.emotions);
  const steps: DemoStep[] = have.map((name) => ({ kind: "emotion", name }));
  if (pictures.some((e) => e.blink)) steps.push({ kind: "blink" });
  if (pictures.some((e) => e.talk.length)) steps.push({ kind: "talk" });
  const left = ["gestures (a picture set cannot raise an arm)", ...(missing.length ? [`${missing.join(", ")} (no pictures)`] : [])];
  return { type: "demo", hold: DEMO_HOLD_MS, steps, note: `Left out in this pack: ${left.join("; ")}.` };
}

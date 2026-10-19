/**
 * What she shows when asked to show off ("show me all your animations", or `/show`): each emotion in
 * turn, a blink, talking, and the gestures. The model cannot pace this itself, because the tags in a
 * reply play as the text streams in, so the server only lists the steps and the page plays them one
 * by one, naming each (`public/demo.js`).
 */
import { BODIES_WITHOUT_EXPRESSIONS, DEMO_HOLD_MS, NO_EXPRESSIONS_TEXT, drawnDemoMessage, packDemoMessage } from "../public/demo.js";
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

export { BODIES_WITHOUT_EXPRESSIONS, DEMO_HOLD_MS, NO_EXPRESSIONS_TEXT };

/** The steps for the drawn avatar, or for a picture pack (only what its pictures can show). */
export function demoMessage(emotions: string[], gestures: string[], pack: FramePack | null): DemoMessage {
  return pack ? packDemoMessage(emotions, gestures, pack) : drawnDemoMessage(emotions, gestures); // the same lists the browser demo uses
}

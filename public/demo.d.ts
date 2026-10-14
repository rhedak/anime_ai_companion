export type DemoStep = { kind: "emotion"; name: string } | { kind: "blink" } | { kind: "talk" } | { kind: "gesture"; name: string };

export const DEMO_HOLD_MS: number;
export function drawnDemoMessage(
  emotions: string[],
  gestures: string[],
): { type: "demo"; hold: number; steps: DemoStep[] };

export function packDemoMessage(
  emotions: string[],
  gestures: string[],
  pack: { emotions: Record<string, { blink?: string; talk: string[] }>; gestures: Record<string, string[]> },
): { type: "demo"; hold: number; steps: DemoStep[]; note?: string };

export function createDemo(
  avatar: {
    setEmotion(name: string): void;
    setTalking(on: boolean): void;
    gesture(name: string, ms?: number): void;
    blink(ms?: number): void;
    warm(emotions: string[], gestures: string[]): Promise<void>;
  },
  caption: { set(text: string): void; done(text: string): void },
  options?: { sleep?: (ms: number) => Promise<void>; gestureMs?: number },
): {
  readonly running: boolean;
  cancel(): void;
  start(message: { steps: DemoStep[]; hold?: number; note?: string }): Promise<void>;
};

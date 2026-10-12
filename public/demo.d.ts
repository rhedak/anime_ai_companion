export interface DemoStep {
  kind: "emotion" | "blink" | "talk" | "gesture";
  name?: string;
}

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

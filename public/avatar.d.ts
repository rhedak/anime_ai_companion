export function sanitize<T extends Element>(root: T): T;

export interface PackEmotionInfo {
  idle: string;
  blink?: string;
  talk: string[];
}

export function createAvatar(
  host: HTMLElement,
  requestFrames: (emotion: string) => void,
  requestGesture: (emotion: string, gesture: string) => void,
  /** Told about a frame that failed to draw (the loop carries on). Defaults to the console. */
  onError?: (error: unknown) => void,
): {
  /** Show a user's picture pack, or the drawn avatar again for null. */
  usePack(info: { name: string; emotions: Record<string, PackEmotionInfo>; gestures?: Record<string, string[]>; activities?: Record<string, { loop: string[]; talk: string[] }> } | null): void;
  readonly packed: boolean;
  setVersion(version: number): void;
  setEmotion(name: string): void;
  setTalking(on: boolean): void;
  setActivity(name: string | null): void;
  setFull(on: boolean): void;
  gesture(name: string, ms?: number): void;
  blink(ms?: number): void;
  warm(emotions: string[], gestures?: string[]): Promise<void>;
  receiveGesture(msg: unknown): void;
  receiveFrames(msg: unknown): void;
};

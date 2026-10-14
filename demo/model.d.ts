export function webgpuSupport(): Promise<{ ok: boolean; f16?: boolean; reason?: string }>;
export function repeatsItself(text: string): boolean;
export function createModel(): {
  ready(): boolean;
  loaded(): boolean;
  setEnabled(on: boolean): void;
  installed(): Promise<boolean>;
  load(onProgress: (fraction: number, text: string) => void): Promise<void>;
  chat(messages: { role: string; content: string }[], onPiece: (piece: string) => void): Promise<string>;
  stop(): void;
  remove(): Promise<void>;
};

export const OLLAMA_URL: string;
export function allowCommand(origin: string): string;
export function createOllamaModel(options?: { fetch?: typeof fetch; url?: string; origin?: string }): {
  kind: "ollama";
  ready(): boolean;
  loaded(): boolean;
  name(): string;
  setEnabled(on: boolean): void;
  probe(): Promise<{ ok: true; models: string[] } | { ok: false; reason: string }>;
  use(name: string): void;
  chat(messages: { role: string; content: string }[], onPiece: (piece: string) => void): Promise<string>;
  stop(): void;
  remove(): Promise<void>;
};

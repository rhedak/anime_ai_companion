export function createModelSwitch(
  ...backends: { ready(): boolean; loaded(): boolean; chat(messages: { role: string; content: string }[], onPiece: (piece: string) => void): Promise<string>; stop(): void; kind?: string }[]
): {
  ready(): boolean;
  loaded(): boolean;
  kind(): string;
  chat(messages: { role: string; content: string }[], onPiece: (piece: string) => void): Promise<string>;
  stop(): void;
};

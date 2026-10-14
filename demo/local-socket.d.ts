export interface LocalSocket {
  readyState: number;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onopen: (() => void) | null;
  send(data: string): void;
  close(): void;
  notice(text: string): void;
}
export interface PackInfo {
  name: string;
  credit?: string;
  terms?: string;
  emotions: Record<string, { idle: string; blink?: string; talk: string[] }>;
  gestures: Record<string, string[]>;
}
export interface Renderer {
  call(request: Record<string, any>): Promise<Record<string, any>>;
}
export function createLocalSocket(options: {
  renderer: Promise<Renderer>;
  emotions: Record<string, Record<string, number>> | Promise<Record<string, Record<string, number>>>;
  reply: (text: string, context?: { presets?: string[]; pack?: boolean }) => { text: string; scene?: string };
  greeting?: string;
  name?: string;
  preset?: string;
  pause?: (ms: number) => Promise<void>;
  packs?: Record<string, PackInfo> | Promise<Record<string, PackInfo>>;
  onPack?: (name: string | null) => void;
}): LocalSocket;

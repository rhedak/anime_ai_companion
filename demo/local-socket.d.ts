export interface LocalSocket {
  readyState: number;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onopen: (() => void) | null;
  send(data: string): void;
  close(): void;
  notice(text: string): void;
}
export interface Renderer {
  call(request: Record<string, any>): Promise<Record<string, any>>;
}
export function createLocalSocket(options: {
  renderer: Promise<Renderer>;
  emotions: Record<string, Record<string, number>>;
  reply: (text: string) => string;
  name?: string;
  preset?: string;
  pause?: (ms: number) => Promise<void>;
}): LocalSocket;

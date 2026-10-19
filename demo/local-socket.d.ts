export interface LocalSocket {
  readyState: number;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onopen: (() => void) | null;
  send(data: string): void;
  close(): void;
  notice(text: string): void;
  announce(text: string): void;
  echo(text: string): void;
  ready: Promise<void>;
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
  reply: (text: string, context?: { presets?: string[]; pack?: boolean; model?: boolean; recent?: string[] }) => { text: string; scene?: string; needsModel?: boolean };
  greeting?: string;
  name?: string;
  preset?: string;
  pause?: (ms: number) => Promise<void>;
  packs?: Record<string, PackInfo> | Promise<Record<string, PackInfo>>;
  /** Who each pack's character is ({ pack: { id, name, default? } }), for the gallery's grouping. */
  characters?: Record<string, { id: string; name: string; default?: string }> | Promise<Record<string, { id: string; name: string; default?: string }>>;
  /** Packs that can be fetched from the packs site (see remote-packs.js), by id. */
  remote?: Record<string, import("./remote-packs.js").RemotePack> | Promise<Record<string, import("./remote-packs.js").RemotePack>>;
  /** Fetches a JSON document (a pack's pack.json); replaced in tests. */
  fetchJson?: (url: string) => Promise<unknown>;
  /** Warms the browser's cache with a picture (the pack's neutral one) before the pack is shown. */
  preload?: (url: string) => Promise<unknown>;
  /** A pack or character id from the page's link (`?pack=…`), shown, or asked about if it must be fetched first. */
  want?: string;
  onPack?: (name: string | null) => void;
  /** The look and pack from the visitor's last visit. */
  restore?: { character?: any; pack?: string | null; base?: string | null } | null;
  /** Called with what to keep for the next visit (her look and pack), or null to forget it. */
  onSave?: (saved: { character: any; pack: string | null; base: string | null } | null) => void;
  model?: { ready(): boolean; kind?: () => string; chat(messages: { role: string; content: string }[], onPiece: (piece: string) => void): Promise<string>; stop(): void } | null;
}): LocalSocket;

export const PACKS_SITE: string;
export interface RemotePack {
  id: string;
  name: string;
  description?: string;
  credit?: string;
  character?: { id: string; name: string };
  sizes: { archiveBytes: number };
  host: string;
  thumb?: string;
  base: string;
  saved: string;
}
export function wantedFromSearch(search: string): string;
export function remotePacksFrom(index: unknown, site?: string): Record<string, RemotePack>;
export function packInfoFrom(
  json: unknown,
  base: string,
): { name: string; character?: string; credit?: string; terms?: string; emotions: Record<string, { idle: string; blink?: string; talk: string[] }>; gestures: Record<string, string[]> } | null;

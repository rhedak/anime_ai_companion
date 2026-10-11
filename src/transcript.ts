import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type TranscriptItem =
  | { type: "user"; text: string; images?: number }
  | { type: "bot"; text: string }
  | { type: "tool"; id: string; name: string; summary: string; status: "running" | "done" | "error" }
  | { type: "look"; applied: string[] }
  | { type: "images"; images: ShownRecord[] }
  | { type: "shell"; command: string; output: string; code: number | null };

/** A picture she showed: served from disk by id, so only the id and where to find it are kept. */
export interface ShownRecord {
  id: string;
  name: string;
  path: string;
  root: string;
  mime: string;
}

export interface TranscriptMeta {
  provider: string;
  /** The Claude Code session this log belongs to, so a restart can resume it. */
  sessionId: string | null;
  /** How big her memory of it was after the last reply, and when that was: enough to tell if the cache has gone cold. */
  contextTokens?: number | null;
  lastReplyAt?: number | null;
}

/**
 * What the chat log shows, kept on the server so a reloaded tab or a restarted
 * server gets the conversation back. Streaming text is gathered into whole
 * messages; it is only the visible log, not the model's memory (that lives in
 * the provider's own session).
 */
export class Transcript {
  items: TranscriptItem[] = [];
  private pending = "";
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  /** Attached pictures are not kept, only how many there were. */
  user(text: string, images = 0): void {
    this.flush();
    this.items.push({ type: "user", text, ...(images ? { images } : {}) });
  }

  delta(text: string): void {
    this.pending += text;
  }

  tool(event: Extract<TranscriptItem, { type: "tool" }>): void {
    this.flush(); // text before a tool call is its own message
    const known = this.items.find((i) => i.type === "tool" && i.id === event.id);
    if (known) Object.assign(known, event);
    else this.items.push({ ...event });
  }

  images(images: ShownRecord[]): void {
    this.flush();
    this.items.push({ type: "images", images });
  }

  /** A picture she showed earlier, by id. */
  findShown(id: string): ShownRecord | undefined {
    for (const item of this.items) if (item.type === "images") for (const image of item.images) if (image.id === id) return image;
    return undefined;
  }

  /** A `!command` the user ran, with what it printed. */
  shell(item: { command: string; output: string; code: number | null }): void {
    this.flush();
    this.items.push({ type: "shell", ...item });
  }

  look(applied: string[]): void {
    this.flush();
    this.items.push({ type: "look", applied });
  }

  /** The log as it stands, including a reply that is still streaming. Does not change anything. */
  snapshot(): TranscriptItem[] {
    return this.pending.trim() ? [...this.items, { type: "bot", text: this.pending }] : this.items;
  }

  /** Close the current streamed message, if any. */
  flush(): void {
    if (this.pending.trim()) this.items.push({ type: "bot", text: this.pending });
    this.pending = "";
  }

  clear(): void {
    this.items = [];
    this.pending = "";
  }

  async load(): Promise<TranscriptMeta | null> {
    try {
      const saved = JSON.parse(await readFile(this.path, "utf8"));
      this.items = Array.isArray(saved.items) ? saved.items.slice(-500) : [];
      const number = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      return {
        provider: String(saved.provider),
        sessionId: saved.sessionId ?? null,
        contextTokens: number(saved.contextTokens),
        lastReplyAt: number(saved.lastReplyAt),
      };
    } catch {
      return null;
    }
  }

  async save(meta: TranscriptMeta): Promise<void> {
    this.flush();
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify({ ...meta, items: this.items.slice(-500) }));
  }
}

/** True if Claude Code still has this session on disk, so `--resume` will find it. */
export async function claudeSessionExists(sessionId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return false;
  const base = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
  try {
    for (const dir of await readdir(base)) {
      if (existsSync(join(base, dir, `${sessionId}.jsonl`))) return true;
    }
  } catch {
    // no projects folder yet
  }
  return false;
}

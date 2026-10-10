import { open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { summarizeTool } from "./providers/claude-stream.ts";
import type { TranscriptItem } from "./transcript.ts";

/**
 * Claude Code keeps every conversation as a JSONL file under
 * ~/.claude/projects/<folder>/<session id>.jsonl. This reads them, so `/resume` can
 * list what is there and rebuild the chat log of the one the user picks. The file
 * format is Claude Code's own and not a stable API; test/sessions.test.ts pins
 * the parts we rely on.
 */

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const HEAD_BYTES = 256 * 1024;

export interface SessionInfo {
  id: string;
  modified: Date;
  /** The first thing the user said, one line, for telling sessions apart. */
  title: string;
}

export const isSessionId = (text: string): boolean => SESSION_ID.test(text);

export function projectsDir(): string {
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
}

/** Claude Code names a folder's session directory after its path, every odd character as "-". */
export function sessionDirFor(cwd: string): string {
  return join(projectsDir(), cwd.replace(/[^a-zA-Z0-9]/g, "-"));
}

/** The most recent sessions that were run in this folder, newest first. */
export async function listSessions(cwd: string, limit = 10): Promise<SessionInfo[]> {
  const dir = sessionDirFor(cwd);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".jsonl") && isSessionId(n.slice(0, -6)));
  } catch {
    return [];
  }
  const dated = await Promise.all(
    names.map(async (name) => ({ name, modified: (await stat(join(dir, name))).mtime })),
  );
  dated.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  const sessions: SessionInfo[] = [];
  for (const { name, modified } of dated) {
    if (sessions.length >= limit) break;
    const title = await firstUserText(join(dir, name));
    if (title !== null) sessions.push({ id: name.slice(0, -6), modified, title });
  }
  return sessions;
}

/** Path of a session file if it exists in this folder's session directory. */
export function sessionPath(cwd: string, id: string): string | null {
  return isSessionId(id) ? join(sessionDirFor(cwd), `${id}.jsonl`) : null;
}

async function firstUserText(path: string): Promise<string | null> {
  let head: string;
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await file.read(buffer, 0, HEAD_BYTES, 0);
    head = buffer.toString("utf8", 0, bytesRead);
  } finally {
    await file.close();
  }
  for (const line of head.split("\n")) {
    const item = userText(parse(line));
    if (item !== null) return item.replace(/\s+/g, " ").trim().slice(0, 70);
  }
  return null; // empty or unreadable: not worth offering
}

function parse(line: string): any {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** Notes this app puts in front of a message so the model knows about its own mistakes. */
const NOTE = /^\(system note, not from the user:[\s\S]*?\)\n\n/;

/** What a user line actually said, or null for tool results, injected context and slash-command echoes. */
function userText(entry: any): string | null {
  if (entry?.type !== "user" || entry.isSidechain || entry.isMeta || entry.isCompactSummary) return null;
  const content = entry.message?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content) && !content.some((b: any) => b?.type === "tool_result")
        ? content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n")
        : "";
  const clean = text.replace(NOTE, "").trim();
  if (!clean || /^<(command-|local-command|system-reminder)/.test(clean)) return null;
  return clean;
}

/** The visible conversation of a session, in the shape the chat log uses. */
export async function loadSessionItems(path: string, keep = 500): Promise<TranscriptItem[]> {
  if ((await stat(path)).size > MAX_FILE_BYTES) throw new Error("That session file is too large to open.");
  const items: TranscriptItem[] = [];
  const tools = new Map<string, Extract<TranscriptItem, { type: "tool" }>>();
  for (const line of (await readFile(path, "utf8")).split("\n")) {
    const entry = parse(line);
    if (!entry || entry.isSidechain) continue;
    if (entry.type === "user") {
      const text = userText(entry);
      if (text !== null) items.push({ type: "user", text });
      else if (Array.isArray(entry.message?.content)) {
        for (const block of entry.message.content) {
          const tool = block?.type === "tool_result" ? tools.get(block.tool_use_id) : undefined;
          if (tool) tool.status = block.is_error ? "error" : "done";
        }
      }
    } else if (entry.type === "assistant" && Array.isArray(entry.message?.content)) {
      for (const block of entry.message.content) {
        if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
          items.push({ type: "bot", text: block.text });
        } else if (block?.type === "tool_use" && typeof block.id === "string") {
          const tool = {
            type: "tool" as const,
            id: block.id,
            name: String(block.name),
            summary: summarizeTool(String(block.name), block.input ?? {}),
            status: "running" as const,
          };
          tools.set(tool.id, tool);
          items.push(tool);
        }
      }
    }
  }
  // A tool call with no recorded result was interrupted; do not show it as still running.
  for (const tool of tools.values()) if (tool.status === "running") tool.status = "done";
  return items.slice(-keep);
}

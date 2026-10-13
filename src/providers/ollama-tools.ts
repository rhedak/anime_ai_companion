import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { runShell } from "../shell.ts";

/**
 * The tools an Ollama model can call in work mode. Ollama only runs the model; reading, searching, running commands and writing
 * files is done here, in the project folder, and everything that changes something goes through the approval card first.
 * Every limit below exists because a small local model will, sooner or later, ask for something silly.
 */

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** What the approval card and the pre-approved list call it (the same names Claude Code uses). */
  card: "Read" | "Grep" | "Bash" | "Write";
  readOnly: boolean;
}

export const TOOLS: ToolSpec[] = [
  {
    name: "read_file",
    card: "Read",
    readOnly: true,
    description: "Read a text file in the project folder. Returns at most 12000 characters; use start_line to read further on.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the project folder." },
        start_line: { type: "integer", description: "First line to return (1 is the first line). Optional." },
      },
      required: ["path"],
    },
  },
  {
    name: "grep",
    card: "Grep",
    readOnly: true,
    description: "Search text files in the project folder for a regular expression. Returns file:line:text for up to 100 matches.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "A JavaScript regular expression." },
        path: { type: "string", description: "A file or folder, relative to the project folder. Default: the whole project." },
        ignore_case: { type: "boolean", description: "Match upper and lower case alike. Default false." },
      },
      required: ["pattern"],
    },
  },
  {
    name: "bash",
    card: "Bash",
    readOnly: false,
    description: "Run one shell command in the project folder (no terminal, no input; stops after 60 seconds). The user approves each command.",
    parameters: { type: "object", properties: { command: { type: "string", description: "The command line." } }, required: ["command"] },
  },
  {
    name: "write_file",
    card: "Write",
    readOnly: false,
    description: "Create or replace a text file in the project folder with exactly this content. The user approves each write.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Path relative to the project folder." }, content: { type: "string", description: "The whole new content of the file." } },
      required: ["path", "content"],
    },
  },
];

export const toolByName = (name: string): ToolSpec | undefined => TOOLS.find((t) => t.name === name);

/** The `tools` list for Ollama's /api/chat. Plan mode offers the read-only ones only. */
export function toolDefinitions(readOnlyOnly: boolean) {
  return TOOLS.filter((t) => !readOnlyOnly || t.readOnly).map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

const READ_CHARS = 12_000;
const RESULT_CHARS = 8_000;
const WRITE_BYTES = 200_000;
const GREP_MATCHES = 100;
const GREP_FILE_BYTES = 1_000_000;
const SKIPPED_DIRS = new Set([".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", "target"]);

export function cut(text: string, limit = RESULT_CHARS): string {
  return text.length > limit ? text.slice(0, limit) + "\n[output cut off]" : text;
}

/** The arguments of a call as an object. Ollama sends an object; some models put a JSON string there. */
export function toArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/**
 * An absolute path for `wanted` that is certainly inside `root`, symlinks followed, or an error. For a file that does not exist
 * yet the nearest existing parent is checked instead, so a link in the middle of the path cannot lead out.
 */
export async function resolveInside(root: string, wanted: unknown): Promise<string> {
  if (typeof wanted !== "string" || !wanted.trim()) throw new Error("A path is needed.");
  if (wanted.includes("\0")) throw new Error("That path is not valid.");
  const realRoot = await realpath(root);
  const target = resolve(realRoot, isAbsolute(wanted) ? wanted : join(realRoot, wanted));
  let probe = target;
  for (;;) {
    try {
      const real = await realpath(probe);
      const rel = relative(realRoot, real);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("outside");
      break;
    } catch (err: any) {
      if (err?.message === "outside") throw new Error("That path is outside the project folder, which is not allowed.");
      const parent = dirname(probe);
      if (parent === probe) throw new Error("That path is outside the project folder, which is not allowed.");
      probe = parent;
    }
  }
  return target;
}

async function readTool(cwd: string, args: Record<string, unknown>): Promise<string> {
  const file = await resolveInside(cwd, args.path);
  const info = await stat(file).catch(() => null);
  if (!info) throw new Error(`There is no file at ${String(args.path)}.`);
  if (!info.isFile()) throw new Error(`${String(args.path)} is not a file.`);
  if (info.size > 5_000_000) throw new Error("That file is too big to read (over 5 MB).");
  const bytes = await readFile(file);
  if (bytes.subarray(0, 8000).includes(0)) throw new Error("That looks like a binary file, not text.");
  const lines = bytes.toString("utf8").split("\n");
  const start = Math.max(1, Math.floor(Number(args.start_line) || 1));
  const text = lines.slice(start - 1).join("\n");
  return text.length > READ_CHARS ? text.slice(0, READ_CHARS) + `\n[cut off after ${READ_CHARS} characters: ask again with a later start_line]` : text;
}

async function* walk(dir: string, signal?: AbortSignal): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (signal?.aborted) return;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) yield* walk(full, signal);
    } else if (entry.isFile()) yield full;
  }
}

async function grepTool(cwd: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  if (typeof args.pattern !== "string" || !args.pattern) throw new Error("A pattern is needed.");
  let regex: RegExp;
  try {
    regex = new RegExp(args.pattern, args.ignore_case ? "i" : "");
  } catch (err: any) {
    throw new Error(`That is not a valid regular expression: ${err.message}`);
  }
  const root = await realpath(cwd);
  const start = args.path === undefined || args.path === "" ? root : await resolveInside(cwd, args.path);
  const info = await stat(start).catch(() => null);
  if (!info) throw new Error(`There is nothing at ${String(args.path)}.`);
  const files = info.isFile() ? (async function* () { yield start; })() : walk(start, signal);
  const found: string[] = [];
  for await (const file of files) {
    if (found.length >= GREP_MATCHES) break;
    const size = (await stat(file).catch(() => null))?.size ?? 0;
    if (size > GREP_FILE_BYTES) continue;
    const bytes = await readFile(file).catch(() => null);
    if (!bytes || bytes.subarray(0, 8000).includes(0)) continue;
    const lines = bytes.toString("utf8").split("\n");
    for (let i = 0; i < lines.length && found.length < GREP_MATCHES; i++) {
      if (regex.test(lines[i])) found.push(`${relative(root, file)}:${i + 1}:${lines[i].slice(0, 300)}`);
    }
  }
  return found.length ? found.join("\n") + (found.length >= GREP_MATCHES ? `\n[stopped at ${GREP_MATCHES} matches]` : "") : "No matches.";
}

async function writeTool(cwd: string, args: Record<string, unknown>): Promise<string> {
  if (typeof args.content !== "string") throw new Error("content must be text.");
  if (Buffer.byteLength(args.content) > WRITE_BYTES) throw new Error("That file is too big to write (over 200 KB).");
  const file = await resolveInside(cwd, args.path);
  const root = await realpath(cwd);
  const rel = relative(root, file);
  if (rel.split(sep).includes(".git")) throw new Error("Files inside .git are not written.");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, args.content);
  return `Wrote ${rel} (${Buffer.byteLength(args.content)} bytes).`;
}

export interface ToolContext {
  cwd: string;
  signal?: AbortSignal;
}

/** Runs one call. Never throws: a failure comes back as text the model can read. */
export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<{ ok: boolean; output: string }> {
  try {
    switch (name) {
      case "read_file":
        return { ok: true, output: await readTool(ctx.cwd, args) };
      case "grep":
        return { ok: true, output: await grepTool(ctx.cwd, args, ctx.signal) };
      case "write_file":
        return { ok: true, output: await writeTool(ctx.cwd, args) };
      case "bash": {
        if (typeof args.command !== "string" || !args.command.trim()) throw new Error("A command is needed.");
        const result = await runShell(args.command, ctx.cwd, { timeoutMs: 60_000, maxBytes: 30_000, signal: ctx.signal });
        const status = result.timedOut ? "[stopped: it ran for more than 60 seconds]" : result.code === 0 ? "" : `[exit code ${result.code}]`;
        return { ok: result.code === 0, output: cut([result.output.trimEnd(), status].filter(Boolean).join("\n") || "(no output)") };
      }
      default:
        return { ok: false, output: `There is no tool called ${name}. The tools are: ${TOOLS.map((t) => t.name).join(", ")}.` };
    }
  } catch (err: any) {
    return { ok: false, output: String(err?.message ?? err) };
  }
}

/** What the approval card shows for a call: the tool as Claude Code names it, one line, and the exact input. */
export function describeCall(name: string, args: Record<string, unknown>): { tool: string; summary: string; input: Record<string, unknown> } {
  const spec = toolByName(name);
  const tool = spec?.card ?? name;
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  switch (name) {
    case "bash":
      return { tool, summary: text(args.command).replace(/\s+/g, " ").trim().slice(0, 120), input: { command: text(args.command) } };
    case "write_file":
      return { tool, summary: text(args.path), input: { file_path: text(args.path), content: text(args.content) } };
    case "read_file":
      return { tool, summary: text(args.path), input: { file_path: text(args.path) } };
    case "grep":
      return { tool, summary: `${text(args.pattern)}${args.path ? ` in ${text(args.path)}` : ""}`, input: { pattern: text(args.pattern), path: text(args.path) } };
    default:
      return { tool, summary: basename(name), input: args };
  }
}

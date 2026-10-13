/**
 * `anaico --doctor`: looks at what the app needs and says what is missing, in plain words. It only looks: nothing is installed,
 * started or signed in. Every check goes through a `Probe`, so the checks can be tested without this machine's real setup.
 */
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { MIN_NODE, tooOld } from "../bin/check-node.js";
import { pythonCommand } from "./python.ts";

export type Level = "ok" | "warn" | "fail";
export interface DoctorLine {
  level: Level;
  text: string;
  /** What to do about it, when there is something to do. */
  hint?: string;
}

export interface Probe {
  env: Record<string, string | undefined>;
  nodeVersion: string;
  /** This repository's folder. */
  root: string;
  home: string;
  python: string;
  port: number;
  /** Runs a program for its output; null when it is not there or does not answer. */
  run(command: string, args: string[]): string | null;
  exists(path: string): boolean;
  readText(path: string): string | null;
  writable(dir: string): boolean;
  /** The body of a GET, or null when nothing answers. */
  get(url: string): Promise<string | null>;
  portFree(port: number): Promise<boolean>;
}

export function realProbe(root: string, port: number): Probe {
  return {
    env: process.env,
    nodeVersion: process.versions.node,
    root,
    home: homedir(),
    python: pythonCommand(),
    port,
    run(command, args) {
      const result = spawnSync(command, args, { encoding: "utf8", timeout: 8000 });
      if (result.error || result.status !== 0) return null;
      return `${result.stdout}${result.stderr}`.trim();
    },
    exists: existsSync,
    readText(path) {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    writable(dir) {
      try {
        accessSync(dir, constants.W_OK);
        return true;
      } catch {
        return false;
      }
    },
    async get(url) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
        return await res.text();
      } catch {
        return null;
      }
    },
    portFree(p) {
      return new Promise((resolvePort) => {
        const server = createServer();
        server.once("error", () => resolvePort(false));
        server.listen(p, "127.0.0.1", () => server.close(() => resolvePort(true)));
      });
    },
  };
}

/** "Python 3.12.1" -> [3, 12]; null when it does not look like a version. */
export function parsePython(output: string): [number, number] | null {
  const match = /Python\s+(\d+)\.(\d+)/.exec(output);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

const firstLine = (text: string) => text.split("\n")[0].trim();

export async function checkAll(p: Probe): Promise<DoctorLine[]> {
  const lines: DoctorLine[] = [];
  const add = (level: Level, text: string, hint?: string) => lines.push({ level, text, hint });

  // Node
  if (tooOld(p.nodeVersion)) add("fail", `Node ${p.nodeVersion} is too old`, `Install Node ${MIN_NODE} or newer: https://nodejs.org`);
  else add("ok", `Node ${p.nodeVersion} (needs ${MIN_NODE.replace(/\.0$/, "")} or newer)`);

  // Dependencies
  if (p.exists(join(p.root, "node_modules", "ws"))) add("ok", "npm packages are installed");
  else add("fail", "npm packages are not installed", "Run: npm install");

  // Python, which draws her
  const version = p.run(p.python, ["--version"]);
  const parsed = version ? parsePython(version) : null;
  if (!parsed) {
    add("fail", `Python not found (looked for ${p.python})`, "Install Python 3.11 or newer, or run `uv sync` here to make a .venv with one. PYTHON=/path/to/python picks another.");
  } else if (parsed[0] < 3 || (parsed[0] === 3 && parsed[1] < 11)) {
    add("fail", `Python ${parsed[0]}.${parsed[1]} is too old for the character drawing (${p.python})`, "Run `uv sync` here (makes a .venv with a new enough Python), or set PYTHON=/path/to/python3.11+");
  } else {
    add("ok", `Python ${parsed[0]}.${parsed[1]} (${p.python})`);
  }

  // The character creator
  const sibling = resolve(p.root, "../anime-character-creator/src");
  const pinned = (() => {
    try {
      return JSON.parse(p.readText(join(p.root, "package.json")) ?? "{}").creator?.ref as string | undefined;
    } catch {
      return undefined;
    }
  })();
  const cloned = pinned ? join(p.env.ANAICO_HOME ?? join(p.home, ".anaico"), "creator", pinned, "src") : "";
  if (p.env.CREATOR_SRC) {
    if (p.exists(p.env.CREATOR_SRC)) add("ok", `Character creator: ${p.env.CREATOR_SRC} (CREATOR_SRC)`);
    else add("fail", `CREATOR_SRC points at ${p.env.CREATOR_SRC}, which does not exist`, "Fix the path, or unset CREATOR_SRC to use a checkout next to this repo or the pinned release.");
  } else if (p.exists(sibling)) add("ok", `Character creator: the checkout next to this repo (${sibling})`);
  else if (cloned && p.exists(cloned)) add("ok", `Character creator ${pinned}: already fetched (${cloned})`);
  else if (p.run("git", ["--version"])) add("warn", `Character creator ${pinned ?? ""}: not here yet, so the first start downloads it into ${cloned || "~/.anaico/creator"}`, "That needs internet once. Or clone it next to this repo: git clone https://github.com/rhedak/anime-character-creator.git ../anime-character-creator");
  else add("fail", "Character creator: not found, and git is not installed to fetch it", "Install git, or clone https://github.com/rhedak/anime-character-creator.git next to this repo and run again.");

  // Brains: at least one must be there. Whether you are signed in is the brain's own business, so this does not try.
  const claude = p.run("claude", ["--version"]);
  const cursor = p.run("cursor-agent", ["--version"]);
  const opencode = p.run("opencode", ["--version"]);
  const host = (p.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
  const tags = await p.get(`${host}/api/tags`);
  let ollamaModels: number | null = null;
  try {
    if (tags) ollamaModels = (JSON.parse(tags).models ?? []).length;
  } catch {
    ollamaModels = null;
  }
  const found: string[] = [];
  if (claude) found.push("Claude Code");
  if (cursor) found.push("Cursor");
  if (opencode) found.push("opencode");
  if (ollamaModels !== null) found.push("Ollama");
  const brain = (name: string, version: string | null, note: string) =>
    version ? add("ok", `${name} ${firstLine(version)}`, note) : add("warn", `${name}: not found`, `Only needed if you want to use it. ${note}`);
  brain("Claude Code", claude, "Sign in once by running `claude` in a terminal.");
  brain("Cursor", cursor, "Sign in once with `cursor-agent login`, or set CURSOR_API_KEY.");
  brain("opencode", opencode, "Sign in once with `opencode auth login`.");
  if (ollamaModels === null) add("warn", `Ollama: nothing answers at ${host}`, "Only needed for local models. Install it from https://ollama.com, run `ollama serve`, and `ollama pull llama3.2`.");
  else if (ollamaModels === 0) add("warn", `Ollama answers at ${host}, but has no models`, "Pull one, for example: ollama pull llama3.2");
  else add("ok", `Ollama at ${host} with ${ollamaModels} model${ollamaModels === 1 ? "" : "s"}`);
  if (!found.length) add("fail", "No brain found: she needs Claude Code, Cursor, opencode or Ollama", "Install one of them (the README says how), then run this again.");

  // Port
  if (await p.portFree(p.port)) add("ok", `Port ${p.port} is free`);
  else if ((await p.get(`http://127.0.0.1:${p.port}/`)) !== null) add("ok", `Port ${p.port}: something answers, probably the companion is already running`, "`anaico --status` says whether it is the background one.");
  else add("warn", `Port ${p.port} is in use by something that is not answering as a web page`, "Set PORT=<another number> to use a different one.");

  // Where her data lives
  const data = join(p.root, "data");
  if (p.exists(data) ? p.writable(data) : p.writable(p.root)) add("ok", "data/ is writable (settings, chat log, her look)");
  else add("fail", "data/ is not writable", `Fix the permissions on ${p.exists(data) ? data : p.root}.`);

  return lines;
}

const mark: Record<Level, string> = { ok: "✓", warn: "!", fail: "✗" };

export function formatDoctor(lines: DoctorLine[]): string {
  const body = lines.map((l) => `${mark[l.level]} ${l.text}${l.hint && l.level !== "ok" ? `\n    ${l.hint}` : ""}`).join("\n");
  const fails = lines.filter((l) => l.level === "fail").length;
  const warns = lines.filter((l) => l.level === "warn").length;
  const summary = fails
    ? `${fails} problem${fails === 1 ? "" : "s"} to fix before it will start.`
    : warns
      ? "Ready to start. The ! lines are optional."
      : "Everything looks fine.";
  return `${body}\n\n${summary}`;
}

/** Runs the checks, prints them, and returns the exit code (1 when something must be fixed). */
export async function doctor(root: string, port: number, probe: Probe = realProbe(root, port)): Promise<number> {
  console.log("anaico doctor: looking at what the companion needs (nothing is changed)\n");
  const lines = await checkAll(probe);
  console.log(formatDoctor(lines));
  return lines.some((l) => l.level === "fail") ? 1 : 0;
}

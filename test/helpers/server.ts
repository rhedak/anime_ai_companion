import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { removeDir, symlinkDir, sweepStale } from "./platform.ts";
import { baseEnv, pathOf, systemPathDirs, writeStandIn } from "./standin.ts";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

/**
 * Runs a throwaway copy of the whole app (its own data/, a random port) against a stand-in `claude`, and gives tests a websocket
 * client. A real `claude`, Cursor or Ollama is never started: the stand-in is the only `claude` on the server's PATH, and nothing
 * here touches the real data/ or login. Used by test/server.test.ts.
 */

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The creator's TypeScript the server draws with: CREATOR_SRC (its `ts/src` folder), else the checkout next to this repo. */
export function creatorSrcForServer(): string {
  return process.env.CREATOR_SRC ?? resolve(repo, "../anime-character-creator/ts/src");
}

/** Why the server tests cannot run here, or null. They need the creator's TypeScript, like the renderer tests. */
export function cannotRunServer(): string | null {
  if (!existsSync(join(creatorSrcForServer(), "render.ts"))) return "the character creator's TypeScript is not next to this repo (set CREATOR_SRC to its ts/src folder)";
  return null;
}

/** The stand-in `claude`: answers like the real stream-json CLI for the few message shapes the tests use. */
const STAND_IN = `#!${process.execPath}
const fs = require("fs");
const log = (o) => fs.appendFileSync(process.env.STANDIN_LOG, JSON.stringify(o) + "\\n");
const out = (o) => console.log(JSON.stringify(o));
const delay = Number(process.env.STANDIN_DELAY || 0);
const args = process.argv.slice(2);
log({ kind: "argv", args });
const delta = (text) => out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
const result = (isError = false) => out({ type: "result", is_error: isError, result: "", usage: {}, modelUsage: {} });
const init = () => out({ type: "system", subtype: "init", session_id: "stand-in", model: "claude-stand-in" });
init();
let timers = [];
const later = (ms, fn) => timers.push(setTimeout(fn, ms));
require("readline").createInterface({ input: process.stdin }).on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.type === "control_request") {
    if (msg.request && msg.request.subtype === "interrupt") { timers.forEach(clearTimeout); timers = []; result(true); }
    return;
  }
  if (msg.type !== "user") return;
  const content = msg.message.content;
  const text = typeof content === "string" ? content : content.map((c) => c.text || "").join(" ");
  log({ kind: "in", text });
  later(delay, () => {
    if (text.includes("TOOLFAIL")) {
      out({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Skill", input: { skill: "pinecone" } }] } });
      out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true }] } });
      delta("[emotion:thinking] I will read it by hand.");
      result();
    } else if (text.includes("REMEMBER")) {
      delta("[emotion:happy] Noted! [remember Their cat is called Momo]");
      result();
    } else if (text.includes("SUBAGENT")) {
      out({ type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "a1", description: "Review the draft" }] });
      delta("[emotion:thinking] Waiting for the reviewer.");
      result();
      later(250, () => {
        out({ type: "system", subtype: "background_tasks_changed", tasks: [] });
        init();
        delta("[emotion:happy] The review is back.");
        result();
      });
    } else {
      // What the user typed, without the system note the app puts in front of it.
      delta("[emotion:happy] echo: " + text.replace(/^\\(system note, not from the user:[\\s\\S]*?\\)\\n\\n/, "").replace(/\\s+/g, " ").slice(-80));
      result();
    }
  });
});
`;

export interface Message {
  type: string;
  [key: string]: any;
}

export class Client {
  readonly events: Message[] = [];
  private readonly ws: WebSocket;
  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (raw) => this.events.push(JSON.parse(String(raw))));
  }

  static connect(port: number, origin: string | null = `http://127.0.0.1:${port}`): Promise<Client> {
    return new Promise((resolveClient, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin === null ? {} : { headers: { Origin: origin } });
      const client = new Client(ws);
      ws.once("open", () => resolveClient(client));
      ws.once("error", reject);
      ws.once("unexpected-response", (_req, res) => reject(new Error(`refused: HTTP ${res.statusCode}`)));
    });
  }

  send(message: Message): void {
    this.ws.send(JSON.stringify(message));
  }

  say(text: string): void {
    this.send({ type: "user", text });
  }

  /** The first event from index `from` (default: the start, so the page's opening messages can be waited for) that matches, or an error after `ms`. */
  async next(match: string | ((e: Message) => boolean), ms = 8000, from = 0): Promise<Message> {
    const test = typeof match === "string" ? (e: Message) => e.type === match : match;
    const started = Date.now();
    for (;;) {
      const found = this.events.slice(from).find(test);
      if (found) return found;
      if (Date.now() - started > ms) throw new Error(`timed out waiting for ${typeof match === "string" ? match : "an event"}; saw: ${this.events.slice(from).map((e) => e.type).join(", ") || "nothing"}`);
      await new Promise((r) => setTimeout(r, 15));
    }
  }

  /** Everything received since `from`. */
  since(from: number): Message[] {
    return this.events.slice(from);
  }

  get mark(): number {
    return this.events.length;
  }

  /** Waits until a reply ends (after index `from`). */
  done(from = 0, ms = 8000): Promise<Message> {
    return this.next((e) => e.type === "done" || e.type === "error", ms, from);
  }

  close(): void {
    this.ws.close();
  }
}

export interface RunningServer {
  port: number;
  /** The throwaway copy of the app: its data/ and workspace/ are in here. */
  dir: string;
  /** A folder to use as a project in work mode. */
  project: string;
  /** What the stand-in `claude` was started with and sent. */
  claudeLog(): { kind: string; args?: string[]; text?: string }[];
  /** The system prompt of the latest `claude` start. */
  systemPrompt(): string;
  data(name: string): string | null;
  client(origin?: string | null): Promise<Client>;
  stop(): Promise<void>;
}

export interface ServerOptions {
  env?: Record<string, string>;
  /** Settings to start with (data/settings.json). */
  settings?: Record<string, unknown>;
  /** How long the stand-in takes to answer. */
  delay?: number;
  /** Files to put in the user's skills folder (CLAUDE_CONFIG_DIR/skills). */
  userSkills?: string[];
  /** Start with a big conversation that has been idle for two hours, so Claude's prompt cache is cold. */
  coldConversation?: boolean;
  /** Start as a brand-new install: no data/settings.json yet. */
  firstStart?: boolean;
}

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  sweepStale("anaico-test-", ["anaico-test-launcher"]); // folders an earlier run could not delete (Windows holds them for a while)
  const dir = mkdtempSync(join(tmpdir(), "anaico-test-"));
  const app = join(dir, "app");
  mkdirSync(app);
  for (const name of ["src", "public", "bin", "persona.md", "persona-work.md", "emotions.json", "package.json"]) cpSync(join(repo, name), join(app, name), { recursive: true });
  symlinkDir(join(repo, "node_modules"), join(app, "node_modules"));
  mkdirSync(join(app, "data"));
  if (!options.firstStart) writeFileSync(join(app, "data", "settings.json"), JSON.stringify({ provider: "claude", ...options.settings }));

  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeStandIn(bin, "claude", STAND_IN);
  const config = join(dir, "claude-config");
  for (const skill of options.userSkills ?? []) {
    mkdirSync(join(config, "skills", skill), { recursive: true });
    writeFileSync(join(config, "skills", skill, "SKILL.md"), `---\nname: ${skill}\ndescription: test\n---\nbody\n`);
  }
  mkdirSync(config, { recursive: true });
  mkdirSync(join(dir, "home"));
  if (options.coldConversation) {
    const sessionId = "11111111-2222-4333-8444-555555555555";
    mkdirSync(join(config, "projects", "earlier"), { recursive: true });
    writeFileSync(join(config, "projects", "earlier", `${sessionId}.jsonl`), "");
    writeFileSync(
      join(app, "data", "transcript.json"),
      JSON.stringify({
        provider: "claude",
        sessionId,
        contextTokens: 150_000,
        lastReplyAt: Date.now() - 2 * 3600_000,
        items: [{ type: "user", text: "earlier question" }, { type: "bot", text: "earlier answer" }],
      }),
    );
  }
  const project = join(dir, "project");
  mkdirSync(project);
  const log = join(dir, "claude.log");
  writeFileSync(log, "");

  // A free port: ask the OS, then let go of it for the server.
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));

  const output: string[] = [];
  const child: ChildProcess = spawn(process.execPath, ["src/server.ts"], {
    cwd: app,
    env: {
      // Only the stand-in `claude` is reachable: a real one cannot start from a test.
      PATH: pathOf(bin, dirname(process.execPath), ...systemPathDirs()),
      ...baseEnv(join(dir, "home")),
      PORT: String(port),
      CLAUDE_CONFIG_DIR: config,
      CREATOR_SRC: creatorSrcForServer(),
      STANDIN_LOG: log,
      STANDIN_DELAY: String(options.delay ?? 0),
      COMPANION_NO_NUDGE: "1",
      ...options.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (c) => output.push(String(c)));
  child.stderr?.on("data", (c) => output.push(String(c)));

  const started = Date.now();
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the server exited (${child.exitCode}):\n${output.join("")}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() - started > 30000) {
      child.kill();
      throw new Error(`the server did not start in 30 s:\n${output.join("")}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  const clients: Client[] = [];
  const claudeLog = () =>
    readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  return {
    port,
    dir: app,
    project,
    claudeLog,
    systemPrompt() {
      const starts = claudeLog().filter((e) => e.kind === "argv");
      const args = starts.at(-1)?.args ?? [];
      return args[args.indexOf("--append-system-prompt") + 1] ?? "";
    },
    data(name) {
      try {
        return readFileSync(join(app, "data", name), "utf8");
      } catch {
        return null;
      }
    },
    async client(origin) {
      const c = await Client.connect(port, origin === undefined ? `http://127.0.0.1:${port}` : origin);
      clients.push(c);
      return c;
    },
    async stop() {
      clients.forEach((c) => c.close());
      // Windows has no signals and `kill` ends only the server: its brain (the stand-in and the Node it runs) would go on holding the folder.
      if (process.platform === "win32" && child.pid && child.exitCode === null) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      else child.kill("SIGTERM");
      await new Promise<void>((r) => {
        if (child.exitCode !== null) return r();
        child.once("exit", () => r());
        setTimeout(() => {
          child.kill("SIGKILL");
          r();
        }, 3000);
      });
      removeDir(dir);
    },
  };
}

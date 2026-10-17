import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawnCli } from "../spawn-cli.ts";
import { createInterface } from "node:readline";
import type { ImageInput } from "../images.ts";
import {
  cursorArgs,
  cursorSessionMode,
  displayModel,
  interpretAcp,
  parseModels,
  permissionResult,
  pickCursorModel,
  planResult,
  promptBlocks,
  type AcpPermission,
  type CursorModel,
} from "./cursor-acp.ts";
import type { Decision, Provider, ProviderEvent, SessionConfig, Usage } from "./types.ts";

type SpawnAgent = (args: string[], cwd: string) => ChildProcessWithoutNullStreams;

export interface CursorOptions {
  config: SessionConfig;
  /** Folder used in chat mode, where she has no tools. */
  chatCwd: string;
  /** The companion instructions, resolved each turn so the current look is included. */
  persona: (config: SessionConfig) => string;
  /** Continue this ACP session after a restart, if it still exists. */
  resumeSessionId?: string;
  /** Test hook. Defaults to `cursor-agent` on PATH (not `agent`, which may be another CLI). */
  spawnAgent?: SpawnAgent;
}

interface PendingPermission extends AcpPermission {}

/**
 * One Cursor agent over ACP (`cursor-agent acp`). The same pause as the IDE:
 * `session/request_permission` waits until the approval card answers. Run
 * Everything is the process started with `--force`; leaving it starts again
 * without that flag and reloads the session.
 */
export class CursorProvider implements Provider {
  readonly canUseTools = true;
  private config: SessionConfig;
  private readonly chatCwd: string;
  private readonly persona: (config: SessionConfig) => string;
  private readonly spawnAgent: SpawnAgent;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private appliedCwd = "";
  private appliedForce = false;
  /** Bumped on reset so a sync that was already running gives up. */
  private token = 0;
  private sessionIdValue: string | null;
  /** The process is up but its session was thrown away or not opened yet. */
  private stale = true;
  private models: CursorModel[] = [];
  private currentModelId = "";
  private appliedMode: "ask" | "plan" | "agent" | "" = "";
  private listener: ((event: ProviderEvent) => void) | null = null;
  private pending = new Map<string, PendingPermission>();
  private tools = new Map<string, { name: string; summary: string }>();
  private waiters = new Map<number | string, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  private nextId = 1;
  private tail: Promise<void> = Promise.resolve();
  private interrupted = false;
  private usageValue: Usage = { turns: 0, costUsd: 0, contextTokens: null, contextWindow: null };
  /** Why the last start failed, so a browser that connects later can be told. */
  lastError: string | null = null;
  /** The saved session was gone, so a new one was opened. The server says so once. */
  replacedSession = false;

  constructor(opts: CursorOptions) {
    this.config = opts.config;
    this.chatCwd = opts.chatCwd;
    this.persona = opts.persona;
    this.spawnAgent = opts.spawnAgent ?? defaultSpawn;
    this.sessionIdValue = opts.resumeSessionId ?? null;
  }

  get name(): string {
    const model = this.modelLabel;
    return model ? `cursor (${model})` : "cursor";
  }

  get sessionId(): string | null {
    return this.sessionIdValue;
  }

  get usage(): Usage {
    return this.usageValue;
  }

  get busy(): boolean {
    return this.listener !== null;
  }

  /** Short name of the model in use, for the menu and the work bar. */
  get modelLabel(): string {
    return this.currentModelId ? displayModel(this.models, this.currentModelId) : "";
  }

  get modelId(): string {
    return this.currentModelId;
  }

  get availableModels(): CursorModel[] {
    return this.models;
  }

  /** Starts the agent if it is not up yet. Rejects when `cursor-agent` cannot start. */
  whenReady(): Promise<void> {
    return this.enqueue(() => this.sync());
  }

  send(text: string, onEvent: (event: ProviderEvent) => void, images: ImageInput[] = []): void {
    if (this.listener) {
      onEvent({ type: "error", message: "Still answering the previous message." });
      return;
    }
    this.listener = onEvent;
    this.interrupted = false;
    void this.enqueue(() => this.turn(text, images));
  }

  respondPermission(id: string, decision: Decision): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    const result = pending.kind === "plan" ? planResult(decision) : permissionResult(decision, pending.options);
    this.reply(pending.rpcId, result);
  }

  interrupt(): boolean {
    if (!this.listener || !this.proc || !this.sessionIdValue) return false;
    this.interrupted = true;
    for (const pending of this.pending.values()) this.reply(pending.rpcId, { outcome: { outcome: "cancelled" } });
    for (const id of this.pending.keys()) this.listener({ type: "permission-cancelled", id });
    this.pending.clear();
    this.notify("session/cancel", { sessionId: this.sessionIdValue });
    return true;
  }

  configure(config: SessionConfig): void {
    if (this.listener) throw new Error("Wait for the current reply to finish first.");
    this.config = config;
    void this.enqueue(() => this.sync());
  }

  setPermissionMode(mode: SessionConfig["permissionMode"]): void {
    // A card can switch this while a turn is in progress. Restarting then would
    // kill the turn, so the change is applied once she finishes.
    this.config = { ...this.config, permissionMode: mode };
    if (!this.listener) void this.enqueue(() => this.sync());
  }

  reset(): void {
    this.token++;
    this.interrupted = true;
    this.sessionIdValue = null;
    this.stale = true;
    this.currentModelId = "";
    this.usageValue = { turns: 0, costUsd: 0, contextTokens: null, contextWindow: null };
    this.dropPending();
    if (this.listener) this.finish({ type: "done" });
    this.kill();
  }

  resume(sessionId: string): void {
    if (this.listener) throw new Error("Wait for the current reply to finish first.");
    this.sessionIdValue = sessionId;
    this.stale = true;
    this.usageValue = { turns: 0, costUsd: 0, contextTokens: null, contextWindow: null };
    this.kill();
  }

  async listSessions(cwd: string): Promise<{ id: string; title: string; modified: Date }[]> {
    return this.enqueue(async () => {
      await this.boot();
      const result = (await this.request("session/list", { cwd })) as { sessions?: unknown };
      const sessions = Array.isArray(result?.sessions) ? result.sessions : [];
      return sessions.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const session = item as { sessionId?: unknown; title?: unknown; updatedAt?: unknown };
        if (typeof session.sessionId !== "string") return [];
        const modified = typeof session.updatedAt === "string" ? new Date(session.updatedAt) : new Date();
        const title = typeof session.title === "string" && session.title.trim() ? session.title.trim() : session.sessionId.slice(0, 8);
        return [{ id: session.sessionId, title, modified: Number.isNaN(modified.getTime()) ? new Date() : modified }];
      });
    });
  }

  close(): void {
    this.token++;
    this.dropPending();
    if (this.listener) this.finish({ type: "error", message: "Stopped." });
    this.kill();
  }

  private cwd(): string {
    return this.config.mode === "work" ? this.config.cwd : this.chatCwd;
  }

  private wantsForce(): boolean {
    return this.config.mode === "work" && this.config.permissionMode === "everything";
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job, job);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async sync(): Promise<void> {
    const token = this.token;
    try {
      await this.boot();
      if (token !== this.token) return;
      if (!this.sessionIdValue || this.stale) await this.openSession();
      if (token !== this.token || !this.sessionIdValue) return;
      await this.applyModeAndModel();
      this.lastError = null;
    } catch (err) {
      if (token !== this.token) return;
      this.lastError = err instanceof Error ? err.message : String(err);
      this.kill();
      throw err instanceof Error ? err : new Error(this.lastError);
    }
  }

  private async boot(): Promise<void> {
    const cwd = this.cwd();
    const force = this.wantsForce();
    if (this.proc && this.appliedCwd === cwd && this.appliedForce === force) return;
    const token = this.token;
    this.kill();
    const proc = this.spawnAgent(cursorArgs(this.config.mode, force ? "everything" : this.config.permissionMode), cwd);
    this.proc = proc;
    this.appliedCwd = cwd;
    this.appliedForce = force;
    this.stale = true;
    createInterface({ input: proc.stdout }).on("line", (line) => {
      if (this.proc === proc) this.onLine(line);
    });
    proc.stderr.on("data", (chunk) => process.stderr.write(`[cursor] ${chunk}`));
    proc.on("error", (err) => {
      if (this.proc !== proc) return;
      this.proc = null;
      const message = (err as NodeJS.ErrnoException).code === "ENOENT"
        ? "cursor-agent is not installed or not on PATH."
        : `Could not start cursor-agent: ${err.message}`;
      this.failWaiters(message);
      if (this.listener) this.finish({ type: "error", message });
    });
    proc.on("exit", (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      const message = `cursor-agent exited (${code ?? "signal"}).`;
      this.failWaiters(message);
      if (this.listener && !this.interrupted) this.finish({ type: "error", message });
    });
    try {
      await this.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "anime-ai-companion", version: "0.1.0" },
      });
      await this.request("authenticate", { methodId: "cursor_login" });
    } catch (err) {
      if (token !== this.token) return;
      throw new Error(loginHint(err));
    }
  }

  private async openSession(): Promise<void> {
    const token = this.token;
    const cwd = this.cwd();
    if (this.sessionIdValue) {
      try {
        this.rememberModels(await this.request("session/load", { sessionId: this.sessionIdValue, cwd, mcpServers: [] }));
        this.stale = false;
        return;
      } catch (err) {
        if (token !== this.token || !this.proc) throw err;
        console.error(`[cursor] could not resume ${this.sessionIdValue}: ${err instanceof Error ? err.message : err}`);
        this.sessionIdValue = null;
        this.replacedSession = true;
      }
    }
    if (token !== this.token) return;
    this.rememberModels(await this.request("session/new", { cwd, mcpServers: [] }));
    this.stale = false;
  }

  private rememberModels(result: unknown): void {
    const parsed = parseModels(result);
    const body = result as { sessionId?: unknown };
    if (typeof body?.sessionId === "string") this.sessionIdValue = body.sessionId;
    if (parsed.models.length) this.models = parsed.models;
    if (parsed.currentModelId) this.currentModelId = parsed.currentModelId;
  }

  private async applyModeAndModel(): Promise<void> {
    const sessionId = this.sessionIdValue;
    if (!sessionId) return;
    const modeId = cursorSessionMode(this.config.mode, this.config.permissionMode);
    await this.request("session/set_mode", { sessionId, modeId });
    this.appliedMode = modeId;
    const wanted = pickCursorModel(this.models, this.config.model);
    if (this.config.model.trim() && !wanted) throw new Error(`Unknown Cursor model "${this.config.model}".`);
    if (wanted && wanted !== this.currentModelId) {
      await this.request("session/set_config_option", { sessionId, configId: "model", value: wanted });
      this.currentModelId = wanted;
    }
  }

  private async turn(text: string, images: ImageInput[]): Promise<void> {
    const token = this.token;
    try {
      await this.sync();
      if (token !== this.token || !this.listener) return;
      if (!this.sessionIdValue) throw new Error(this.lastError ?? "Cursor agent has no session.");
      await this.request("session/prompt", {
        sessionId: this.sessionIdValue,
        prompt: promptBlocks(this.persona(this.config), text, images),
      });
      if (token !== this.token || !this.listener) return;
      this.usageValue = { ...this.usageValue, turns: this.usageValue.turns + 1 };
      this.interrupted = false;
      this.finish({ type: "done" });
    } catch (err) {
      if (token !== this.token || !this.listener) return;
      if (this.interrupted) {
        this.interrupted = false;
        this.finish({ type: "done" });
        return;
      }
      this.finish({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      const mode = cursorSessionMode(this.config.mode, this.config.permissionMode);
      if (!this.listener && (this.wantsForce() !== this.appliedForce || mode !== this.appliedMode)) {
        void this.enqueue(() => this.sync());
      }
    }
  }

  private onLine(line: string): void {
    let msg: { id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id != null && msg.method == null) {
      const waiter = typeof msg.id === "number" || typeof msg.id === "string" ? this.waiters.get(msg.id) : undefined;
      if (!waiter || (typeof msg.id !== "number" && typeof msg.id !== "string")) return;
      this.waiters.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message ?? "Cursor agent error"));
      else waiter.resolve(msg.result);
      return;
    }
    if (typeof msg.method !== "string") return;
    const effect = interpretAcp(msg, this.config.allowedTools);
    for (const reply of effect.replies) {
      if (reply.error) this.reply(reply.id, undefined, reply.error);
      else this.reply(reply.id, reply.result);
    }
    if (effect.permission) {
      if (!this.listener) {
        this.reply(effect.permission.rpcId, effect.permission.kind === "plan" ? planResult("deny") : permissionResult("deny", effect.permission.options));
      } else {
        this.pending.set(effect.permission.id, effect.permission);
        this.listener({ type: "permission", request: effect.permission.request });
      }
    }
    for (const event of effect.events) {
      const shown = event.type === "tool" ? this.rememberTool(event) : event;
      this.listener?.(shown);
    }
  }

  private rememberTool(event: Extract<ProviderEvent, { type: "tool" }>): Extract<ProviderEvent, { type: "tool" }> {
    const known = this.tools.get(event.id);
    const name = event.name === "tool" && known ? known.name : event.name;
    const summary = event.summary || known?.summary || "";
    const next = { ...event, name, summary };
    this.tools.set(event.id, { name, summary });
    return next;
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const proc = this.proc;
    if (!proc) return Promise.reject(new Error(this.lastError ?? "Cursor agent is not running."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiters.set(id, { resolve, reject });
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  private notify(method: string, params: unknown): void {
    this.proc?.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  private reply(id: number | string, result?: unknown, error?: { code: number; message: string }): void {
    const body = error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result };
    this.proc?.stdin.write(JSON.stringify(body) + "\n");
  }

  private dropPending(): void {
    for (const id of this.pending.keys()) this.listener?.({ type: "permission-cancelled", id });
    this.pending.clear();
  }

  private finish(event: ProviderEvent): void {
    const listener = this.listener;
    if (!listener) return;
    this.listener = null;
    listener(event);
  }

  private failWaiters(message: string): void {
    for (const waiter of this.waiters.values()) waiter.reject(new Error(message));
    this.waiters.clear();
  }

  private kill(): void {
    const proc = this.proc;
    this.proc = null;
    this.appliedCwd = "";
    this.failWaiters("Cursor agent stopped.");
    proc?.kill();
  }
}

function defaultSpawn(args: string[], cwd: string): ChildProcessWithoutNullStreams {
  return spawnCli(process.env.CURSOR_AGENT ?? "cursor-agent", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
}

function loginHint(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/auth|login|sign/i.test(message)) return `${message} Run \`cursor-agent login\` in a terminal, or set CURSOR_API_KEY.`;
  return message;
}

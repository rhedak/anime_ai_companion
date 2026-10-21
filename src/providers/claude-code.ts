import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawnCli } from "../spawn-cli.ts";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { parseAutocompact } from "../cache-guard.ts";
import { parseStreamLine, permissionResponse, summarizeTool, type BackgroundTask, type StreamItem } from "./claude-stream.ts";
import type { ImageInput } from "../images.ts";
import type { Decision, PermissionMode, Provider, ProviderEvent, SessionConfig, Usage } from "./types.ts";
import { describeAuthError } from "../claude-login.ts";

export interface ClaudeCodeOptions {
  config: SessionConfig;
  /** Folder used in chat mode (no tools, nothing to protect). */
  chatCwd: string;
  /** Continue this existing session instead of starting a new one (after a server restart). */
  resumeSessionId?: string;
  /** Resolved each time the process starts, so a reset or mode change sees the current avatar. */
  persona: (config: SessionConfig) => string;
}

interface PendingPermission {
  input: Record<string, unknown>;
  suggestions: any[];
}

/**
 * Drives one long-lived headless `claude` process over stream-json, so the
 * conversation keeps its context and uses the local Claude Code login.
 *
 * In work mode the process runs with `--permission-prompt-tool stdio`: when a
 * tool call needs approval, the CLI emits a `control_request` and waits for our
 * `control_response`, which the browser's Allow / Deny buttons produce.
 */
export class ClaudeCodeProvider implements Provider {
  readonly canUseTools = true;
  private config: SessionConfig;
  private readonly opts: ClaudeCodeOptions;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private listener: ((event: ProviderEvent) => void) | null = null;
  /** Makes the handler for a turn claude starts by itself, e.g. when a background subagent finishes. */
  private unprompted: (() => (event: ProviderEvent) => void) | null = null;
  private reportedStray = false;
  private background: BackgroundTask[] = [];
  private backgroundListener: ((tasks: BackgroundTask[]) => void) | null = null;
  private sessionIdValue: string = randomUUID();
  /** True once the session has a transcript on disk, so a restart can resume it. */
  private hasHistory = false;
  private pending = new Map<string, PendingPermission>();
  /** Set when the user stopped the reply, so the turn's "error" result is read as a normal end. */
  private interrupted = false;
  private tools = new Map<string, { name: string; summary: string }>();
  private usageValue: Usage = { turns: 0, costUsd: 0, contextTokens: null, contextWindow: null };

  constructor(opts: ClaudeCodeOptions) {
    this.opts = opts;
    this.config = opts.config;
    if (opts.resumeSessionId) {
      this.sessionIdValue = opts.resumeSessionId;
      this.hasHistory = true;
    }
  }

  get name(): string {
    return `claude-code (${this.config.model})`;
  }

  get sessionId(): string {
    return this.sessionIdValue;
  }

  get usage(): Usage {
    return this.usageValue;
  }

  get busy(): boolean {
    return this.listener !== null;
  }

  get backgroundTasks(): BackgroundTask[] {
    return this.background;
  }

  onBackground(listener: (tasks: BackgroundTask[]) => void): void {
    this.backgroundListener = listener;
  }

  private setBackground(tasks: BackgroundTask[]): void {
    if (tasks.length === 0 && this.background.length === 0) return;
    this.background = tasks;
    this.backgroundListener?.(tasks);
  }

  onUnprompted(start: () => (event: ProviderEvent) => void): void {
    this.unprompted = start;
  }

  send(text: string, onEvent: (event: ProviderEvent) => void, images: ImageInput[] = []): void {
    if (this.listener) {
      onEvent({ type: "error", message: "Still answering the previous message." });
      return;
    }
    this.listener = onEvent;
    this.interrupted = false;
    const content =
      images.length === 0
        ? text
        : [
            ...(text.trim() ? [{ type: "text", text }] : []),
            ...images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.data } })),
          ];
    try {
      this.ensureProcess().stdin.write(JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n");
    } catch (err) {
      this.finish({ type: "error", message: String(err) });
    }
  }

  respondPermission(id: string, decision: Decision, message?: string): void {
    const pending = this.pending.get(id);
    if (!pending || !this.proc) return;
    this.pending.delete(id);
    this.proc.stdin.write(permissionResponse(id, decision, pending.input, pending.suggestions, message) + "\n");
  }

  interrupt(): boolean {
    if (!this.listener || !this.proc) return false;
    this.interrupted = true;
    this.pending.clear();
    this.proc.stdin.write(JSON.stringify({ type: "control_request", request_id: `stop-${randomUUID()}`, request: { subtype: "interrupt" } }) + "\n");
    return true;
  }

  setPermissionMode(mode: PermissionMode): void {
    // Remember it for when the process is restarted, and tell a running one right away.
    this.config = { ...this.config, permissionMode: mode };
    this.proc?.stdin.write(
      JSON.stringify({
        type: "control_request",
        request_id: `mode-${randomUUID()}`,
        request: { subtype: "set_permission_mode", mode: mode === "manual" ? "default" : mode },
      }) + "\n",
    );
  }

  configure(config: SessionConfig): void {
    if (this.listener) throw new Error("Wait for the current reply to finish first.");
    const same = JSON.stringify(config) === JSON.stringify(this.config);
    this.config = config;
    if (!same) this.killProcess(); // the next message restarts it and resumes the conversation
  }

  reset(): void {
    this.killProcess();
    if (this.listener) this.finish({ type: "error", message: "Conversation reset." });
    this.sessionIdValue = randomUUID();
    this.hasHistory = false;
    this.usageValue = { turns: 0, costUsd: 0, contextTokens: null, contextWindow: null };
  }

  resume(sessionId: string): void {
    if (this.listener) throw new Error("Wait for the current reply to finish first.");
    this.killProcess();
    this.sessionIdValue = sessionId;
    this.hasHistory = true; // the next message starts claude with --resume
    this.usageValue = { turns: 0, costUsd: 0, contextTokens: null, contextWindow: null };
  }

  close(): void {
    this.killProcess();
    if (this.listener) this.finish({ type: "error", message: "Conversation reset." });
  }

  private killProcess(): void {
    const proc = this.proc;
    this.proc = null;
    this.dropPending();
    this.setBackground([]); // killing the process ends its subagents
    proc?.kill();
  }

  private dropPending(): void {
    for (const id of this.pending.keys()) this.listener?.({ type: "permission-cancelled", id });
    this.pending.clear();
  }

  private finish(event: ProviderEvent): void {
    const listener = this.listener;
    this.listener = null;
    this.tools.clear();
    listener?.(event);
  }

  /**
   * She is a companion, not a coding agent with a memory directory: switch off
   * auto memory (it would try to write files, or emit unparseable tool calls in chat
   * mode) and a few default prompt sections she does not use, which also keeps turns
   * smaller. In work mode the project's own CLAUDE.md and git guidance stay on.
   */
  private trimmedEnv(): Record<string, string> {
    const env: Record<string, string> = {
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
      CLAUDE_CODE_DISABLE_CRON: "1",
      CLAUDE_CODE_DISABLE_CFC_PROMPT: "1",
      CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS: "1",
      // Claude Code compacts on its own when the context is nearly full, also in this headless mode;
      // pin the point to 95% of the window (like the terminal) unless the user's environment says otherwise.
      CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE ?? "95",
    };
    if (this.config.mode === "chat") {
      env.CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS = "1";
      env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = "1";
    }
    return env;
  }

  private args(): string[] {
    const { mode, model, allowedTools, permissionMode, effort, claudeSetup, claudeSkills } = this.config;
    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--model", model,
      // Claude Code records the system prompt with the conversation and sends that same text again on every
      // resume, so a changed look or name does not break the prompt cache. The app tells her about such
      // changes in the next message instead (see notesForModel in server.ts).
      "--append-system-prompt", this.opts.persona(this.config),
      // Compact at a fixed size instead of near the model's whole 1M window: see cache-guard.ts.
      "--autocompact", parseAutocompact(process.env.COMPANION_AUTOCOMPACT),
      this.hasHistory ? "--resume" : "--session-id", this.sessionIdValue,
    ];
    if (effort) args.push("--effort", effort);
    // By default skip claude.ai connectors and user/project settings: smaller turns, and a
    // folder's own hooks or allow rules never run in someone else's session. Work mode can
    // opt in to the user's own setup (settings, hooks, MCP servers).
    if (!(mode === "work" && claudeSetup)) {
      // Her own skills are the one thing worth loading from the user's settings: skills need that source,
      // and the user's hooks are switched off again, so nothing runs a command behind the approval cards.
      const skills = mode === "work" && claudeSkills;
      args.push("--strict-mcp-config", "--setting-sources", skills ? "user" : "");
      if (skills) args.push("--settings", JSON.stringify({ disableAllHooks: true }));
    }
    if (mode === "chat") {
      args.push("--tools", "");
    } else {
      args.push(
        "--tools", "default",
        // Claude asks in plain chat instead; the questionnaire UI is not built.
        "--disallowedTools", "AskUserQuestion",
        "--permission-prompt-tool", "stdio",
      );
      if (allowedTools.length > 0) args.push("--allowedTools", allowedTools.join(","));
      if (permissionMode !== "manual") args.push("--permission-mode", permissionMode);
    }
    return args;
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc;
    const cwd = this.config.mode === "work" ? this.config.cwd : this.opts.chatCwd;
    const proc = spawnCli("claude", this.args(), { cwd, env: { ...process.env, ...this.trimmedEnv() } });
    this.proc = proc;

    createInterface({ input: proc.stdout }).on("line", (line) => {
      for (const item of parseStreamLine(line)) this.handle(item);
    });
    proc.stderr.on("data", (chunk) => process.stderr.write(`[claude] ${chunk}`));
    proc.on("error", (err) => {
      if (this.proc === proc) this.proc = null;
      this.dropPending();
      this.finish({ type: "error", message: `Could not start claude: ${err.message}` });
    });
    proc.on("exit", (code) => {
      if (this.proc !== proc) return; // we killed it on purpose
      this.proc = null;
      this.dropPending();
      this.setBackground([]);
      if (this.listener) this.finish({ type: "error", message: `claude exited (code ${code}).` });
    });
    return proc;
  }

  private handle(item: StreamItem): void {
    // With no reply in progress, claude can still talk: a finished background subagent or task makes it
    // start a turn on its own. Give that turn a listener, or everything it says would be lost.
    if (!this.listener && (item.kind === "delta" || item.kind === "tool-start" || item.kind === "permission")) {
      if (this.unprompted) {
        this.listener = this.unprompted();
        this.interrupted = false;
      } else if (!this.reportedStray) {
        this.reportedStray = true;
        process.stderr.write(`[claude] dropped output from a turn nobody asked for (${item.kind})\n`);
      }
    }
    if (item.kind === "result") this.reportedStray = false;
    switch (item.kind) {
      case "delta":
        this.listener?.({ type: "delta", text: item.text });
        break;
      case "tool-start": {
        const summary = summarizeTool(item.name, item.input);
        this.tools.set(item.id, { name: item.name, summary });
        this.listener?.({ type: "tool", id: item.id, name: item.name, summary, status: "running" });
        break;
      }
      case "tool-result": {
        const tool = this.tools.get(item.id);
        if (tool) {
          this.listener?.({
            type: "tool", id: item.id, name: tool.name, summary: tool.summary,
            status: item.isError ? "error" : "done",
          });
        }
        break;
      }
      case "permission":
        this.pending.set(item.requestId, { input: item.input, suggestions: item.suggestions });
        this.listener?.({
          type: "permission",
          request: {
            id: item.requestId,
            tool: item.tool,
            summary: summarizeTool(item.tool, item.input),
            input: item.input,
            description: item.description,
          },
        });
        break;
      case "permission-cancel":
        if (this.pending.delete(item.requestId)) this.listener?.({ type: "permission-cancelled", id: item.requestId });
        break;
      case "status":
        this.listener?.({ type: "status", text: item.text });
        break;
      case "background":
        this.setBackground(item.tasks);
        break;
      case "compacted":
        this.listener?.({
          type: "notice",
          text:
            (item.auto ? "The conversation was compacted automatically" : "Conversation compacted") +
            (item.before && item.after ? ` (about ${Math.round(item.before / 1000)}k → ${Math.round(item.after / 1000)}k tokens)` : "") +
            ": she keeps a summary, the log above stays as it is.",
        });
        break;
      case "result":
        this.hasHistory = true;
        this.usageValue = {
          turns: this.usageValue.turns + 1,
          // The CLI's total covers the whole conversation: it restores it when a session is resumed.
          costUsd: item.costUsd ?? this.usageValue.costUsd,
          contextTokens: item.contextTokens ?? this.usageValue.contextTokens,
          contextWindow: item.contextWindow ?? this.usageValue.contextWindow,
        };
        this.pending.clear();
        if (this.interrupted) {
          this.interrupted = false;
          this.finish({ type: "done" }); // she was stopped; what she said so far stays
        } else this.finish(item.isError ? { type: "error", message: describeAuthError(item.text || "Unknown error from claude.") } : { type: "done" });
        break;
      case "limits":
        this.listener?.({ type: "limits", session: item.session, week: item.week });
        break;
      case "init":
        if (item.model) this.listener?.({ type: "model", name: item.model });
        break;
    }
  }
}

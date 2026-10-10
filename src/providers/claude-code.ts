import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { Provider, ProviderEvent } from "./types.ts";

export interface ClaudeCodeOptions {
  model: string;
  /** Resolved each time the process starts, so a reset sees the current avatar. */
  persona: string | (() => string);
  cwd: string;
  /** Built-in tools to enable. "" = chat only, "default" = everything. */
  tools: string;
}

/**
 * Drives one long-lived headless `claude` process over stream-json, so the
 * conversation keeps its context and uses the local Claude Code login.
 */
export class ClaudeCodeProvider implements Provider {
  readonly name: string;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private listener: ((event: ProviderEvent) => void) | null = null;
  private sessionId = randomUUID();
  private started = false;

  private readonly opts: ClaudeCodeOptions;

  constructor(opts: ClaudeCodeOptions) {
    this.opts = opts;
    this.name = `claude-code (${opts.model})`;
  }

  send(text: string, onEvent: (event: ProviderEvent) => void): void {
    if (this.listener) {
      onEvent({ type: "error", message: "Still answering the previous message." });
      return;
    }
    this.listener = onEvent;
    try {
      const proc = this.ensureProcess();
      proc.stdin.write(
        JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n",
      );
    } catch (err) {
      this.finish({ type: "error", message: String(err) });
    }
  }

  reset(): void {
    this.close();
    this.sessionId = randomUUID();
    this.started = false;
  }

  close(): void {
    const proc = this.proc;
    this.proc = null;
    proc?.kill();
    if (this.listener) this.finish({ type: "error", message: "Conversation reset." });
  }

  private finish(event: ProviderEvent): void {
    const listener = this.listener;
    this.listener = null;
    listener?.(event);
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc;

    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--model", this.opts.model,
      "--append-system-prompt",
      typeof this.opts.persona === "function" ? this.opts.persona() : this.opts.persona,
      "--tools", this.opts.tools,
      // Skip claude.ai connectors and user/project settings: keeps each turn small.
      "--strict-mcp-config",
      "--setting-sources", "",
      // First start creates the session; restarts after a crash resume it.
      ...(this.started ? ["--resume", this.sessionId] : ["--session-id", this.sessionId]),
    ];
    const proc = spawn("claude", args, { cwd: this.opts.cwd });
    this.proc = proc;
    this.started = true;

    createInterface({ input: proc.stdout }).on("line", (line) => this.handleLine(line));
    proc.stderr.on("data", (chunk) => process.stderr.write(`[claude] ${chunk}`));
    proc.on("error", (err) => {
      if (this.proc === proc) this.proc = null;
      this.finish({ type: "error", message: `Could not start claude: ${err.message}` });
    });
    proc.on("exit", (code) => {
      if (this.proc === proc) this.proc = null;
      if (this.listener) this.finish({ type: "error", message: `claude exited (code ${code}).` });
    });
    return proc;
  }

  private handleLine(line: string): void {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.type === "stream_event") {
      const delta = msg.event?.delta;
      if (msg.event?.type === "content_block_delta" && delta?.type === "text_delta") {
        this.listener?.({ type: "delta", text: delta.text });
      }
    } else if (msg.type === "result") {
      if (msg.is_error) {
        this.finish({ type: "error", message: String(msg.result ?? "Unknown error from claude.") });
      } else {
        this.finish({ type: "done" });
      }
    }
  }
}

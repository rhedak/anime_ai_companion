import type { Effort } from "../claude-settings.ts";
import type { ImageInput } from "../images.ts";
import type { Limit } from "./claude-stream.ts";

export interface PermissionRequest {
  id: string;
  tool: string;
  /** One line for the dialog title, e.g. the Bash command or the file path. */
  summary: string;
  /** The tool's exact input, shown in full so the user approves what will really run. */
  input: Record<string, unknown>;
  /** The model's own description of what the call does (untrusted text). */
  description?: string;
}

export type Decision = "allow" | "allow-session" | "deny";

export type ProviderEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; id: string; name: string; summary: string; status: "running" | "done" | "error" }
  | { type: "permission"; request: PermissionRequest }
  | { type: "permission-cancelled"; id: string }
  /** What she is doing while no text arrives (e.g. compacting); null clears it. */
  | { type: "status"; text: string | null }
  | { type: "notice"; text: string }
  | { type: "limits"; session: Limit | null; week: Limit | null }
  | { type: "model"; name: string }
  | { type: "done" }
  | { type: "error"; message: string };

export type Mode = "chat" | "work";

export interface Usage {
  /** Replies since the server started. */
  turns: number;
  /** Estimated API-equivalent cost of the whole conversation; a subscription is not billed per token. */
  costUsd: number;
  /** Tokens sent with the last request, i.e. roughly how full the context window is. */
  contextTokens: number | null;
  /** Size of the model's context window, so the above can be shown as a percentage. */
  contextWindow: number | null;
}

/**
 * How work mode treats tool calls: "manual" asks for everything not pre-approved, "plan" lets her
 * read and propose a plan only, "acceptEdits" also lets her edit files without asking, and
 * "auto" lets Claude Code's own safety classifier approve routine actions. "everything" is
 * Cursor's Run Everything (every tool runs unless a deny rule blocks it) and is refused for
 * the other brains.
 */
export type PermissionMode = "manual" | "plan" | "acceptEdits" | "auto" | "everything";
export const permissionModes: readonly PermissionMode[] = ["manual", "plan", "acceptEdits", "auto", "everything"];

export interface SessionConfig {
  mode: Mode;
  /** Folder the session works in. Only meaningful in work mode. */
  cwd: string;
  model: string;
  /** Tools pre-approved without asking (work mode). */
  allowedTools: string[];
  /** How approvals work in work mode. */
  permissionMode: PermissionMode;
  /**
   * Work mode only: load the user's own Claude Code setup (user and project settings, hooks,
   * MCP servers) instead of running isolated. Off by default, because hooks run commands.
   */
  claudeSetup: boolean;
  /** How hard Claude thinks (`--effort`); null leaves it to Claude Code's default. */
  effort: Effort | null;
}

/**
 * A chat backend for the companion. Claude Code (headless) is the first
 * implementation; Ollama or others can be added by implementing this.
 */
export interface Provider {
  readonly name: string;
  /** Whether this backend can use tools (and therefore ask for permission). */
  readonly canUseTools: boolean;
  /** Id of the underlying conversation, if the backend has one (for `claude --resume`). */
  readonly sessionId: string | null;
  /** What this conversation has used so far, if the backend can tell. */
  readonly usage?: Usage;
  /** True while a reply is in progress. */
  readonly busy: boolean;
  /** Send a user message (with any attached images); events stream back through `onEvent` until "done" or "error". */
  send(text: string, onEvent: (event: ProviderEvent) => void, images?: ImageInput[]): void;
  /** Answer a "permission" event. */
  respondPermission(id: string, decision: Decision, message?: string): void;
  /** Change mode, folder, model or pre-approved tools. The conversation continues. */
  configure(config: SessionConfig): void;
  /** Forget the conversation and start fresh. */
  reset(): void;
  /** Stop the reply in progress (what she has said so far is kept). False if nothing was running. */
  interrupt(): boolean;
  /** Change how tool approvals work right now, even in the middle of a reply (only backends with tools). */
  setPermissionMode?(mode: PermissionMode): void;
  /** Continue an earlier conversation by its id (only backends with their own sessions). */
  resume?(sessionId: string): void;
  /** Earlier conversations in a folder, newest first (backends that keep their own sessions). */
  listSessions?(cwd: string): Promise<{ id: string; title: string; modified: Date }[]>;
  close(): void;
}

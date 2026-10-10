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
  | { type: "done" }
  | { type: "error"; message: string };

export type Mode = "chat" | "work";

export interface SessionConfig {
  mode: Mode;
  /** Folder the session works in. Only meaningful in work mode. */
  cwd: string;
  model: string;
  /** Tools pre-approved without asking (work mode). */
  allowedTools: string[];
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
  /** True while a reply is in progress. */
  readonly busy: boolean;
  /** Send a user message; events stream back through `onEvent` until "done" or "error". */
  send(text: string, onEvent: (event: ProviderEvent) => void): void;
  /** Answer a "permission" event. */
  respondPermission(id: string, decision: Decision, message?: string): void;
  /** Change mode, folder, model or pre-approved tools. The conversation continues. */
  configure(config: SessionConfig): void;
  /** Forget the conversation and start fresh. */
  reset(): void;
  close(): void;
}

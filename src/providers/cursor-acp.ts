import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ImageInput } from "../images.ts";
import { summarizeTool } from "./claude-stream.ts";
import type { Decision, Mode, PermissionMode, PermissionRequest, ProviderEvent } from "./types.ts";

/** A model the running agent offered, id is what `session/set_config_option` accepts. */
export interface CursorModel {
  id: string;
  name: string;
}

export interface AcpPermission {
  /** Id the browser uses; the JSON-RPC id is kept beside it by the provider. */
  id: string;
  rpcId: number | string;
  kind: "tool" | "plan";
  request: PermissionRequest;
  options: { optionId: string; kind: string }[];
}

export interface AcpReply {
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

/** What one line from `cursor-agent acp` means for the companion. */
export interface AcpEffect {
  events: ProviderEvent[];
  replies: AcpReply[];
  permission?: AcpPermission;
}

/**
 * Args for `cursor-agent`. Run Everything is `--force`, and only in work mode.
 * Auto-review is a CLI flag the ACP server does not read, so it is not passed:
 * Ask is the default, and a card still appears for anything Cursor holds back.
 */
export function cursorArgs(mode: Mode, permissionMode: PermissionMode): string[] {
  return mode === "work" && permissionMode === "everything" ? ["--force", "acp"] : ["acp"];
}

/** ACP mode: chat is read-only Ask, Plan is plan, everything else is the full agent. */
export function cursorSessionMode(mode: Mode, permissionMode: PermissionMode): "ask" | "plan" | "agent" {
  if (mode === "chat") return "ask";
  if (permissionMode === "plan") return "plan";
  return "agent";
}

/**
 * An empty wish picks Composer, or else the first model. A wish that is neither
 * an id nor a display name returns null, so a typo is refused instead of silently
 * switching model.
 */
export function pickCursorModel(models: CursorModel[], wanted: string | null): string | null {
  const wish = wanted?.trim();
  if (!wish) return models.find((m) => m.id.startsWith("composer-2.5"))?.id ?? models[0]?.id ?? null;
  return models.find((m) => m.id === wish)?.id ?? models.find((m) => m.name.toLowerCase() === wish.toLowerCase())?.id ?? null;
}

export function displayModel(models: CursorModel[], id: string): string {
  return models.find((m) => m.id === id)?.name ?? id.replace(/\[.*\]$/, "");
}

/** Persona plus the user's text, then any pictures. ACP has no system-prompt field. */
export function promptBlocks(persona: string, text: string, images: ImageInput[] = []): unknown[] {
  const body = text.trim();
  const message = body || (images.length ? "The user sent a picture." : "");
  return [
    {
      type: "text",
      text: `${persona.trim()}\n\nThe user's message follows. Follow the companion instructions above in your reply, and do not quote them.\n\n${message}`,
    },
    ...images.map((image) => ({ type: "image", data: image.data, mimeType: image.mediaType })),
  ];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // a bare command string
    }
    return value ? { command: value } : {};
  }
  return {};
}

function norm(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z]/g, "") : "";
}

/** Reads the user already pre-approved. Anything with a command is never one of them. */
function isPreapproved(toolCall: Record<string, unknown>, allowedTools: string[]): boolean {
  const input = asRecord(toolCall.rawInput);
  if (typeof input.command === "string") return false;
  const allowed = new Set(allowedTools.map((name) => norm(name)));
  const name = norm(toolCall.name);
  const kind = norm(toolCall.kind);
  return (name !== "" && allowed.has(name)) || (kind !== "" && allowed.has(kind));
}

function toolStatus(status: unknown): "running" | "done" | "error" | null {
  const value = typeof status === "string" ? status.toLowerCase() : "";
  if (value === "completed" || value === "done") return "done";
  if (value === "failed" || value === "error") return "error";
  if (value === "in_progress" || value === "running" || value === "pending") return "running";
  return null;
}

function toolEvent(toolCall: Record<string, unknown>, status: "running" | "done" | "error"): ProviderEvent {
  const name = typeof toolCall.name === "string" ? toolCall.name : typeof toolCall.kind === "string" ? toolCall.kind : "tool";
  const input = asRecord(toolCall.rawInput);
  const id = String(toolCall.toolCallId ?? toolCall.id ?? name);
  return { type: "tool", id, name, summary: summarizeTool(name, input), status };
}

function textOf(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const block = content as { type?: string; text?: string };
  return block.type === "text" && typeof block.text === "string" ? block.text : "";
}

function permissionOptions(raw: unknown): { optionId: string; kind: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const option = item as { optionId?: unknown; kind?: unknown };
    return typeof option.optionId === "string" ? [{ optionId: option.optionId, kind: typeof option.kind === "string" ? option.kind : "" }] : [];
  });
}

/** The option id Cursor listed, chosen by the card's decision. */
export function permissionResult(decision: Decision, options: { optionId: string; kind: string }[]): { outcome: { outcome: "selected"; optionId: string } } {
  const want = decision === "deny" ? "reject" : decision === "allow-session" ? "always" : "once";
  const match =
    options.find((option) => option.optionId.includes(want) || option.kind.includes(want)) ??
    options.find((option) => (decision === "deny" ? option.kind.includes("reject") : option.kind.includes("allow")));
  const optionId = match?.optionId ?? (decision === "deny" ? "reject-once" : decision === "allow-session" ? "allow-always" : "allow-once");
  return { outcome: { outcome: "selected", optionId } };
}

export function planResult(decision: Decision): { outcome: { outcome: string; reason?: string } } {
  return decision === "deny"
    ? { outcome: { outcome: "rejected", reason: "The user declined this plan." } }
    : { outcome: { outcome: "accepted" } };
}

/**
 * Translate one JSON-RPC message from the agent. Responses to our own requests
 * are not handled here; the provider matches those by id.
 */
export function interpretAcp(msg: { id?: unknown; method?: unknown; params?: unknown }, allowedTools: string[]): AcpEffect {
  const effect: AcpEffect = { events: [], replies: [] };
  if (typeof msg.method !== "string") return effect;
  const params = (msg.params ?? {}) as Record<string, unknown>;
  const rpcId = typeof msg.id === "number" || typeof msg.id === "string" ? msg.id : null;

  if (msg.method === "session/update") {
    const update = (params.update ?? {}) as Record<string, unknown>;
    const kind = update.sessionUpdate;
    if (kind === "agent_message_chunk") {
      const text = textOf(update.content);
      if (text) effect.events.push({ type: "delta", text });
    } else if (kind === "tool_call" || kind === "tool_call_update") {
      const status = toolStatus(update.status);
      if (status) effect.events.push(toolEvent(update, status));
    }
    return effect;
  }

  if (msg.method === "session/request_permission" && rpcId !== null) {
    const toolCall = asRecord(params.toolCall);
    const options = permissionOptions(params.options);
    if (isPreapproved(toolCall, allowedTools)) {
      effect.replies.push({ id: rpcId, result: permissionResult("allow", options) });
      return effect;
    }
    const name = typeof toolCall.name === "string" ? toolCall.name : typeof toolCall.kind === "string" ? toolCall.kind : "tool";
    const input = asRecord(toolCall.rawInput);
    const summary = summarizeTool(name, input);
    const title = typeof toolCall.title === "string" ? toolCall.title : "";
    effect.permission = {
      id: `perm-${rpcId}`,
      rpcId,
      kind: "tool",
      options,
      request: {
        id: `perm-${rpcId}`,
        tool: name,
        summary: summary || title,
        input,
        ...(title && title !== summary ? { description: title } : {}),
      },
    };
    return effect;
  }

  if (msg.method === "cursor/create_plan" && rpcId !== null) {
    const name = typeof params.name === "string" ? params.name : "Plan";
    const plan = typeof params.plan === "string" ? params.plan : "";
    const overview = typeof params.overview === "string" ? params.overview : "";
    effect.permission = {
      id: `perm-${rpcId}`,
      rpcId,
      kind: "plan",
      options: [],
      request: {
        id: `perm-${rpcId}`,
        tool: "Plan",
        summary: name,
        input: { plan: plan || overview },
        ...(overview && overview !== plan ? { description: overview } : {}),
      },
    };
    return effect;
  }

  if (msg.method === "cursor/ask_question" && rpcId !== null) {
    // She asks in the chat, the way Claude's questionnaire tool is turned off.
    effect.replies.push({ id: rpcId, result: { outcome: { outcome: "skipped", reason: "Ask in the chat instead." } } });
    return effect;
  }

  if (rpcId !== null) {
    effect.replies.push({ id: rpcId, error: { code: -32601, message: `Not handled: ${msg.method}` } });
  }
  return effect;
}

export function parseModels(result: unknown): { models: CursorModel[]; currentModelId: string } {
  const body = (result ?? {}) as { models?: { currentModelId?: unknown; availableModels?: unknown } };
  const available = Array.isArray(body.models?.availableModels) ? body.models.availableModels : [];
  const models = available.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const model = item as { modelId?: unknown; name?: unknown };
    return typeof model.modelId === "string" ? [{ id: model.modelId, name: typeof model.name === "string" ? model.name : model.modelId }] : [];
  });
  const currentModelId = typeof body.models?.currentModelId === "string" ? body.models.currentModelId : "";
  return { models, currentModelId };
}

/**
 * The Cursor CLI's own approval setting: `approvalMode` in `~/.cursor/cli-config.json`. With "unrestricted" it runs commands and edits files without ever sending
 * `session/request_permission`, whatever the client asks for (measured with cursor-agent 2026.10.14: a work-mode edit in Ask mode produced no approval card), so the
 * app's Ask could not ask. Read only; the app never changes Cursor's settings. Null when there is no file or no such setting.
 */
export function cursorApprovalMode(configPath: string = join(homedir(), ".cursor", "cli-config.json")): string | null {
  try {
    const mode = (JSON.parse(readFileSync(configPath, "utf8")) as { approvalMode?: unknown }).approvalMode;
    return typeof mode === "string" ? mode : null;
  } catch {
    return null;
  }
}

/** Said (and the message not sent) when work mode in Ask would be run by a Cursor that never asks. */
export const CURSOR_UNRESTRICTED_TEXT =
  'Your Cursor CLI is set to run everything without asking ("approvalMode": "unrestricted" in ~/.cursor/cli-config.json), so the approval cards here could never appear and Ask would not ask. Nothing was sent. ' +
  "Change that setting in Cursor (or delete the line, which brings the default back) so that it asks again, or choose Everything in the permission menu if you do want it to run without asking, or use another brain for work mode.";

/** Said when the app starts in Run everything because Cursor's own CLI never asks. The choice is still memory only. */
export const CURSOR_EVERYTHING_NOTICE =
  'Run everything, because your Cursor CLI is set to run without asking ("approvalMode": "unrestricted" in ~/.cursor/cli-config.json). This resets to Ask the next time the server starts.';

/**
 * What the page shows when cursor-agent dies. It says why in its own output (stderr), which used to go only to the server log, so
 * the chat showed a bare "exited (1)". The causes a user can fix themselves get the step to take; anything else is shown as it was said.
 *
 * `env` is the server's environment. cursor-agent (seen in 2026.10.22, `terminal-theme.ts`) treats an inherited SSH or mosh
 * session as a reason to probe the keychain with a write, and prints "keychain is locked" when that write is refused. A companion
 * started from SSH keeps those variables, and `/restart` keeps the same process session, so macOS answers "User interaction is not
 * allowed" while Keychain Access still shows the login keychain unlocked.
 */
export function cursorErrorText(message: string, env: NodeJS.ProcessEnv = {}): string {
  if (/keychain is locked/i.test(message)) {
    if (cursorLikelySsh(env)) {
      return "Cursor cannot read its login from this server. The server was started from an SSH session, so macOS blocks keychain access and Cursor calls that a locked keychain. Keychain Access can show the login keychain unlocked at the same time. Restarting from the page keeps that session. Stop the companion and start it again from Terminal on this Mac (`anaico --restart`), or quit and reopen the desktop app. Your Cursor login is fine.";
    }
    return "Cursor cannot read its login because your macOS login keychain is locked. Run `security unlock-keychain` in a terminal and enter your Mac password (or unlock it in Keychain Access), then send your message again. Nothing is wrong with the app or with your Cursor login.";
  }
  return message;
}

/** True when cursor-agent will take its SSH keychain path. Same signals as its own session check, including an explicit override. */
export function cursorLikelySsh(env: NodeJS.ProcessEnv): boolean {
  for (const key of CURSOR_ASSUME_SSH) {
    const forced = assumeSsh(env[key]);
    if (forced !== undefined) return forced;
  }
  if (CURSOR_SSH_PRESENT.some((key) => present(env[key]))) return true;
  if (typeof env.VSCODE_IPC_HOOK_CLI === "string" && /ssh/i.test(env.VSCODE_IPC_HOOK_CLI)) return true;
  return typeof env.TERM === "string" && /mosh/i.test(env.TERM);
}

const CURSOR_ASSUME_SSH = [
  "CURSOR_AGENT_CLI_ASSUME_SSH",
  "CURSOR_AGENT_ASSUME_SSH",
  "CURSOR_CLI_ASSUME_SSH",
  "CURSOR_ASSUME_SSH",
  "CURSOR_AGENT_CLI_FORCE_SSH",
  "CURSOR_AGENT_FORCE_SSH",
  "CURSOR_CLI_FORCE_SSH",
  "CURSOR_FORCE_SSH",
];

const CURSOR_SSH_PRESENT = [
  "SSH_CONNECTION",
  "SSH_CLIENT",
  "SSH_TTY",
  "SSH2_CLIENT",
  "SSH2_TTY",
  "MOSH_CLIENT",
  "MOSH_SERVER",
  "MOSH_TTY",
  "MOSH_IP",
  "MOSH_PORT",
  "MOSH_PRESERVE_PROMPT",
  "VSCODE_SSH_HOST",
  "VSCODE_SSH_SERVER",
];

function present(value: string | undefined): boolean {
  return value != null && value !== "";
}

/** cursor-agent: an explicit 0/1 (and the usual words) overrides the session variables; anything else is ignored. */
function assumeSsh(value: string | undefined): boolean | undefined {
  if (value == null) return undefined;
  const text = value.trim().toLowerCase();
  if (text === "1" || text === "true" || text === "yes" || text === "y" || text === "on") return true;
  if (text === "0" || text === "false" || text === "no" || text === "n" || text === "off") return false;
  return undefined;
}

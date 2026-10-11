import type { ImageInput } from "../images.ts";
import { summarizeTool } from "./claude-stream.ts";
import { permissionResult } from "./cursor-acp.ts";
import type { Mode, PermissionMode, PermissionRequest, ProviderEvent } from "./types.ts";

/** A model opencode offers, as `provider/model` (optionally with a `/variant` suffix). */
export interface OpenCodeModel {
  id: string;
  name: string;
}

export interface AcpPermission {
  /** Id the browser uses; the JSON-RPC id is kept beside it by the provider. */
  id: string;
  rpcId: number | string;
  request: PermissionRequest;
  options: { optionId: string; kind: string }[];
}

export interface AcpReply {
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

/** What one line from `opencode acp` means for the companion. */
export interface AcpEffect {
  events: ProviderEvent[];
  replies: AcpReply[];
  permission?: AcpPermission;
}

/**
 * `opencode acp` has no `--force` equivalent we are allowed to pass: the app's safety rules
 * forbid a skip-permissions flag, so approvals are always handled through the permission config
 * below. Run Everything stays a Cursor-only mode. `--pure` keeps external plugins out of the run.
 */
export function opencodeArgs(): string[] {
  return ["acp", "--pure"];
}

/**
 * The config handed to opencode on every start, through OPENCODE_CONFIG_CONTENT (highest
 * priority). Two jobs: force Ask everywhere (opencode's own defaults let most tools run
 * unwatched), and pre-approve the cheap read-only tools the user already trusts. In chat mode
 * every tool is denied, so she cannot touch the disk at all.
 *
 * This uses the v1 config shape (`permission` object). opencode v2 renamed it to `permissions`
 * with an ordered rule array; if the installed opencode is v2 this block is ignored and its
 * permissive defaults apply, which is why the provider is not the default brain.
 */
export function opencodeConfig(mode: Mode, allowedTools: string[]): string {
  if (mode === "chat") return JSON.stringify({ autoupdate: false, permission: { "*": "deny" } });
  const permission: Record<string, unknown> = { "*": "ask" };
  const trusted = new Set(allowedTools.map((name) => name.toLowerCase()));
  for (const tool of ["read", "glob", "grep", "list"]) {
    if (trusted.has(tool)) permission[tool] = "allow";
  }
  return JSON.stringify({ autoupdate: false, permission });
}

/** Chat uses the read-only Plan agent; work uses Build unless the user asked to plan first. */
export function opencodeSessionMode(mode: Mode, permissionMode: PermissionMode): string {
  return mode === "work" && permissionMode !== "plan" ? "build" : "plan";
}

/**
 * An empty wish keeps opencode's own configured default. A wish may be the full id
 * (`provider/model`), the display name, or the bare model id; a typo returns null so it is
 * refused instead of silently switching model.
 */
export function pickOpenCodeModel(models: OpenCodeModel[], wanted: string | null): string | null {
  const wish = wanted?.trim();
  if (!wish) return null;
  return (
    models.find((m) => m.id === wish)?.id ??
    models.find((m) => m.name.toLowerCase() === wish.toLowerCase())?.id ??
    models.find((m) => m.id.split("/").pop() === wish)?.id ??
    null
  );
}

export function displayModel(models: OpenCodeModel[], id: string): string {
  return models.find((m) => m.id === id)?.name ?? id;
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

/**
 * Translate one JSON-RPC message from `opencode acp`. Responses to our own requests are not
 * handled here; the provider matches those by id. opencode speaks standard ACP: streamed text
 * and tool calls arrive as `session/update`, approvals as `session/request_permission`.
 */
export function interpretAcp(msg: { id?: unknown; method?: unknown; params?: unknown }): AcpEffect {
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
    const name = typeof toolCall.name === "string" ? toolCall.name : typeof toolCall.kind === "string" ? toolCall.kind : "tool";
    const input = asRecord(toolCall.rawInput);
    const summary = summarizeTool(name, input);
    const title = typeof toolCall.title === "string" ? toolCall.title : "";
    effect.permission = {
      id: `perm-${rpcId}`,
      rpcId,
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

  if (rpcId !== null) {
    effect.replies.push({ id: rpcId, error: { code: -32601, message: `Not handled: ${msg.method}` } });
  }
  return effect;
}

/** The result of `session/new` or `session/load`: the models on offer and the one in use. */
export function parseModels(result: unknown): { models: OpenCodeModel[]; currentModelId: string } {
  const body = (result ?? {}) as {
    models?: { currentModelId?: unknown; availableModels?: unknown };
    configOptions?: unknown;
  };
  const options = Array.isArray(body.configOptions) ? body.configOptions : [];
  const modelOption = options.find((option) => {
    if (!option || typeof option !== "object") return false;
    const o = option as { id?: unknown; category?: unknown };
    return o.id === "model" || o.category === "model";
  }) as { currentValue?: unknown; options?: unknown } | undefined;
  if (modelOption) {
    const raw = Array.isArray(modelOption.options) ? modelOption.options : [];
    const models = raw.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const option = item as { value?: unknown; name?: unknown };
      return typeof option.value === "string" ? [{ id: option.value, name: typeof option.name === "string" ? option.name : option.value }] : [];
    });
    const currentModelId = typeof modelOption.currentValue === "string" ? modelOption.currentValue : "";
    if (models.length || currentModelId) return { models, currentModelId };
  }

  const available = Array.isArray(body.models?.availableModels) ? body.models.availableModels : [];
  const models = available.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const model = item as { modelId?: unknown; name?: unknown };
    return typeof model.modelId === "string" ? [{ id: model.modelId, name: typeof model.name === "string" ? model.name : model.modelId }] : [];
  });
  const currentModelId = typeof body.models?.currentModelId === "string" ? body.models.currentModelId : "";
  return { models, currentModelId };
}

export { permissionResult };

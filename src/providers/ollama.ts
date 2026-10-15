import { randomUUID } from "node:crypto";
import type { ImageInput } from "../images.ts";
import { cut, describeCall, runTool, toArgs, toolByName, toolDefinitions } from "./ollama-tools.ts";
import type { Decision, PermissionMode, Provider, ProviderEvent, SessionConfig } from "./types.ts";

export interface OllamaOptions {
  /** Base URL of the Ollama server, e.g. http://127.0.0.1:11434 */
  host: string;
  model: string;
  /** Resolved for every request, so the current avatar description is always included. */
  persona: () => string;
  /** Models to treat as tool-capable without asking Ollama (an old Ollama cannot say), or "all". */
  forceTools?: string[];
}

interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls?: unknown[];
  tool_name?: string;
}

/** Keeps requests small for local models: at most this many past messages are sent. */
const MAX_HISTORY = 40;
/** A model that keeps calling tools is stopped after this many rounds of them in one reply. */
export const MAX_TOOL_ROUNDS = 12;
/** Ollama's default context window is small and tool results fill it fast. */
const toolContext = () => Number(process.env.COMPANION_OLLAMA_CTX) || 16384;

/** Families that are known to take tool calls, for an Ollama too old to report a model's capabilities. */
const TOOL_FAMILIES = /^(qwen2\.5|qwen3|llama3\.[123]|llama4|mistral-nemo|mistral-small|mistral-large|command-r|granite3|hermes3|firefunction|devstral|gpt-oss|functiongemma|smollm3|phi4-mini)/i;

/**
 * Whether a model takes tool calls: Ollama's own report (`capabilities` of /api/show), else a known family, else null (cannot tell).
 * `forced` names models the user vouches for.
 */
export async function ollamaSupportsTools(host: string, model: string, forced: string[] = []): Promise<boolean | null> {
  if (forced.includes("all") || forced.includes(model)) return true;
  const capabilities = await ollamaCapabilities(host, model);
  if (capabilities === undefined) return null;
  if (capabilities) return capabilities.includes("tools");
  return TOOL_FAMILIES.test(model) ? true : null;
}

/** Whether a model can take pictures: Ollama's own report, else null (cannot tell, and she does not guess). */
export async function ollamaSupportsVision(host: string, model: string): Promise<boolean | null> {
  const capabilities = await ollamaCapabilities(host, model);
  return capabilities ? capabilities.includes("vision") : null;
}

/** What Ollama says a model can do (`capabilities` of /api/show): the list, null for an Ollama that does not say, undefined when it cannot be asked. */
async function ollamaCapabilities(host: string, model: string): Promise<string[] | null | undefined> {
  try {
    const res = await fetch(`${host.replace(/\/+$/, "")}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return undefined;
    const body: any = await res.json();
    return Array.isArray(body.capabilities) ? body.capabilities.map(String) : null;
  } catch {
    return undefined;
  }
}

function toolNote(readOnly: boolean): string {
  return (
    "\n\nTools (work mode, experimental): you can call the functions read_file, grep, bash, write_file and edit_file. Use edit_file to change a file that already exists and write_file to create a new one. Use the tool-call mechanism: " +
    "never describe a call in text, and never put JSON or code in your reply in place of one. Paths are relative to the project folder; " +
    "nothing outside it can be read or written. Take one step at a time and read each result before the next. The user sees every " +
    "bash command and file write and may refuse it; if they do, accept it." +
    (readOnly ? "\nPlan mode: only read_file and grep exist. Look around, then propose a plan; change nothing." : "")
  );
}

/** Drops old messages from the front, never leaving a tool result or a reply without its user message at the start. */
function trimHistory(history: ChatMessage[]): ChatMessage[] {
  let from = Math.max(0, history.length - MAX_HISTORY);
  while (from < history.length && history[from].role !== "user") from++;
  return history.slice(from);
}

/**
 * A local model through Ollama's HTTP API. In chat it is plain conversation: the persona (with the emotion and avatar tag
 * protocol) is the system prompt, so the same tags drive the avatar. In work mode, for a model that reports tool support, it
 * can also read, search, run commands and write files in the project folder: Ollama only runs the model, so the tools and
 * the loop are here, and every command and write waits for the user's approval on the same card the other brains use.
 * How well a local model uses tools depends entirely on the model.
 */
export class OllamaProvider implements Provider {
  readonly sessionId = null;
  private model: string;
  private readonly host: string;
  private readonly persona: () => string;
  private readonly forceTools: string[];
  private history: ChatMessage[] = [];
  private listener: ((event: ProviderEvent) => void) | null = null;
  private abort: AbortController | null = null;
  private stopped = false;
  private config: { mode: "chat" | "work"; cwd: string; permissionMode: PermissionMode; allowedTools: string[] } = {
    mode: "chat",
    cwd: "",
    permissionMode: "manual",
    allowedTools: [],
  };
  /** Whether the current model takes tool calls; null until checked (or when Ollama cannot say). */
  private toolCapable: boolean | null = null;
  private onCapability: (() => void) | null = null;
  private readonly pending = new Map<string, (decision: Decision) => void>();
  /** Exact calls the user allowed for the rest of this conversation. */
  private readonly allowedCalls = new Set<string>();
  private visionCapable: boolean | null = null;

  constructor(opts: OllamaOptions) {
    this.host = opts.host.replace(/\/+$/, "");
    this.model = opts.model;
    this.persona = opts.persona;
    this.forceTools = opts.forceTools ?? [];
  }

  get name(): string {
    return `ollama (${this.model})`;
  }

  get busy(): boolean {
    return this.listener !== null;
  }

  /** True when work mode is possible: the model reports (or is declared to have) tool support. */
  get canUseTools(): boolean {
    return this.toolCapable === true;
  }

  /** Asks Ollama whether the current model takes tool calls, and tells the listener if the answer changed. */
  async checkTools(): Promise<boolean | null> {
    const model = this.model;
    const [result, vision] = model ? await Promise.all([ollamaSupportsTools(this.host, model, this.forceTools), ollamaSupportsVision(this.host, model)]) : [null, null];
    if (model === this.model && (result !== this.toolCapable || vision !== this.visionCapable)) {
      this.toolCapable = result;
      this.visionCapable = vision;
      this.onCapability?.();
    }
    return result;
  }

  /** False when Ollama says the model cannot take pictures; null when it has not said (attaching is then allowed). */
  get cannotSeePictures(): boolean {
    return this.visionCapable === false;
  }

  onToolSupport(listener: () => void): void {
    this.onCapability = listener;
  }

  send(text: string, onEvent: (event: ProviderEvent) => void, images: ImageInput[] = []): void {
    if (this.listener) {
      onEvent({ type: "error", message: "Still answering the previous message." });
      return;
    }
    this.listener = onEvent;
    this.stopped = false;
    void this.run(text, images);
  }

  respondPermission(id: string, decision: Decision): void {
    const resolve = this.pending.get(id);
    if (!resolve) return;
    this.pending.delete(id);
    resolve(decision);
  }

  setPermissionMode(mode: PermissionMode): void {
    this.config = { ...this.config, permissionMode: mode };
  }

  configure(config: SessionConfig): void {
    if (this.listener) throw new Error("Wait for the current reply to finish first.");
    if (config.model !== this.model) {
      this.model = config.model; // the conversation continues with the new model
      if (this.toolCapable !== null || this.visionCapable !== null) {
        this.toolCapable = null;
        this.visionCapable = null;
        this.onCapability?.();
      }
    }
    if (this.config && config.cwd !== this.config.cwd) this.allowedCalls.clear(); // a grant is for the folder it was given in
    this.config = { mode: config.mode, cwd: config.cwd, permissionMode: config.permissionMode, allowedTools: config.allowedTools };
  }

  reset(): void {
    this.abort?.abort();
    this.denyPending();
    this.history = [];
    this.allowedCalls.clear();
  }

  interrupt(): boolean {
    if (!this.listener || !this.abort) return false;
    this.stopped = true;
    this.abort.abort();
    this.denyPending();
    return true;
  }

  close(): void {
    this.abort?.abort();
    this.denyPending();
  }

  private denyPending(): void {
    for (const [id, resolve] of this.pending) {
      this.listener?.({ type: "permission-cancelled", id });
      resolve("deny");
    }
    this.pending.clear();
  }

  private finish(event: ProviderEvent): void {
    const listener = this.listener;
    this.listener = null;
    this.abort = null;
    this.denyPending();
    listener?.(event);
  }

  /** Shows the approval card for one call and waits for the answer. */
  private ask(id: string, call: { tool: string; summary: string; input: Record<string, unknown> }): Promise<Decision> {
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.listener?.({ type: "permission", request: { id, tool: call.tool, summary: call.summary, input: call.input } });
    });
  }

  private async run(text: string, images: ImageInput[]): Promise<void> {
    const controller = new AbortController();
    this.abort = controller;
    const useTools = this.config.mode === "work" && this.toolCapable === true && Boolean(this.config.cwd);
    const readOnly = this.config.permissionMode === "plan";
    const tools = useTools ? toolDefinitions(readOnly) : undefined;
    const system = this.persona() + (useTools ? toolNote(readOnly) : "");
    const marker = images.length ? `[${images.length} image${images.length > 1 ? "s" : ""} attached]` : "";
    // Only this message carries its pictures; keeping them in the history would grow every request.
    const sent: ChatMessage & { images?: string[] } = { role: "user", content: text, ...(images.length ? { images: images.map((i) => i.data) } : {}) };
    const remembered: ChatMessage = { role: "user", content: [marker, text].filter(Boolean).join(" ") };
    /** Everything this reply added after the user's message: assistant turns, and the tool results between them. */
    const added: ChatMessage[] = [];
    const keep = () => this.history.push(remembered, ...added);
    let reply = "";
    /** What the round now being read has said so far (it is not in `added` until the round is over). */
    let live = "";

    try {
      for (let round = 0; ; round++) {
        live = "";
        const res = await fetch(`${this.host}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: this.model,
            messages: [{ role: "system", content: system }, ...trimHistory(this.history), sent, ...added],
            stream: true,
            ...(tools ? { tools, options: { num_ctx: toolContext() } } : {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const detail = await res.json().then((j: any) => j?.error, () => undefined);
          if (tools && /does not support tools/i.test(String(detail))) {
            this.toolCapable = false;
            this.onCapability?.();
            return this.finish({ type: "error", message: `${this.model} does not support tools after all, so work mode is off for it.` });
          }
          // Newer Ollama answers with an object ({"code", "message"}); older ones with a string. Never show the JSON itself.
          const said = typeof detail === "string" ? detail : typeof detail?.message === "string" ? detail.message : undefined;
          if (images.length && /multimodal|does not support (images|vision)|vision/i.test(said ?? "")) {
            return this.finish({ type: "error", message: `${this.model} cannot read pictures. Pick a model with vision, or send the message without the picture.` });
          }
          return this.finish({ type: "error", message: said ?? `Ollama answered ${res.status}.` });
        }
        if (round > 0 && reply) this.listener?.({ type: "delta", text: "\n\n" });
        const { text: said, calls } = await this.readStream(res.body, (piece) => {
          reply += piece;
          live += piece;
          this.listener?.({ type: "delta", text: piece });
        });
        if (calls.length === 0 || !tools) {
          added.push({ role: "assistant", content: said });
          keep();
          return this.finish({ type: "done" });
        }
        if (round + 1 >= MAX_TOOL_ROUNDS) {
          added.push({ role: "assistant", content: said }); // its last calls are dropped: nothing answers them
          keep();
          this.listener?.({ type: "notice", text: `She stopped after ${MAX_TOOL_ROUNDS} steps in a row. Ask again to carry on.` });
          return this.finish({ type: "done" });
        }
        added.push({ role: "assistant", content: said, tool_calls: calls });
        for (const call of calls as any[]) {
          const result = await this.runCall(call, readOnly, controller.signal);
          added.push({ role: "tool", tool_name: String(call?.function?.name ?? ""), content: result });
          if (controller.signal.aborted) throw new Error("aborted");
        }
      }
    } catch (err: any) {
      if (controller.signal.aborted && this.stopped) {
        // Stopped by the user: keep what she said so far. A call that never got its answer is dropped, text and all.
        while (added.at(-1)?.role === "tool") added.pop();
        const last = added.at(-1);
        if (last?.role === "assistant") delete last.tool_calls;
        if (live) added.push({ role: "assistant", content: live });
        if (!added.some((m) => m.role === "assistant")) added.push({ role: "assistant", content: reply });
        keep();
        return this.finish({ type: "done" });
      }
      if (controller.signal.aborted) return this.finish({ type: "error", message: "Conversation reset." });
      if (err?.fromOllama) return this.finish({ type: "error", message: String(err.message) });
      this.finish({
        type: "error",
        message: `Could not reach Ollama at ${this.host}. Is it running (ollama serve)? ${err?.cause?.code ?? err?.message ?? ""}`.trim(),
      });
    }
  }

  /** Reads one streamed answer: the text as it arrives, and any tool calls (which come in a chunk before the last). */
  private async readStream(body: ReadableStream<Uint8Array>, onText: (piece: string) => void): Promise<{ text: string; calls: unknown[] }> {
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    const calls: unknown[] = [];
    for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.error) throw Object.assign(new Error(String(msg.error)), { fromOllama: true });
        const piece = msg.message?.content;
        if (typeof piece === "string" && piece) {
          text += piece;
          onText(piece);
        }
        if (Array.isArray(msg.message?.tool_calls)) calls.push(...msg.message.tool_calls);
      }
    }
    return { text, calls };
  }

  /** One tool call: show it, ask if it needs asking, run it, and return what the model should read. */
  private async runCall(call: any, readOnly: boolean, signal: AbortSignal): Promise<string> {
    const name = String(call?.function?.name ?? "");
    const args = toArgs(call?.function?.arguments);
    const spec = toolByName(name);
    const id = randomUUID();
    const shown = describeCall(name, args);
    const status = (s: "running" | "done" | "error") => this.listener?.({ type: "tool", id, name: shown.tool, summary: shown.summary, status: s });
    status("running");
    if (!spec) {
      status("error");
      return cut((await runTool(name, args, { cwd: this.config.cwd, signal })).output);
    }
    if (readOnly && !spec.readOnly) {
      status("error");
      return "Plan mode: she may only read and search. Nothing is changed. Propose the change as a plan instead.";
    }
    // "Allow for this session" covers a file tool for the whole project (these cannot leave the project folder), but a shell command only as written.
    const key = spec.card === "Write" || spec.card === "Edit" ? `tool:${spec.card}` : `${name}:${JSON.stringify(args)}`;
    const preApproved = spec.readOnly && this.config.allowedTools.includes(spec.card);
    if (!preApproved && !this.allowedCalls.has(key)) {
      const decision = await this.ask(id, shown);
      if (decision === "deny") {
        status("error");
        return "The user declined this action.";
      }
      if (decision === "allow-session") this.allowedCalls.add(key);
    }
    const result = await runTool(name, args, { cwd: this.config.cwd, signal });
    status(result.ok ? "done" : "error");
    return cut(result.output);
  }
}

/** Installed model names, or null if Ollama is not reachable. */
export async function listOllamaModels(host: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${host.replace(/\/+$/, "")}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const body: any = await res.json();
    return (body.models ?? []).map((m: any) => String(m.name));
  } catch {
    return null;
  }
}

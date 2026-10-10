import type { ImageInput } from "../images.ts";
import type { Decision, Provider, ProviderEvent, SessionConfig } from "./types.ts";

export interface OllamaOptions {
  /** Base URL of the Ollama server, e.g. http://127.0.0.1:11434 */
  host: string;
  model: string;
  /** Resolved for every request, so the current avatar description is always included. */
  persona: () => string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Keeps requests small for local models: at most this many past messages are sent. */
const MAX_HISTORY = 40;

/**
 * A local model through Ollama's HTTP API. Chat only: no tools, so no work
 * mode and no permission prompts. The conversation lives in memory here, and the
 * persona (with the emotion and avatar tag protocol) is sent as the system prompt,
 * so the same tags drive the avatar.
 */
export class OllamaProvider implements Provider {
  readonly canUseTools = false;
  readonly sessionId = null;
  private model: string;
  private readonly host: string;
  private readonly persona: () => string;
  private history: ChatMessage[] = [];
  private listener: ((event: ProviderEvent) => void) | null = null;
  private abort: AbortController | null = null;

  constructor(opts: OllamaOptions) {
    this.host = opts.host.replace(/\/+$/, "");
    this.model = opts.model;
    this.persona = opts.persona;
  }

  get name(): string {
    return `ollama (${this.model})`;
  }

  get busy(): boolean {
    return this.listener !== null;
  }

  send(text: string, onEvent: (event: ProviderEvent) => void, images: ImageInput[] = []): void {
    if (this.listener) {
      onEvent({ type: "error", message: "Still answering the previous message." });
      return;
    }
    this.listener = onEvent;
    void this.run(text, images);
  }

  respondPermission(_id: string, _decision: Decision): void {
    // never asks: there are no tools
  }

  configure(config: SessionConfig): void {
    if (this.listener) throw new Error("Wait for the current reply to finish first.");
    this.model = config.model; // the conversation continues with the new model
  }

  reset(): void {
    this.abort?.abort();
    this.history = [];
  }

  close(): void {
    this.abort?.abort();
  }

  private finish(event: ProviderEvent): void {
    const listener = this.listener;
    this.listener = null;
    this.abort = null;
    listener?.(event);
  }

  private async run(text: string, images: ImageInput[]): Promise<void> {
    const controller = new AbortController();
    this.abort = controller;
    const messages = [
      { role: "system", content: this.persona() },
      ...this.history.slice(-MAX_HISTORY),
      // Only this message carries its pictures; keeping them in the history would grow every request.
      { role: "user", content: text, ...(images.length ? { images: images.map((i) => i.data) } : {}) },
    ];
    let reply = "";
    try {
      const res = await fetch(`${this.host}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, messages, stream: true }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const detail = await res.json().then((j: any) => j?.error, () => undefined);
        return this.finish({ type: "error", message: detail ?? `Ollama answered ${res.status}.` });
      }
      const decoder = new TextDecoder();
      let buffer = "";
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const msg = JSON.parse(line);
          if (msg.error) return this.finish({ type: "error", message: String(msg.error) });
          const piece = msg.message?.content;
          if (typeof piece === "string" && piece) {
            reply += piece;
            this.listener?.({ type: "delta", text: piece });
          }
        }
      }
      const marker = images.length ? `[${images.length} image${images.length > 1 ? "s" : ""} attached]` : "";
      this.history.push({ role: "user", content: [marker, text].filter(Boolean).join(" ") }, { role: "assistant", content: reply });
      this.finish({ type: "done" });
    } catch (err: any) {
      if (controller.signal.aborted) return this.finish({ type: "error", message: "Conversation reset." });
      this.finish({
        type: "error",
        message: `Could not reach Ollama at ${this.host}. Is it running (ollama serve)? ${err?.cause?.code ?? err?.message ?? ""}`.trim(),
      });
    }
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

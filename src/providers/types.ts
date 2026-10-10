export type ProviderEvent =
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

/**
 * A chat backend for the companion. Claude Code (headless) is the first
 * implementation; Ollama or others can be added by implementing this.
 */
export interface Provider {
  readonly name: string;
  /** Send a user message; events stream back through `onEvent` until "done" or "error". */
  send(text: string, onEvent: (event: ProviderEvent) => void): void;
  /** Forget the conversation and start fresh. */
  reset(): void;
  close(): void;
}

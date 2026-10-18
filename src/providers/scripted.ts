import { reply } from "../../public/script.js";
import type { Decision, Provider, ProviderEvent, SessionConfig } from "./types.ts";

export interface ScriptedOptions {
  /** The names of the starting characters she can become ("become Linnea"). */
  presets: () => string[];
  /** True while she is a picture pack, which cannot be redrawn. */
  pack: () => boolean;
}

/**
 * The brain when none is installed ("basic mode"): the browser demo's small rule-based reader (public/script.js), not a model. It answers with
 * the same tags a model would write, so the server applies her look, moods and gestures exactly as it does for a real brain. It has no
 * tools and no memory beyond the last few lines, so there is no work mode and nothing to approve. It is the first thing a new user sees,
 * so it says what it is (see `basicGreeting`) and never passes for a language model.
 */
export class ScriptedProvider implements Provider {
  readonly name = "Built-in script (no brain installed)";
  readonly canUseTools = false;
  readonly sessionId = null;
  private readonly opts: ScriptedOptions;
  private recent: string[] = [];
  private active: { timer: ReturnType<typeof setInterval>; onEvent: (event: ProviderEvent) => void } | null = null;

  constructor(opts: ScriptedOptions) {
    this.opts = opts;
  }

  get busy(): boolean {
    return this.active !== null;
  }

  send(text: string, onEvent: (event: ProviderEvent) => void): void {
    // The server puts a "(system note, not from the user: …)" line in front when something waits to be said; the script reads only the user's words.
    text = text.replace(/^\(system note, not from the user:[\s\S]*?\)\n\n/, "");
    const answer = reply(text, { presets: this.opts.presets(), pack: this.opts.pack(), basic: true, recent: this.recent }).text;
    this.recent = [...this.recent, text, answer.replace(/\[[^\]\n]*\]/g, " ")].slice(-8);
    // Streamed in small pieces, the way a model's answer arrives, so her mouth moves and the tags play as they do for a real brain.
    const pieces = answer.match(/\S+\s*/g) ?? [];
    let next = 0;
    const timer = setInterval(() => {
      if (next < pieces.length) return onEvent({ type: "delta", text: pieces[next++] });
      clearInterval(timer);
      this.active = null;
      onEvent({ type: "done" });
    }, 25);
    this.active = { timer, onEvent };
  }

  respondPermission(_id: string, _decision: Decision): void {}

  configure(_config: SessionConfig): void {}

  reset(): void {
    this.recent = [];
  }

  interrupt(): boolean {
    const turn = this.active;
    if (!turn) return false;
    clearInterval(turn.timer);
    this.active = null;
    turn.onEvent({ type: "done" }); // what was said so far stays, and the turn is over
    return true;
  }

  close(): void {
    this.interrupt();
  }
}

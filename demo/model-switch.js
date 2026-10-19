// The stand-in server holds one "model". This is it: the in-browser small model and Ollama behind one object, whichever is on answering
// (turning one on turns the other off, in demo/model-dialog.js).

/**
 * @param {...{ ready(): boolean, loaded(): boolean, chat(messages: any[], onPiece: (piece: string) => void): Promise<string>, stop(): void, kind?: string }} backends
 */
export function createModelSwitch(...backends) {
  const active = () => backends.find((b) => b.ready()) ?? null;
  return {
    ready: () => active() !== null,
    loaded: () => backends.some((b) => b.loaded()),
    /** "ollama" or "browser": which one answers, for the prompt it is given. */
    kind: () => active()?.kind ?? "browser",
    async chat(messages, onPiece) {
      const on = active();
      if (!on) throw new Error("no model is on");
      return on.chat(messages, onPiece);
    },
    stop: () => backends.forEach((b) => b.stop()),
  };
}

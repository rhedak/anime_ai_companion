/**
 * Things the model should hear with the user's next message: a rename, a switch of mode or look, a note from her notes file.
 * The running conversation keeps the prompt it began with (changing it would break Claude's prompt cache), so changes travel here.
 */
export function createNotes() {
  let waiting: string[] = [];
  return {
    push(text: string): void {
      waiting.push(text);
    },
    /** Like push, but not twice before the next message. */
    pushOnce(text: string): void {
      if (!waiting.includes(text)) waiting.push(text);
    },
    /** Everything waiting, and forgets it: it goes out with the next message. */
    take(): string[] {
      const out = waiting;
      waiting = [];
      return out;
    },
    /** A new conversation has nothing waiting. */
    clear(): void {
      waiting = [];
    },
  };
}

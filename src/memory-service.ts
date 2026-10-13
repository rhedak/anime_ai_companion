import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { addFact, findRememberTags, formatMemory, memoryChange, memoryIntro, nearlyFull, parseMemory } from "./memory.ts";
import type { Broadcast, Say } from "./server-types.ts";
import type { Mode } from "./providers/types.ts";

/** What the notes need from the server around them. */
export interface MemoryDeps {
  /** data/memory.md */
  file: string;
  mode(): Mode;
  broadcast: Broadcast;
  /** Opens a file in whatever the system uses for it. */
  openFile(path: string): void;
  /** What to say to a phone that asks for something only the computer may do. */
  remoteRefusal(): string;
}

/**
 * Her notes about the user (data/memory.md): the file, what the model has been told of it in this conversation, the
 * `[remember …]` tag, and the /memory command. The rules (why notes are saved in chat only, why they travel as data) are in memory.ts.
 */
export function createMemoryService(deps: MemoryDeps) {
  /** What the model has been told in this conversation; null until the first message of one. */
  let told: string[] | null = null;

  function read(): string[] {
    try {
      return parseMemory(readFileSync(deps.file, "utf8"));
    } catch {
      return [];
    }
  }

  function write(facts: string[]): void {
    mkdirSync(dirname(deps.file), { recursive: true });
    writeFileSync(deps.file, formatMemory(facts));
  }

  return {
    /** Notes ride on a message (never in the system prompt, which would break the cache): all of them at the start, changes after. */
    note(): string | null {
      const now = read(); // read each time, so an edit by hand is picked up
      const first = told === null;
      const change = first ? null : memoryChange(told!, now);
      told = now;
      return first ? memoryIntro(now, deps.mode() === "chat") : change;
    },

    /** A new conversation is told her notes again. */
    forgetTold(): void {
      told = null;
    },

    /** Saves each new complete [remember …] tag of a reply, in chat mode only. */
    makeApplier(): (reply: string) => void {
      let seen = 0;
      return (reply) => {
        const tags = findRememberTags(reply);
        for (; seen < tags.length; seen++) {
          if (deps.mode() !== "chat") {
            deps.broadcast({ type: "notice", text: `She wanted to remember: ${tags[seen]}. Notes are not saved in work mode; use /memory add <note> if you want it kept.` });
            continue;
          }
          const result = addFact(read(), tags[seen]);
          if (!result.ok) {
            if (/full|too long/.test(result.reason)) deps.broadcast({ type: "notice", text: result.reason }); // empty and duplicate notes are not worth a message
            continue;
          }
          write(result.facts);
          if (told) told = [...told, result.fact]; // she wrote it herself: no need to tell her again
          deps.broadcast({ type: "notice", text: `🧠 Remembered: ${result.fact}` + (nearlyFull(result.facts) ? " (her notes are nearly full: /memory)" : "") });
        }
      };
    },

    /** The /memory command. */
    command(args: string, say: Say, remote: boolean): void {
      const [word = "", ...rest] = args.trim().split(/\s+/);
      const text = rest.join(" ");
      const facts = read();
      if (word.toLowerCase() === "add") {
        const result = addFact(facts, text);
        if (!result.ok) return say(result.reason);
        write(result.facts);
        return say(`🧠 Noted: ${result.fact}`);
      }
      if (word.toLowerCase() === "forget") {
        const n = Number(text);
        if (text.toLowerCase() === "all") {
          write([]);
          return say("Her notes are empty now.");
        }
        if (!Number.isInteger(n) || n < 1 || n > facts.length) return say(`Use /memory forget <number from 1 to ${facts.length}> or /memory forget all.`);
        const [gone] = facts.splice(n - 1, 1);
        write(facts);
        return say(`Forgotten: ${gone}`);
      }
      if (word.toLowerCase() === "edit") {
        if (remote) return say(deps.remoteRefusal());
        if (!existsSync(deps.file)) write(facts);
        deps.openFile(deps.file); // opens the file in whatever the system uses for .md files
        return say(`Opening ${deps.file}. Changes are picked up with her next message.`);
      }
      say(
        facts.length
          ? `Her notes about you (${facts.length}):\n${facts.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n/memory add <note> | forget <number|all> | edit`
          : "She has no notes about you yet. She saves them herself in chat when you tell her something worth keeping, or use /memory add <note>.",
      );
    },
  };
}

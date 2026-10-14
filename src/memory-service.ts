import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { addFact, asksToRemember, findRememberTags, formatMemory, memoryChange, memoryIntro, nearlyFull, parseMemory } from "./memory.ts";
import type { Broadcast, Say } from "./server-types.ts";
import type { Mode } from "./providers/types.ts";
import { isMemorySaving, type MemorySaving } from "./settings.ts";

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
  /** `memorySaving` is how a note she proposes is handled; it is kept in the user's settings. */
  settings: { memorySaving: MemorySaving };
  saveSettings(): Promise<void>;
  /** Something to tell her with her next message. */
  pushNote(text: string): void;
}

/** A note she proposed that waits for the user's yes or no. */
interface Offer {
  id: string;
  fact: string;
}

/**
 * Her notes about the user (data/memory.md): the file, what the model has been told of it in this conversation, the
 * `[remember …]` tag, and the /memory command. The rules (why notes are saved in chat only, why they travel as data) are in memory.ts.
 *
 * What a `[remember …]` tag does is the user's setting: `ask` (the default) shows a card and saves only on a yes, `auto` saves it and
 * shows an Undo, `off` ignores it. Work mode never saves, whatever the setting.
 */
export function createMemoryService(deps: MemoryDeps) {
  /** What the model has been told in this conversation; null until the first message of one. */
  let told: string[] | null = null;
  /** Proposals waiting for an answer, and the ones the user turned down in this conversation (never offered again). */
  const offers = new Map<string, Offer>();
  const declined = new Set<string>();
  /** Declined notes she has not been told about yet: without it she keeps saying she saved the note (measured: 15 of 15 runs; 2 of 15 with it). */
  let declinedUntold: string[] = [];
  /** Waiting proposals she has already been told are not saved yet. */
  const waitingTold = new Set<string>();
  /** Why the user has been told she cannot save a note, once per reason in this conversation (work mode and notes off are different reasons). */
  const explained = new Set<"work" | "off">();

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

  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  function closeOffer(offer: Offer, choice: "keep" | "skip"): void {
    offers.delete(offer.id);
    deps.broadcast({ type: "memory-resolved", id: offer.id, choice });
  }

  /** Saves a fact she proposed (by herself, or because the user said yes); says why when it is refused. */
  function save(fact: string): { ok: true; fact: string; full: boolean } | { ok: false; reason: string } {
    const result = addFact(read(), fact);
    if (!result.ok) return result;
    write(result.facts);
    // Not added to `told`: her next message says "added to the user's notes", so she knows it was kept (her own tag in the history
    // is not enough: without that she answered "I have no notes about you" right after a note was saved).
    return { ok: true, fact: result.fact, full: nearlyFull(result.facts) };
  }

  /** Changes what happens to a note she proposes. Saving by herself is not something a phone may switch on. */
  async function setSaving(value: string, say: Say, remote: boolean): Promise<void> {
    if (!isMemorySaving(value)) return;
    if (remote && value === "auto") return say(deps.remoteRefusal());
    const before = deps.settings.memorySaving;
    if (value === before) return say(`Notes are already set to ${value}.`);
    deps.settings.memorySaving = value;
    await deps.saveSettings();
    if (value === "off") for (const offer of [...offers.values()]) closeOffer(offer, "skip");
    if (told !== null && (value === "off" || before === "off")) {
      deps.pushNote(value === "off" ? "The user switched off saving notes: do not write [remember …] tags until they switch it on again." : "The user switched saving notes on again: you may write [remember …] again.");
    }
    say(
      value === "ask"
        ? "She will ask before she remembers something."
        : value === "auto"
          ? "She will remember things by herself and show an Undo each time."
          : "She will not save notes. You can still add them with /memory add.",
    );
  }

  const fullHint = " (her notes are nearly full: /memory)";

  return {
    /**
     * Notes ride on a message (never in the system prompt, which would break the cache): all of them at the start, changes after.
     * When she cannot save (work mode, or notes off) and the user asks her to remember something, she is told to say so rather than
     * promise, and the user is told once why nothing will be saved.
     */
    note(userText = ""): string | null {
      const now = read(); // read each time, so an edit by hand is picked up
      const first = told === null;
      const change = first ? null : memoryChange(told!, now);
      told = now;
      const chat = deps.mode() === "chat";
      const off = deps.settings.memorySaving === "off";
      const intro = first ? memoryIntro(now, chat && !off, chat && off) : change;
      const refused = declinedUntold.length
        ? `Notes you proposed that are NOT saved: the user declined ${declinedUntold.map((f) => `"${f}"`).join("; ")}. Only notes in the user's list, or announced as added, are saved.`
        : null;
      declinedUntold = [];
      const waiting = [...offers.values()].filter((o) => !waitingTold.has(o.id));
      for (const o of waiting) waitingTold.add(o.id);
      const unanswered = waiting.length
        ? `Notes you proposed that are not saved yet: ${waiting.map((o) => `"${o.fact}"`).join("; ")}. The user has not answered; until they say yes nothing is written, so do not tell them you saved it.`
        : null;
      const base = [intro, refused, unanswered].filter(Boolean).join(" ") || null;
      if ((chat && !off) || !asksToRemember(userText)) return base;
      const reason = chat ? "off" : "work";
      if (!explained.has(reason)) {
        explained.add(reason);
        deps.broadcast({
          type: "notice",
          text: chat
            ? "Saving notes is switched off, so she will not remember that. /memory ask turns it back on, or add one yourself with /memory add <note>."
            : "Notes are for chat mode only: in work mode she cannot save anything about you. Switch to Chat, or add one yourself with /memory add <note>. " +
              "These are her own notes about you (data/memory.md), not Claude's memory feature.",
        });
      }
      const say = chat ? "Saving notes is switched off" : "You cannot save notes in work mode";
      return [base, `The user wants you to remember something. ${say}: tell them so briefly and do not promise to remember it. They can add a note with /memory add.`].filter(Boolean).join(" ");
    },

    /** A new conversation is told her notes again, and the proposals of the old one are dropped. */
    forgetTold(): void {
      told = null;
      explained.clear();
      declined.clear();
      declinedUntold = [];
      waitingTold.clear();
      for (const offer of [...offers.values()]) closeOffer(offer, "skip");
    },

    /** The proposals still waiting, so a page that connects (or reloads) can show them. */
    pending(): Offer[] {
      return [...offers.values()];
    },

    /** Handles each new complete [remember …] tag of a reply: in chat mode only, and as the user's setting says. */
    makeApplier(): (reply: string) => void {
      let seen = 0;
      return (reply) => {
        const tags = findRememberTags(reply);
        for (; seen < tags.length; seen++) {
          const saving = deps.settings.memorySaving;
          if (saving === "off") continue;
          if (deps.mode() !== "chat") {
            deps.broadcast({ type: "notice", text: `She wanted to remember: ${tags[seen]}. Notes are not saved in work mode; use /memory add <note> if you want it kept.` });
            continue;
          }
          const check = addFact(read(), tags[seen]); // cleaned, not a duplicate, room left
          if (!check.ok) {
            if (/full|too long/.test(check.reason)) deps.broadcast({ type: "notice", text: check.reason }); // empty and duplicate notes are not worth a message
            continue;
          }
          if (saving === "ask") {
            if ([...declined].some((d) => same(d, check.fact)) || [...offers.values()].some((o) => same(o.fact, check.fact))) continue;
            const offer = { id: randomUUID(), fact: check.fact };
            offers.set(offer.id, offer);
            deps.broadcast({ type: "memory-offer", ...offer });
            continue;
          }
          const saved = save(check.fact);
          if (saved.ok) deps.broadcast({ type: "memory-saved", fact: saved.fact, text: `🧠 Remembered: ${saved.fact}` + (saved.full ? fullHint : "") });
        }
      };
    },

    /** The user answered a proposal: keep it (saved as it was shown) or not now (not offered again in this conversation). */
    answer(id: unknown, choice: unknown, say: Say): void {
      const offer = typeof id === "string" ? offers.get(id) : undefined;
      if (!offer || (choice !== "keep" && choice !== "skip")) return;
      if (choice === "skip") {
        declined.add(offer.fact);
        declinedUntold.push(offer.fact);
        return closeOffer(offer, "skip");
      }
      const saved = save(offer.fact);
      closeOffer(offer, saved.ok ? "keep" : "skip");
      if (!saved.ok) say(saved.reason);
      else if (saved.full) say(`Her notes are nearly full: /memory`);
    },

    /** Undo for a note she saved by herself (`auto`): take that note out again. */
    undo(fact: unknown, say: Say): void {
      if (typeof fact !== "string") return;
      const facts = read();
      const at = facts.findIndex((f) => same(f, fact));
      if (at < 0) return say("That note is already gone.");
      facts.splice(at, 1);
      write(facts);
      say(`Forgotten: ${fact}`); // she is told on her next message that it was removed
    },

    /** The /memory command. */
    command(args: string, say: Say, remote: boolean): void | Promise<void> {
      const [word = "", ...rest] = args.trim().split(/\s+/);
      const text = rest.join(" ");
      const facts = read();
      if (isMemorySaving(word.toLowerCase())) return setSaving(word.toLowerCase(), say, remote);
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
      const saving = { ask: "she asks before saving one", auto: "she saves them herself, with an Undo", off: "she does not save them" }[deps.settings.memorySaving];
      const own = "These are her own notes about you, kept in data/memory.md on this computer; they are not Claude's memory feature. Chat mode only.";
      const options = "/memory add <note> | forget <number|all> | edit | ask | auto | off";
      say(
        facts.length
          ? `Her notes about you (${facts.length}; ${saving}):\n${facts.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n${options}\n${own}`
          : `She has no notes about you yet (${saving}). In chat she offers one when you tell her something worth keeping, or use /memory add <note>.\n${options}\n${own}`,
      );
    },
  };
}

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import {
  MAX_CARD_BYTES,
  NO_USE,
  cardFromPersona,
  cardFromSaved,
  characterFromCard,
  loreFor,
  parseCardFile,
  previewCard,
  splitPersona,
  type Card,
  type CardUse,
} from "./card.ts";
import { cleanName } from "./settings.ts";
import type { Broadcast, Say } from "./server-types.ts";
import type { Transcript } from "./transcript.ts";

/** What the cards need from the server around them. */
export interface CardDeps {
  /** data/character.json */
  file: string;
  /** persona.md as it was read. */
  personaBase: string;
  /** Her name is read and, when a card names her, changed here. */
  settings: { name: string };
  saveSettings(): Promise<void>;
  /** A note for the model, sent with its next message. */
  pushNote(text: string): void;
  /** True while a reply is in progress. */
  busy(): boolean;
  transcript: Pick<Transcript, "items" | "delta" | "flush">;
  persist(): void;
  broadcast: Broadcast;
  modeInfo(): unknown;
  remoteRefusal(): string;
}

/**
 * Character cards in use: the card, what the user chose to use of it, a card waiting for an answer, her greeting and the lorebook
 * notes. The rules about what a card may do (and why) are in card.ts and in the safety notes of AGENTS.md.
 */
export function createCardService(deps: CardDeps) {
  const parts = splitPersona(deps.personaBase);
  let card: Card | null = null;
  /** What the user ticked at import: her greeting, the author's own instructions, the lorebook. */
  let use: CardUse = { ...NO_USE };
  let pending: { card: Card; ignored: string[] } | null = null;
  /** Lorebook entries already handed to the model in this conversation: each goes out once. */
  const loreSent = new Set<number>();

  async function importFile(input: string, say: Say): Promise<void> {
    if (!parts) return say("persona.md has been reshaped (no Style: and Expression protocol sections), so a card cannot be fitted in. Restore those headings first.");
    const wanted = input.trim().replace(/^["']|["']$/g, "").replace(/^~(?=$|[\\/])/, homedir());
    if (!wanted) return say("Use /card import <path to a card .png or .json>");
    const info = await stat(wanted).catch(() => null);
    if (!info?.isFile()) return say(`There is no file at ${wanted}.`);
    if (info.size > MAX_CARD_BYTES) return say("That file is too big for a character card (over 15 MB).");
    const result = parseCardFile(await readFile(wanted));
    if (!result.ok) return say(result.reason);
    pending = { card: result.card, ignored: result.ignored };
    deps.broadcast({ type: "card-offer", current: deps.settings.name, ...previewCard(result.card, result.ignored) });
  }

  /** Her opening greeting, if the card has one and the user chose it. */
  function openingGreeting(): string | null {
    if (!card || !use.greeting || !card.greetings.length) return null;
    const pick = card.greetings[Math.floor(Math.random() * card.greetings.length)];
    return pick.replaceAll("{{name}}", deps.settings.name);
  }

  async function apply(say: Say, choice?: Partial<CardUse>): Promise<void> {
    const waiting = pending;
    if (!waiting) return say("There is no card waiting. Use /card import <file> first.");
    pending = null;
    card = waiting.card;
    // Without an explicit choice (the /card apply command): the greeting and lorebook, when the card has them. Never the author's orders.
    use = {
      greeting: (choice?.greeting ?? true) && waiting.card.greetings.length > 0,
      lore: (choice?.lore ?? true) && waiting.card.lore.length > 0,
      orders: choice?.orders === true && Boolean(waiting.card.orders),
    };
    await mkdir(dirname(deps.file), { recursive: true });
    await writeFile(deps.file, JSON.stringify({ ...waiting.card, use, importedAt: new Date().toISOString() }, null, 2) + "\n");
    deps.broadcast({ type: "card-resolved", choice: "apply" });
    const name = cleanName(waiting.card.name);
    if (name && name !== deps.settings.name) {
      deps.settings.name = name;
      await deps.saveSettings();
      deps.pushNote(`the user renamed you: your name is now ${name}.`);
      deps.broadcast(deps.modeInfo());
    }
    const chosen = [use.greeting && "her greeting", use.lore && "the lorebook", use.orders && "the author's own instructions"].filter(Boolean);
    say(
      `Her character now comes from the card${name ? ` (${name})` : ""}${chosen.length ? `, with ${chosen.join(", ")}` : ""}. A conversation that is already running keeps the persona it began with: use /clear to start with the new one.` +
        (!name && waiting.card.name ? ` The card's name "${waiting.card.name}" is not a name this app can use (1 to 24 letters, digits, spaces and . ' - _), so she keeps hers.` : ""),
    );
  }

  async function reset(say: Say): Promise<void> {
    pending = null;
    if (!card) return say("She is using persona.md already.");
    card = null;
    use = { ...NO_USE };
    await rm(deps.file, { force: true });
    say(`She is back to the character in persona.md, and keeps the name ${deps.settings.name} (rename her with /rename). Use /clear to start a conversation with it.`);
  }

  function exportCard(say: Say, reply: (msg: unknown) => void): void {
    if (!parts) return say("persona.md has been reshaped, so there is no character part to export.");
    // With a card imported, export what she actually runs on: the card's character with her name filled in.
    const character = card ? card.description : parts.character;
    const slug = deps.settings.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "companion";
    reply({ type: "card-export", filename: `${slug}-card.json`, json: cardFromPersona(character, deps.settings.name, card ?? {}) });
  }

  function cancel(): void {
    pending = null;
    deps.broadcast({ type: "card-resolved", choice: "cancel" });
  }

  return {
    /** Reads data/character.json, if there is one. */
    async load(): Promise<void> {
      try {
        const saved = cardFromSaved(JSON.parse(await readFile(deps.file, "utf8")));
        if (saved) ({ card, use } = saved);
      } catch {
        // no card: persona.md is her character
      }
    },

    /** persona.md, with the character part replaced by the card's when one is in use. The protocol after it is always ours. */
    personaText(): string {
      return card && parts ? characterFromCard(card, parts.style, { orders: use.orders }) + parts.protocol : deps.personaBase;
    },

    /** Starts an empty conversation with her greeting: shown like a reply, but nothing was asked of the model. */
    greet(): void {
      const text = openingGreeting();
      if (!text || deps.busy() || deps.transcript.items.length > 0) return;
      const said = `[emotion:happy] ${text}`;
      deps.transcript.delta(said);
      deps.transcript.flush();
      deps.persist();
      deps.broadcast({ type: "delta", text: said });
      deps.broadcast({ type: "done" });
      deps.pushNote(`you opened this conversation by saying: "${text}"`); // she should know what she already said
    },

    /** The lorebook entries this message brings up, as a note: each entry once per conversation. */
    loreNote(userText: string): string | null {
      if (!card || !use.lore || !card.lore.length) return null;
      const hit = loreFor(card.lore, userText, loreSent);
      if (!hit) return null;
      hit.indexes.forEach((i) => loreSent.add(i));
      return hit.note;
    },

    /** A new conversation hears its lorebook again. */
    forgetLore(): void {
      loreSent.clear();
    },

    /** The /card command. */
    async command(args: string, say: Say, reply: (msg: unknown) => void, remote: boolean): Promise<void> {
      const [sub = ""] = args.trim().split(/\s+/);
      const word = sub.toLowerCase();
      if (remote && word !== "export") return say(deps.remoteRefusal());
      if (word === "import") return importFile(args.trim().slice(sub.length), say);
      if (word === "apply") {
        // /card apply  uses the greeting and lorebook; /card apply greeting lore orders  uses exactly those; /card apply none  none.
        const named = args.trim().split(/\s+/).slice(1).map((w) => w.toLowerCase());
        return apply(say, named.length ? { greeting: named.includes("greeting"), lore: named.includes("lore"), orders: named.includes("orders") } : undefined);
      }
      if (word === "cancel") return cancel();
      if (word === "export") return exportCard(say, reply);
      if (word === "reset") return reset(say);
      say(`Her character comes from ${card ? `a card${card.name ? ` (${card.name})` : ""}` : "persona.md"}. Use /card import <file.png|.json>, /card export or /card reset.`);
    },

    /** The answer from the import dialog. */
    async answer(choice: "apply" | "cancel", chosen: { greeting?: boolean; lore?: boolean; orders?: boolean } | undefined, say: Say, remote: boolean): Promise<void> {
      if (remote) return say(deps.remoteRefusal());
      if (choice === "apply") return apply(say, { greeting: chosen?.greeting === true, lore: chosen?.lore === true, orders: chosen?.orders === true });
      cancel();
    },
  };
}

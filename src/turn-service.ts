import { randomUUID } from "node:crypto";
import { GESTURE_NAMES, type AvatarService } from "./avatar.ts";
import { findAvatarTags, findImageTags } from "./avatar-tags.ts";
import { coldCache, formatIdle, formatTokens, type ConversationState } from "./cache-guard.ts";
import { demoMessage } from "./demo.ts";
import { gestureNote, type FramePack } from "./frame-pack.ts";
import type { ImageInput } from "./images.ts";
import type { createCardService } from "./card-service.ts";
import type { createMemoryService } from "./memory-service.ts";
import type { createNotes } from "./notes.ts";
import type { createQueueService } from "./queue-service.ts";
import type { createSkillsService } from "./skills-service.ts";
import type { Limit } from "./providers/claude-stream.ts";
import type { PermissionRequest, Provider, ProviderEvent } from "./providers/types.ts";
import type { Broadcast, Say } from "./server-types.ts";
import { checkShownImage } from "./shown-images.ts";
import type { ShownRecord, Transcript } from "./transcript.ts";

/** What a turn needs from the server around it. */
export interface TurnDeps {
  provider(): Provider;
  /** The brain's name in settings ("claude", "ollama", …). */
  brain(): string;
  avatar: AvatarService;
  transcript: Transcript;
  /** The picture pack in use, if any. */
  activePack(): FramePack | null;
  emotionNames(): string[];
  /** The folder she works in: pictures she names are looked up there. */
  folder(): string;
  broadcast: Broadcast;
  /** Saves the visible log soon. */
  persist(): void;
  convo: ConversationState;
  /** What the footer shows about the account; the limits arrive with a reply. */
  account: { model: string | null; session: Limit | null; week: Limit | null; limitsAt: number | null };
  /** Approvals waiting for an answer, so a reloaded tab can show them again. */
  pendingPermissions: Map<string, PermissionRequest>;
  meterInfo(): unknown;
  looksInfo(): unknown;
  notes: ReturnType<typeof createNotes>;
  memory: ReturnType<typeof createMemoryService>;
  cards: ReturnType<typeof createCardService>;
  skills: ReturnType<typeof createSkillsService>;
  queue: ReturnType<typeof createQueueService>;
}

/** `[demo]` in a reply: she was asked to show all her emotions and gestures (see `src/demo.ts`). */
const DEMO_TAG = /\[demo\]/;

const MAX_SHOWN_PER_REPLY = 8;

/**
 * One turn from start to finish: what is sent to the brain (with the notes that wait), how its reply is shown as it streams (tags for
 * her look and her notes, pictures she names), what is saved and said when it ends, and the question when a long-idle conversation
 * would cost a full read. Her memory of a long conversation sits in Claude's prompt cache, which expires after about an hour; a message
 * sent after that has to send the whole conversation again, which for a long one is a big part of the usage limit. So the message waits
 * while the user chooses: send it as it is, summarise first (Claude Code's /compact), or hold it back.
 */
export function createTurnService(deps: TurnDeps) {
  /** A message waiting for the user to decide how to pay for a cold cache. */
  let held: { text: string; images: ImageInput[] } | null = null;

  /** Applies each new complete [avatar ...] tag of a reply as it arrives. */
  function makeTagApplier(): (reply: string) => void {
    let seen = 0;
    return (reply) => {
      const tags = findAvatarTags(reply);
      for (; seen < tags.length; seen++) {
        if (deps.activePack()) {
          deps.notes.pushOnce(`Your look is a fixed set of pictures now: [avatar ...] tags change nothing, so do not use them. ${gestureNote(deps.activePack())}`);
          continue;
        }
        deps.avatar
          .applyPatch(tags[seen])
          .then(({ applied, rejected }) => {
            if (applied.length) {
              deps.transcript.look(applied);
              deps.broadcast({ type: "avatar", version: deps.avatar.version, applied });
              deps.broadcast(deps.looksInfo());
            }
            if (rejected.length) deps.notes.push("Your avatar tag had problems: " + rejected.map((r) => `${r.key}: ${r.reason}`).join("; ") + ".");
          })
          .catch((err) => console.error("avatar patch failed:", err));
      }
    };
  }

  /** The pictures named by `[image path]` tags in a finished reply, checked and registered. */
  async function collectShownImages(reply: string): Promise<ShownRecord[]> {
    const records: ShownRecord[] = [];
    const problems: string[] = [];
    const wanted = [...new Set(findImageTags(reply))];
    if (wanted.length > MAX_SHOWN_PER_REPLY) {
      problems.push(`only ${MAX_SHOWN_PER_REPLY} pictures can be shown per reply, so the last ${wanted.length - MAX_SHOWN_PER_REPLY} were left out; show them in a follow-up message`);
    }
    for (const requested of wanted.slice(0, MAX_SHOWN_PER_REPLY)) {
      const checked = await checkShownImage(requested, deps.folder());
      if ("error" in checked) problems.push(checked.error);
      else records.push({ id: randomUUID(), name: checked.name, path: checked.path, root: checked.root, mime: checked.mime });
    }
    if (problems.length) deps.notes.push(`Your image tag had problems: ${problems.join("; ")}.`);
    return records;
  }

  /** The message as the brain gets it: with a note in front when something waits to be said. */
  function withNotes(userText: string): string {
    const background = [deps.memory.note(), deps.cards.loreNote(userText)].filter((n): n is string => Boolean(n));
    const waiting = [...background, ...deps.notes.take()];
    return waiting.length ? `(system note, not from the user: ${waiting.join(" ")})\n\n${userText}` : userText;
  }

  /** The event handler for one turn: streams the reply, applies any [avatar ...] tags as they complete. */
  function turnHandler(userText: string, opts: { raw?: boolean; onFinish?: (event: ProviderEvent) => void }): (event: ProviderEvent) => void {
    let reply = "";
    const applyNewTags = makeTagApplier();
    const applyMemory = deps.memory.makeApplier();

    return (event) => {
      if (event.type === "delta") {
        reply += event.text;
        deps.transcript.delta(event.text);
        applyNewTags(reply);
        applyMemory(reply);
        deps.broadcast(event);
      } else if (event.type === "tool") {
        deps.skills.noticeToolUse(event);
        deps.transcript.tool({ type: "tool", id: event.id, name: event.name, summary: event.summary, status: event.status });
        deps.broadcast(event);
      } else if (event.type === "permission") {
        deps.pendingPermissions.set(event.request.id, event.request);
        deps.broadcast(event);
      } else if (event.type === "permission-cancelled") {
        deps.pendingPermissions.delete(event.id);
        deps.broadcast(event);
      } else if (event.type === "status" || event.type === "notice") {
        deps.broadcast(event);
      } else if (event.type === "limits") {
        deps.account.session = event.session;
        deps.account.week = event.week;
        deps.account.limitsAt = Date.now();
        deps.broadcast(deps.meterInfo());
      } else if (event.type === "model") {
        deps.account.model = event.name;
        deps.broadcast(deps.meterInfo());
      } else {
        deps.pendingPermissions.clear();
        applyNewTags(reply);
        applyMemory(reply);
        // Let queued avatar changes land before the turn is reported finished.
        deps.avatar.settled().finally(async () => {
          deps.transcript.flush();
          // Pictures she named are shown under her message, once the files exist (she may just have made them).
          const images = event.type === "done" ? await collectShownImages(reply).catch(() => []) : [];
          if (images.length) {
            deps.transcript.images(images);
            deps.broadcast({ type: "images", images: images.map(({ id, name }) => ({ id, name })) });
          }
          if (event.type === "done") {
            // After a /compact, the size the CLI reports still describes the conversation before it.
            const compacted = opts.raw && /^\/compact\b/.test(userText);
            deps.convo.contextTokens = compacted ? null : deps.provider().usage?.contextTokens ?? null;
            deps.convo.lastReplyAt = Date.now();
          }
          deps.persist();
          deps.broadcast(event);
          deps.broadcast(deps.meterInfo()); // the context grew
          // She was asked to show off: the page plays the sequence once her reply is done.
          if (event.type === "done" && DEMO_TAG.test(reply)) deps.broadcast(demoMessage(deps.emotionNames(), GESTURE_NAMES, deps.activePack()));
          opts.onFinish?.(event);
          deps.skills.applyPending();
          // A failed reply does not send what was queued behind it; a good one lets the next message go.
          if (event.type === "done") deps.queue.drain();
          else deps.queue.drop();
        });
      }
    };
  }

  /** Runs one turn: the message goes to the brain, and the reply is shown as it streams. */
  function run(userText: string, opts: { raw?: boolean; images?: ImageInput[]; onFinish?: (event: ProviderEvent) => void } = {}): void {
    // Slash commands go to Claude Code as they are: a note in front would stop it seeing the command.
    const toModel = opts.raw ? userText : withNotes(userText);
    deps.provider().send(toModel, turnHandler(userText, opts), opts.images);
  }

  /** Shows the user's message in the log and sends it to the brain. */
  function send(text: string, images: ImageInput[], onFinish?: (event: ProviderEvent) => void): void {
    deps.transcript.user(text, images.length);
    deps.broadcast({ type: "user", text, images: images.map((i) => `data:${i.mediaType};base64,${i.data}`) });
    run(text, { images, onFinish });
  }

  const coldCard = (cold: { tokens: number; idleMinutes: number }) => ({
    type: "cold-cache",
    tokens: formatTokens(cold.tokens),
    idle: formatIdle(cold.idleMinutes),
    text: held?.text ?? "",
  });

  return {
    run,
    send,
    turnHandler,

    /** A message from the user: held for a question, queued behind a reply, asked about (cold cache), or sent. */
    submit(text: string, images: ImageInput[], say: Say): void {
      if (held) return say("Decide what to do with your earlier message first (the question above).");
      if (deps.provider().busy) return deps.queue.enqueue(text, images, say);
      const cold = deps.brain() === "claude" ? coldCache(deps.convo) : null;
      if (cold) {
        held = { text, images };
        return deps.broadcast(coldCard(cold));
      }
      send(text, images);
    },

    /** True while a message waits for the user's decision. */
    holding: () => held !== null,

    /** The question again, for a page that connects while one is open. */
    heldQuestion(): unknown | null {
      return held ? coldCard(coldCache(deps.convo) ?? { tokens: deps.convo.contextTokens ?? 0, idleMinutes: 0 }) : null;
    },

    /** A new conversation does not keep a held message. */
    dropHeld(): void {
      if (!held) return;
      held = null;
      deps.broadcast({ type: "cold-resolved", choice: "dropped" });
    },

    /** The user answered the cold-cache question. */
    answerCold(choice: string, say: Say): void {
      const message = held;
      if (!message) return;
      if (choice !== "send" && choice !== "summarise" && choice !== "cancel") return;
      if (deps.provider().busy) return say("Wait for her to finish the current reply first.");
      held = null;
      deps.broadcast({ type: "cold-resolved", choice });
      if (choice === "send") return send(message.text, message.images);
      if (choice === "cancel") return;
      deps.transcript.user("/compact");
      deps.broadcast({ type: "user", text: "/compact" });
      run("/compact", {
        raw: true,
        onFinish: (event) => {
          if (event.type === "done") return send(message.text, message.images);
          // The summary did not happen: do not spend a cold read on the message behind the user's back.
          deps.broadcast({ type: "notice", text: `The summary failed, so this was not sent: ${message.text}` });
        },
      });
    },
  };
}

import { randomUUID } from "node:crypto";
import type { ImageInput } from "./images.ts";
import type { Broadcast, Say } from "./server-types.ts";

/** What the queue needs from the server around it. */
export interface QueueDeps {
  /** True while a reply is in progress. */
  busy(): boolean;
  /** True while a message is held back with a question (the cold-cache card). */
  held(): boolean;
  /** Shows the message in the log and sends it to the brain. */
  send(text: string, images: ImageInput[]): void;
  broadcast: Broadcast;
}

interface Queued {
  id: string;
  text: string;
  images: ImageInput[];
}

const MAX_QUEUED = 10;

/**
 * Messages typed while she is still answering, like Claude Code's: they wait in order and go out one by one as each reply ends.
 * Memory only. Stop, an error, /clear or a new brain give the words back to the box instead of sending them.
 */
export function createQueueService(deps: QueueDeps) {
  let queue: Queued[] = [];

  /** What the page shows: the waiting messages, and any text that was just given back. */
  const message = (returned: string[] = []) => ({
    type: "queue",
    items: queue.map((q) => ({ id: q.id, text: q.text, images: q.images.length })),
    returned,
  });

  return {
    message,

    enqueue(text: string, images: ImageInput[], say: Say): void {
      if (queue.length >= MAX_QUEUED) return say(`${MAX_QUEUED} messages are already waiting: let her catch up first.`);
      queue.push({ id: randomUUID(), text, images });
      deps.broadcast(message());
    },

    /** The user took one back out. */
    remove(id: string): void {
      const before = queue.length;
      queue = queue.filter((q) => q.id !== id);
      if (queue.length !== before) deps.broadcast(message());
    },

    /** The next waiting message goes out once nothing is running. */
    drain(): void {
      if (deps.busy() || deps.held()) return;
      const next = queue.shift();
      if (!next) return;
      deps.broadcast(message());
      deps.send(next.text, next.images);
    },

    /** Stop, an error, /clear or a new brain: the waiting words go back to the box instead of being lost or sent later. */
    drop(): void {
      if (queue.length === 0) return;
      const returned = queue.map((q) => q.text).filter(Boolean);
      const pictures = queue.reduce((n, q) => n + q.images.length, 0);
      queue = [];
      deps.broadcast(message(returned));
      if (pictures) deps.broadcast({ type: "notice", text: `${pictures} attached picture${pictures > 1 ? "s were" : " was"} not kept; attach again to send.` });
    },
  };
}

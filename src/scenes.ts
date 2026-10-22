/**
 * Short scenes for chat (`/play`). One at a time, memory only: a restart or /clear ends it.
 * The note rides on every message while a scene is on, because her system prompt does not change mid-conversation.
 */

export interface Scene {
  id: string;
  title: string;
  /** One line in the chat when it starts. The locked room replaces this when the counts are not the defaults. */
  blurb: string;
  /** Told to her with every message while it is on. */
  note: string;
}

/** How many of each thing a locked room has. `/play room` uses these; `/play room 4 1 2 1` replaces them. */
export interface RoomCounts {
  steps: number;
  hints: number;
  herrings: number;
  traps: number;
}

export const ROOM_DEFAULTS: RoomCounts = { steps: 5, hints: 1, herrings: 3, traps: 1 };

/** Inclusive. A room with no correct choice cannot be finished, so hints start at 1. */
const ROOM_LIMITS: Record<keyof RoomCounts, readonly [number, number]> = {
  steps: [1, 8],
  hints: [1, 3],
  herrings: [0, 6],
  traps: [0, 3],
};

const COUNT_LABEL: Record<keyof RoomCounts, string> = {
  steps: "Steps",
  hints: "Hints",
  herrings: "Red herrings",
  traps: "Traps",
};

const COUNT_KEY: Record<string, keyof RoomCounts> = {
  step: "steps",
  steps: "steps",
  hint: "hints",
  hints: "hints",
  herring: "herrings",
  herrings: "herrings",
  miss: "herrings",
  misses: "herrings",
  trap: "traps",
  traps: "traps",
};

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"];

function countPhrase(count: number, one: string, many: string): string {
  const word = WORDS[count] ?? String(count);
  return `${word} ${count === 1 ? one : many}`;
}

/** The line the chat shows when this room starts. */
export function roomBlurb(counts: RoomCounts): string {
  const steps = countPhrase(counts.steps, "step", "steps");
  return `${steps.charAt(0).toUpperCase()}${steps.slice(1)}. Each has ${countPhrase(counts.hints, "hint", "hints")}, ${countPhrase(counts.herrings, "red herring", "red herrings")} and ${countPhrase(counts.traps, "trap", "traps")}. A trap, or asking her to choose, starts the room over.`;
}

/**
 * The note for one locked room. She writes the whole story on the first reply, into `[play plan …]`,
 * which the page already hides (the same way it hides `[play end]`). Later replies read that story back.
 */
export function roomNote(counts: RoomCounts): string {
  const objects = counts.hints + counts.herrings + counts.traps;
  return (
    `A scene is on, called "The locked room". It is a short story about you and the user, trapped together and looking for a way out, told in ${countPhrase(counts.steps, "scene", "scenes")} (one step each). Stay yourself. Do not add dice, a character sheet, or a second plot. ` +
    `Each step has ${countPhrase(counts.hints, "correct choice", "correct choices")} (the hint), ${countPhrase(counts.herrings, "red herring", "red herrings")} and ${countPhrase(counts.traps, "trap", "traps")}, so ${countPhrase(objects, "object", "objects")}. ` +
    `Any correct choice opens the next step. A red herring does nothing and the step stays open. A trap is a failure: the room starts over at step one, and the story stays the one you already wrote. ` +
    `The chat already told the user the counts, so do not recite the rules. ` +
    `The correct choices share one thread the user can reason out, a pattern that runs through every step. Hide that thread in what things look like and where they sit. Do not say the thread until the user is out or gives up. ` +
    `If you have not written the story yet, invent a fresh place and that thread now, and write every step before you show any of it. Write it once, in one tag, and do not put a ] inside it: ` +
    `[play plan place: <a few words> | thread: <the pattern, one sentence> | step 1: <one sentence of the two of you here> <one sentence for each object> correct: <short action> wrong: <one>; <two>; <three> trap: <short action> | step 2: ...]. ` +
    `Match the counts above when they differ from that example. Separate several correct choices with a semicolon, the same way as the red herrings. Each object gets its own sentence, with what it looks like and where it is. The tag is invisible. Never say the plan, and never say which object is the hint, a red herring or a trap. ` +
    `If a plan is already in the conversation, that story is frozen. Do not invent another place, and do not move a choice. ` +
    `Show only the current step. While this scene is on, the usual limit of one or two narration lines does not apply. Read back the sentences you wrote for this step, each as its own narration line (a line of its own wrapped in asterisks, third person, your own pronouns, and the user is there with you), then one short spoken line. Give every object the same weight. Do not list choices or offer a menu. ` +
    `Something you did not write is not in the room. Do not add it. ` +
    `If the user asks you to choose, decide, or pick for them, that is a trap, even when this room has no other trap. Asking you to repeat a detail you already said is allowed, and it is not a trap. ` +
    `On a trap, say that it failed and that you are back at step one, then read step one again from the same plan. On a red herring, say that nothing useful happened and stay on this step. You may say the step number. ` +
    `When the last step is done, say that you are out, explain the thread and name each correct choice in order, and write [play end]. ` +
    `If the user gives up in their own words, explain the thread and name each correct choice in order, then write [play end]. The user can also stop the scene with /play end.`
  );
}

export const SCENES: readonly Scene[] = [
  {
    id: "key",
    title: "The spare key",
    blurb: "You're locked out. A few minutes.",
    note:
      'A short scene is on, called "The spare key". It lasts a few minutes, about three or four replies, and then it is over. Stay yourself. Do not add dice, a character sheet or extra plot. ' +
      "You and the user are locked out. There is one place a spare key might be, and one person who might have it. Something small goes wrong. Then you are in, or you give up. " +
      "If you have not opened the scene yet, open it now in your own voice and wait. When it resolves, say so and write [play end] in that reply. The tag is invisible. The user can also stop it with /play end.",
  },
  {
    id: "room",
    title: "The locked room",
    blurb: roomBlurb(ROOM_DEFAULTS),
    note: roomNote(ROOM_DEFAULTS),
  },
];

const ALIASES: Record<string, string> = {
  key: "key",
  spare: "key",
  "spare-key": "key",
  "the-spare-key": "key",
  room: "room",
  escape: "room",
  "locked-room": "room",
  "the-locked-room": "room",
};

export function sceneById(id: string): Scene | undefined {
  return SCENES.find((scene) => scene.id === id);
}

/** The scene a `/play` argument names, ignoring any counts after the name. */
export function sceneByArg(arg: string): Scene | undefined {
  const tokens = arg.trim().split(/\s+/).filter(Boolean);
  for (let n = Math.min(tokens.length, 4); n >= 1; n--) {
    const id = ALIASES[tokens.slice(0, n).join("-").toLowerCase()];
    const scene = id ? sceneById(id) : undefined;
    if (scene) return scene;
  }
  return undefined;
}

/** What `/play` with no match says, so a later scene shows up here on its own. */
export function sceneList(): string {
  return SCENES.map((scene) => `${scene.title} (/play ${scene.id})`).join("; ");
}

export type PlayStart = { ok: true; scene: Scene; note: string; blurb: string } | { ok: false; text: string };

/** `/play <name>` plus an optional `5 1 3 1` or `steps=5 hints=1 herrings=3 traps=1`. */
export function startPlay(arg: string): PlayStart {
  const tokens = arg.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { ok: false, text: `Scenes: ${sceneList()}` };
  let scene: Scene | undefined;
  let rest: string[] = [];
  for (let n = Math.min(tokens.length, 4); n >= 1; n--) {
    const id = ALIASES[tokens.slice(0, n).join("-").toLowerCase()];
    const found = id ? sceneById(id) : undefined;
    if (found) {
      scene = found;
      rest = tokens.slice(n);
      break;
    }
  }
  if (!scene) return { ok: false, text: `No scene called "${arg.trim()}". ${sceneList()}` };
  if (scene.id !== "room") {
    if (rest.length > 0) return { ok: false, text: `${scene.title} does not take counts. /play room 5 1 3 1 sets steps, hints, herrings and traps.` };
    return { ok: true, scene, note: scene.note, blurb: scene.blurb };
  }
  const counts = parseRoomCounts(rest);
  if (!counts.ok) return counts;
  return { ok: true, scene, note: roomNote(counts.counts), blurb: roomBlurb(counts.counts) };
}

function parseRoomCounts(rest: string[]): { ok: true; counts: RoomCounts } | { ok: false; text: string } {
  const counts: RoomCounts = { ...ROOM_DEFAULTS };
  if (rest.length === 0) return { ok: true, counts };
  const positional = rest.every((token) => /^\d+$/.test(token));
  const named = rest.every((token) => /^[a-z-]+=\d+$/i.test(token));
  if (!positional && !named) {
    return { ok: false, text: "Give the counts as steps, hints, herrings and traps (for example /play room 5 1 3 1), or as steps=5 hints=1 herrings=3 traps=1." };
  }
  if (positional) {
    if (rest.length > 4) return { ok: false, text: "A room takes four counts at most: steps, hints, herrings, traps." };
    (["steps", "hints", "herrings", "traps"] as const).forEach((key, index) => {
      if (rest[index] != null) counts[key] = Number(rest[index]);
    });
  } else {
    const seen = new Set<keyof RoomCounts>();
    for (const token of rest) {
      const eq = token.indexOf("=");
      const key = COUNT_KEY[token.slice(0, eq).toLowerCase()];
      if (!key) return { ok: false, text: `Unknown count "${token.slice(0, eq)}". Use steps, hints, herrings and traps.` };
      if (seen.has(key)) return { ok: false, text: `${COUNT_LABEL[key]} was given twice.` };
      seen.add(key);
      counts[key] = Number(token.slice(eq + 1));
    }
  }
  for (const key of ["steps", "hints", "herrings", "traps"] as const) {
    const [lo, hi] = ROOM_LIMITS[key];
    if (!Number.isInteger(counts[key]) || counts[key] < lo || counts[key] > hi) {
      return { ok: false, text: `${COUNT_LABEL[key]} must be from ${lo} to ${hi}.` };
    }
  }
  return { ok: true, counts };
}

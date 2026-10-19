/**
 * Plays the "show off" sequence the server lists (src/demo.ts): each step is held long enough to see, and a
 * single line in the chat names it as it happens. Anything else she does (a new message, a reset) ends it.
 */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drawn bodies whose face and arms the drawing engine does not animate yet (creator 0.5.0's adult body draws one fixed face and arms, so an emotion, a blink,
 * the talking mouth and a gesture all give the same picture). For such a look `/show` says so instead of playing a sequence in which nothing changes.
 */
export const BODIES_WITHOUT_EXPRESSIONS = ["adult_female"];
export const NO_EXPRESSIONS_TEXT =
  "This drawn look has no expressions or gestures yet in the drawing engine, so /show would not change her face (and her moods and talking mouth do nothing for it either). " +
  "Her picture packs do have them: Looks → Packs…, or pick another look.";

/** How long each emotion is held, in milliseconds. */
export const DEMO_HOLD_MS = 1000;

/**
 * The message that starts the show for the drawn character: each emotion in turn, a blink, talking, then the gestures. One list for
 * the server (src/demo.ts) and the browser demo (demo/local-socket.js), so both show the same thing.
 * @param {string[]} emotions
 * @param {string[]} gestures
 */
export function drawnDemoMessage(emotions, gestures) {
  return {
    type: "demo",
    hold: DEMO_HOLD_MS,
    steps: [
      ...emotions.map((name) => ({ kind: "emotion", name })),
      { kind: "blink" },
      { kind: "talk" },
      ...gestures.map((name) => ({ kind: "gesture", name })),
    ],
  };
}

/**
 * The same for a picture pack: only what its pictures can show, and what was left out said once at the end. `pack` has `emotions` (each with
 * `idle`, `blink`, `talk`) and `gestures` (the pose pictures of each gesture), as the server's FramePack and the page's PackInfo both do.
 * @param {string[]} emotions
 * @param {string[]} gestures
 * @param {{ emotions: Record<string, { blink?: string, talk: string[] }>, gestures: Record<string, string[]> }} pack
 */
export function packDemoMessage(emotions, gestures, pack) {
  const have = emotions.filter((name) => pack.emotions[name]);
  const missing = emotions.filter((name) => !pack.emotions[name]);
  const pictures = Object.values(pack.emotions);
  /** @type {({ kind: string, name?: string })[]} */
  const steps = have.map((name) => ({ kind: "emotion", name }));
  if (pictures.some((e) => e.blink)) steps.push({ kind: "blink" });
  if (pictures.some((e) => e.talk.length)) steps.push({ kind: "talk" });
  const moves = gestures.filter((name) => pack.gestures[name]?.length);
  for (const name of moves) steps.push({ kind: "gesture", name });
  const noMoves = gestures.filter((name) => !moves.includes(name));
  const left = [...(noMoves.length ? [`gestures ${noMoves.join(", ")} (no pictures)`] : []), ...(missing.length ? [`${missing.join(", ")} (no pictures)`] : [])];
  if (!left.length) return { type: "demo", hold: DEMO_HOLD_MS, steps };
  return { type: "demo", hold: DEMO_HOLD_MS, steps, note: `Left out in this pack: ${left.join("; ")}.` };
}

/**
 * @param avatar     what `createAvatar` returns
 * @param caption    `set(text)` shows the current line, `done(text)` the last one
 * @param options    `sleep` and `gestureMs` can be replaced (the tests do)
 */
export function createDemo(avatar, caption, { sleep = wait, gestureMs = 2400 } = {}) {
  let token = 0;
  let active = false;

  function rest() {
    avatar.setTalking(false);
    avatar.setEmotion("neutral");
  }

  return {
    get running() {
      return active;
    },
    cancel() {
      if (!active) return;
      token++;
      active = false;
      rest();
      caption.done("Stopped.");
    },
    async start({ steps, hold = 1000, note }) {
      const mine = ++token;
      active = true;
      const live = () => token === mine;
      const hold_ = Math.min(5000, Math.max(300, Number(hold) || 1000));
      caption.set("Getting ready…");
      await avatar.warm(
        steps.filter((s) => s.kind === "emotion").map((s) => s.name),
        steps.filter((s) => s.kind === "gesture").map((s) => s.name),
      );
      for (const step of steps) {
        if (!live()) return;
        if (step.kind === "emotion") {
          caption.set(`Emotion: ${step.name}`);
          avatar.setEmotion(step.name);
          await sleep(hold_);
        } else if (step.kind === "blink") {
          caption.set("Blinking");
          avatar.setEmotion("neutral");
          for (let i = 0; i < 3 && live(); i++) {
            avatar.blink(350);
            await sleep(hold_ / 2);
          }
        } else if (step.kind === "talk") {
          caption.set("Talking");
          avatar.setEmotion("happy");
          avatar.setTalking(true);
          await sleep(hold_ * 2);
          avatar.setTalking(false);
        } else if (step.kind === "gesture") {
          caption.set(`Gesture: ${step.name}`);
          avatar.setEmotion("happy");
          avatar.gesture(step.name, gestureMs);
          await sleep(gestureMs + 400);
        }
      }
      if (!live()) return;
      active = false;
      rest();
      caption.done(`That is all of them.${note ? " " + note : ""}`);
    },
  };
}

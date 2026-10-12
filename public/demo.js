/**
 * Plays the "show off" sequence the server lists (src/demo.ts): each step is held long enough to see, and a
 * single line in the chat names it as it happens. Anything else she does (a new message, a reset) ends it.
 */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

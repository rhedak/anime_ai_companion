import assert from "node:assert/strict";
import { test } from "node:test";
import { demoMessage } from "../src/demo.ts";
import type { FramePack } from "../src/frame-pack.ts";
import { createDemo } from "../public/demo.js";

const emotions = ["neutral", "happy", "sad", "thinking"];
const gestures = ["wave", "cheer"];

const packOf = (emotionPictures: FramePack["emotions"], poses: FramePack["gestures"] = {}): FramePack => ({ name: "p", emotions: emotionPictures, gestures: poses, activities: {}, files: new Map(), notes: [] });

test("the drawn avatar shows every emotion, a blink, talking and each gesture, in that order", () => {
  const m = demoMessage(emotions, gestures, null);
  assert.deepEqual(m.steps, [
    ...emotions.map((name) => ({ kind: "emotion", name })),
    { kind: "blink" },
    { kind: "talk" },
    { kind: "gesture", name: "wave" },
    { kind: "gesture", name: "cheer" },
  ]);
  assert.equal(m.hold, 1000);
  assert.equal(m.note, undefined);
});

test("a picture pack shows only what its pictures have, and says what it left out", () => {
  const m = demoMessage(emotions, gestures, packOf({ neutral: { idle: "n", blink: "nb", talk: [] }, happy: { idle: "h", talk: [] } }));
  assert.deepEqual(m.steps, [{ kind: "emotion", name: "neutral" }, { kind: "emotion", name: "happy" }, { kind: "blink" }]);
  assert.match(m.note ?? "", /gestures/);
  assert.match(m.note ?? "", /sad, thinking/);
  const noBlink = demoMessage(emotions, gestures, packOf({ neutral: { idle: "n", talk: ["t1"] } }));
  assert.deepEqual(noBlink.steps.map((s) => s.kind), ["emotion", "talk"]);
});

test("a picture pack with poses for a gesture shows that gesture, and leaves out only the others", () => {
  const faces = { neutral: { idle: "n", talk: [] } };
  const some = demoMessage(["neutral"], gestures, packOf(faces, { wave: ["w1", "w2"] }));
  assert.deepEqual(some.steps, [{ kind: "emotion", name: "neutral" }, { kind: "gesture", name: "wave" }]);
  assert.match(some.note ?? "", /cheer \(no pictures\)/);
  assert.doesNotMatch(some.note ?? "", /wave/);
  const all = demoMessage(["neutral"], gestures, packOf(faces, { wave: ["w1"], cheer: ["c1", "c2"] }));
  assert.equal(all.note, undefined); // nothing left out, so nothing to say
});

/** An avatar and a clock that only record, so the whole sequence runs at once. */
function harness(options: { onSleep?: (ms: number, count: number) => void } = {}) {
  const calls: string[] = [];
  const lines: string[] = [];
  const avatar = {
    setEmotion: (n: string) => calls.push(`emotion ${n}`),
    setTalking: (on: boolean) => calls.push(`talking ${on}`),
    gesture: (n: string, ms?: number) => calls.push(`gesture ${n} ${ms}`),
    blink: (ms?: number) => calls.push(`blink ${ms}`),
    warm: async (e: string[], g: string[]) => void calls.push(`warm ${e.join(",")} | ${g.join(",")}`),
  };
  const caption = { set: (t: string) => lines.push(t), done: (t: string) => lines.push(`DONE ${t}`) };
  let slept = 0;
  const sleeps: number[] = [];
  const demo = createDemo(avatar, caption, {
    gestureMs: 100,
    sleep: async (ms) => {
      sleeps.push(ms);
      options.onSleep?.(ms, ++slept);
    },
  });
  return { demo, calls, lines, sleeps };
}

test("each step is held for a second and named as it plays", async () => {
  const { demo, calls, lines, sleeps } = harness();
  await demo.start(demoMessage(emotions, gestures, null));
  assert.deepEqual(lines.slice(0, 5), ["Getting ready…", "Emotion: neutral", "Emotion: happy", "Emotion: sad", "Emotion: thinking"]);
  assert.deepEqual(lines.slice(5), ["Blinking", "Talking", "Gesture: wave", "Gesture: cheer", "DONE That is all of them."]);
  assert.equal(calls[0], "warm neutral,happy,sad,thinking | wave,cheer"); // frames are asked for before the first one shows
  assert.deepEqual(sleeps.slice(0, 4), [1000, 1000, 1000, 1000]);
  assert.equal(calls.filter((c) => c.startsWith("blink")).length, 3);
  assert.ok(calls.includes("gesture wave 100") && calls.includes("gesture cheer 100"));
  assert.deepEqual(calls.slice(-2), ["talking false", "emotion neutral"]); // and she rests afterwards
  assert.equal(demo.running, false);
});

test("a pack's note ends the sequence", async () => {
  const { demo, lines } = harness();
  await demo.start({ steps: [{ kind: "emotion", name: "happy" }], note: "Left out: gestures." });
  assert.equal(lines.at(-1), "DONE That is all of them. Left out: gestures.");
});

test("cancelling stops it where it is, and a later start is not disturbed by the old one", async () => {
  let demoRef: ReturnType<typeof createDemo> | null = null;
  const h = harness({ onSleep: (_ms, count) => count === 2 && demoRef?.cancel() });
  demoRef = h.demo;
  await h.demo.start(demoMessage(emotions, gestures, null));
  assert.equal(h.demo.running, false);
  assert.equal(h.lines.at(-1), "DONE Stopped.");
  assert.ok(!h.lines.includes("Emotion: sad"));
  assert.ok(!h.lines.some((l) => l.includes("all of them")));
  const calls = h.calls.length;
  await h.demo.start({ steps: [{ kind: "emotion", name: "sad" }] });
  assert.equal(h.lines.at(-1), "DONE That is all of them.");
  assert.ok(h.calls.length > calls);
});

test("cancelling when nothing is playing does nothing", () => {
  const { demo, lines } = harness();
  demo.cancel();
  assert.deepEqual(lines, []);
});

test("the hold is kept within reason, whatever the server says", async () => {
  const { demo, sleeps } = harness();
  await demo.start({ steps: [{ kind: "emotion", name: "happy" }], hold: 999999 });
  await demo.start({ steps: [{ kind: "emotion", name: "happy" }], hold: 1 });
  assert.deepEqual(sleeps, [5000, 300]);
});

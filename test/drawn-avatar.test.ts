import assert from "node:assert/strict";
import { test } from "node:test";
import { createAvatar } from "../public/avatar.js";

/** Just enough of a page for the drawn avatar: SVG elements that clone, a host, and a frame loop turned by hand. */
function fakePage() {
  const saved = { DOMParser: (globalThis as any).DOMParser, raf: globalThis.requestAnimationFrame, error: console.error, random: Math.random };
  let queued: ((now: number) => void)[] = [];
  const svg = (name: string) => {
    const el = {
      name,
      localName: "svg",
      attributes: [] as unknown[],
      attrs: {} as Record<string, string>,
      querySelectorAll: () => [] as unknown[],
      setAttribute: (key: string, value: string) => void (el.attrs[key] = value),
      cloneNode: () => svg(name),
    };
    return el;
  };
  (globalThis as any).DOMParser = class {
    parseFromString(text: string) {
      return { documentElement: svg(text) };
    }
  };
  globalThis.requestAnimationFrame = ((cb: (now: number) => void) => void queued.push(cb)) as never;
  const errors: unknown[] = [];
  console.error = (...args: unknown[]) => void errors.push(args);
  Math.random = () => 0;
  let child: { name: string; attrs?: Record<string, string> } | null = null;
  const host = {
    replaceChildren: (...els: { name: string; attrs?: Record<string, string> }[]) => (child = els[0] ?? null),
    get firstElementChild() {
      return child;
    },
    classList: { toggle: () => {} },
  };
  return {
    host: host as unknown as HTMLElement,
    errors,
    shown: () => child?.name ?? null,
    /** The viewBox the shown picture has been given. */
    view: () => child?.attrs?.viewBox ?? null,
    /** Run one frame of the loop at `ms` on the page's own clock. */
    frame(ms: number) {
      const now = queued;
      queued = [];
      for (const cb of now) cb(ms);
    },
    pending: () => queued.length,
    restore() {
      Object.assign(globalThis, { DOMParser: saved.DOMParser, requestAnimationFrame: saved.raf });
      console.error = saved.error;
      Math.random = saved.random;
    },
  };
}

const frames = (emotion: string, n = 5) => Array.from({ length: n }, (_, i) => `${emotion}-${i}`);

test("a gesture that starts a moment after the frame began still shows its pose, and the loop keeps going", () => {
  const page = fakePage();
  try {
    const avatar = createAvatar(page.host, () => {}, () => {});
    const loops = page.pending(); // the drawn avatar's and the pictures' frame loops
    avatar.setVersion(1);
    avatar.receiveFrames({ version: 1, emotion: "neutral", svgs: frames("neutral") });
    avatar.receiveGesture({ version: 1, emotion: "neutral", gesture: "wave", svgs: ["wave-a", "wave-b"] });
    const began = performance.now();
    avatar.gesture("wave", 2000);
    // A frame whose timestamp is earlier than the moment the gesture began: this used to throw.
    page.frame(began - 5);
    assert.deepEqual(page.errors, []);
    assert.match(page.shown() ?? "", /^wave-/);
    assert.equal(page.pending(), loops, "the next frame is still scheduled");
    page.frame(began + 300);
    assert.equal(page.shown(), "wave-b");
    page.frame(began + 2500); // the gesture is over: back to her face (which may be mid-blink)
    assert.match(page.shown() ?? "", /^neutral-/);
  } finally {
    page.restore();
  }
});

test("a gesture that brings its own view is shown in it, the close-up comes back after, and the whole body wins over both", () => {
  const page = fakePage();
  try {
    const avatar = createAvatar(page.host, () => {}, () => {});
    avatar.setVersion(1);
    avatar.receiveFrames({ version: 1, emotion: "neutral", svgs: frames("neutral") });
    avatar.receiveGesture({ version: 1, emotion: "neutral", gesture: "cheer", svgs: ["cheer-a", "cheer-b"], view: "15 -30 370 360" });
    avatar.receiveGesture({ version: 1, emotion: "neutral", gesture: "wave", svgs: ["wave-a", "wave-b"] });
    const began = performance.now();
    avatar.gesture("cheer", 2000);
    page.frame(began + 10);
    assert.match(page.shown() ?? "", /^cheer-/);
    assert.equal(page.view(), "15 -30 370 360", "the cheer's own view");
    page.frame(began + 2500);
    assert.match(page.shown() ?? "", /^neutral-/);
    assert.equal(page.view(), "55 0 290 330", "the usual close-up after it");
    const second = performance.now();
    avatar.gesture("wave", 2000);
    page.frame(second + 10);
    assert.match(page.shown() ?? "", /^wave-/);
    assert.equal(page.view(), "55 0 290 330", "a gesture with no view of its own keeps the close-up");
    avatar.setFull(true);
    page.frame(second + 20);
    avatar.gesture("cheer", 2000);
    page.frame(second + 400);
    assert.equal(page.view(), "0 0 400 500", "the whole body is the whole body");
  } finally {
    page.restore();
  }
});

test("a frame that fails does not end the loop", () => {
  const page = fakePage();
  try {
    const avatar = createAvatar(page.host, () => {}, () => {});
    const loops = page.pending(); // the drawn avatar's and the pictures' frame loops
    avatar.setVersion(1);
    // Four frames where five are expected: the blink frame is missing, so showing it fails.
    avatar.receiveFrames({ version: 1, emotion: "neutral", svgs: frames("neutral", 4) });
    page.frame(1000);
    assert.equal(page.shown(), "neutral-0");
    avatar.setEmotion("neutral");
    page.frame(10_000_000); // far past the first scheduled blink: picks the blink frame, which is not there
    assert.equal(page.errors.length, 1, "the failure is reported, not thrown");
    assert.equal(page.pending(), loops, "and the next frame is still scheduled");
    avatar.receiveFrames({ version: 1, emotion: "neutral", svgs: frames("neutral") });
    page.frame(10_000_500); // after the blink
    assert.match(page.shown() ?? "", /^neutral-/);
  } finally {
    page.restore();
  }
});

test("a frame that fails is handed to the page's error reporter when there is one", () => {
  const page = fakePage();
  try {
    const told: unknown[] = [];
    const avatar = createAvatar(page.host, () => {}, () => {}, (err: unknown) => void told.push(err));
    avatar.setVersion(1);
    avatar.receiveFrames({ version: 1, emotion: "neutral", svgs: frames("neutral", 4) });
    page.frame(1000);
    page.frame(10_000_000); // the blink frame is missing
    assert.equal(told.length, 1);
    assert.deepEqual(page.errors, [], "and it did not also go to the console");
  } finally {
    page.restore();
  }
});

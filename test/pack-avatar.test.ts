import assert from "node:assert/strict";
import { test } from "node:test";
import { createAvatar } from "../public/avatar.js";

/** Just enough of a page for the avatar: a host element, <img>s, and a frame loop the test turns by hand. */
function fakePage() {
  const saved = { Image: (globalThis as any).Image, DOMParser: (globalThis as any).DOMParser, raf: globalThis.requestAnimationFrame, random: Math.random };
  let queued: ((now: number) => void)[] = [];
  class FakeImage {
    className = "";
    alt = "";
    draggable = true;
    src = "";
    style: Record<string, string> = {};
  }
  (globalThis as any).Image = FakeImage;
  (globalThis as any).DOMParser = class {};
  globalThis.requestAnimationFrame = ((cb: (now: number) => void) => void queued.push(cb)) as never;
  let children: FakeImage[] = [];
  const classes = new Set<string>();
  const host = {
    append: (...els: FakeImage[]) => children.push(...els),
    replaceChildren: (...els: FakeImage[]) => (children = els),
    get firstElementChild() {
      return children[0] ?? null;
    },
    classList: { toggle: (name: string, on: boolean) => void (on ? classes.add(name) : classes.delete(name)) },
  };
  const t0 = performance.now();
  return {
    host: host as unknown as HTMLElement,
    classes,
    /** Run one frame of the loop at `ms` after the page started. */
    frame(ms: number) {
      const now = queued;
      queued = [];
      for (const cb of now) cb(t0 + ms);
    },
    imgs: () => children,
    visible: () => children.filter((i) => i.style.visibility === "visible").map((i) => i.src),
    restore() {
      Object.assign(globalThis, { Image: saved.Image, DOMParser: saved.DOMParser, requestAnimationFrame: saved.raf });
      Math.random = saved.random;
    },
  };
}

const pack = {
  name: "p",
  emotions: {
    neutral: { idle: "n.png", blink: "n-blink.png", talk: ["n-t1.png", "n-t2.png"] },
    happy: { idle: "h.png", blink: "h-blink.png", talk: [] },
    sad: { idle: "s.png", talk: [] },
  },
};

test("a pack shows one picture at a time and falls back to neutral for an emotion it has none for", () => {
  const page = fakePage();
  try {
    const avatar = createAvatar(page.host, () => {}, () => {});
    avatar.usePack(pack);
    assert.equal(avatar.packed, true);
    page.frame(100);
    assert.deepEqual(page.visible(), ["n.png"]);
    assert.equal(page.imgs().length, 4); // every picture of the emotion in use is in the page, so swaps never wait
    avatar.setEmotion("happy");
    page.frame(200);
    assert.deepEqual(page.visible(), ["h.png"]);
    avatar.setEmotion("surprised"); // not in the pack
    page.frame(300);
    assert.deepEqual(page.visible(), ["n.png"]);
    assert.equal(page.imgs().every((i) => i.draggable === false && i.className === "frame"), true);
  } finally {
    page.restore();
  }
});

test("she blinks briefly when there is a blink picture, and never when there is not", () => {
  const page = fakePage();
  try {
    const avatar = createAvatar(page.host, () => {}, () => {});
    avatar.usePack(pack);
    page.frame(100);
    assert.deepEqual(page.visible(), ["n.png"]);
    page.frame(2600); // past the first scheduled blink
    assert.deepEqual(page.visible(), ["n-blink.png"]);
    page.frame(2650);
    assert.deepEqual(page.visible(), ["n-blink.png"]);
    page.frame(2750); // 130 ms later
    assert.deepEqual(page.visible(), ["n.png"]);
    avatar.setEmotion("sad"); // no blink picture
    for (let ms = 3000; ms < 30000; ms += 500) {
      page.frame(ms);
      assert.deepEqual(page.visible(), ["s.png"]);
    }
  } finally {
    page.restore();
  }
});

test("talking cycles the rest picture and the mouth-open ones, and does nothing without any", () => {
  const page = fakePage();
  try {
    let n = 0;
    Math.random = () => [0.1, 0.6, 0.3, 0.9][n++ % 4];
    const avatar = createAvatar(page.host, () => {}, () => {});
    avatar.usePack(pack);
    avatar.setTalking(true);
    assert.equal(page.classes.has("talking"), true);
    const seen = new Set<string>();
    for (let ms = 100; ms < 2400; ms += 50) {
      page.frame(ms);
      seen.add(page.visible()[0]);
    }
    assert.deepEqual([...seen].sort(), ["n-t1.png", "n-t2.png", "n.png"]);
    avatar.setTalking(false);
    page.frame(2400);
    assert.deepEqual(page.visible(), ["n.png"]);
    avatar.setEmotion("sad"); // no talk pictures: she stays on the rest picture (the page still bobs her)
    avatar.setTalking(true);
    for (let ms = 2500; ms < 4400; ms += 50) {
      page.frame(ms);
      assert.deepEqual(page.visible(), ["s.png"]);
    }
  } finally {
    page.restore();
  }
});

test("switching to the drawn avatar and back leaves no stale pictures, and keeps the emotion", () => {
  const page = fakePage();
  try {
    const avatar = createAvatar(page.host, () => {}, () => {});
    avatar.setEmotion("happy"); // before any pack: remembered
    avatar.usePack(pack);
    page.frame(100);
    assert.deepEqual(page.visible(), ["h.png"]);
    avatar.usePack(null);
    assert.equal(avatar.packed, false);
    page.frame(200);
    assert.equal(page.imgs().length, 0);
    avatar.usePack(pack);
    page.frame(300);
    assert.deepEqual(page.visible(), ["h.png"]);
    assert.doesNotThrow(() => {
      avatar.gesture("wave");
      avatar.setFull(true);
      avatar.receiveFrames({ version: 1, emotion: "happy", svgs: [] });
    });
  } finally {
    page.restore();
  }
});

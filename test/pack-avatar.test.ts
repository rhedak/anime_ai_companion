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
    /** A picture is loaded at once unless a test says otherwise (`loading` below). */
    complete = true;
    naturalWidth = 1;
    setAttribute() {}
    remove() {
      children = children.filter((c) => c !== this);
    }
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
    get children() {
      return children;
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
    /** Pictures that load slowly: until `finish`, they are not complete. */
    slow(...names: string[]) {
      const original = (globalThis as any).Image;
      (globalThis as any).Image = class extends original {
        constructor() {
          super();
          const self = this as any;
          let src = "";
          Object.defineProperty(this, "src", {
            get: () => src,
            set: (v: string) => {
              src = v;
              if (names.includes(v)) {
                self.complete = false;
                self.naturalWidth = 0;
              }
            },
          });
        }
      };
    },
    finish(name: string) {
      const img = children.find((c) => c.src === name);
      if (img) Object.assign(img, { complete: true, naturalWidth: 1 });
    },
    visible: () => children.filter((i) => i.style.visibility === "visible").map((i) => i.src),
    restore() {
      Object.assign(globalThis, { Image: saved.Image, DOMParser: saved.DOMParser, requestAnimationFrame: saved.raf });
      Math.random = saved.random;
    },
  };
}

const pack = {
  name: "p",
  gestures: {},
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

test("a gesture alternates the pack's pose pictures for a moment, and does nothing for a gesture it has none for", () => {
  const page = fakePage();
  try {
    const avatar = createAvatar(page.host, () => {}, () => {});
    avatar.usePack({ ...pack, gestures: { wave: ["w1.png", "w2.png"] } });
    page.frame(100);
    assert.deepEqual(page.visible(), ["n.png"]);
    avatar.gesture("cheer"); // no poses for it
    page.frame(150);
    assert.deepEqual(page.visible(), ["n.png"]);
    avatar.gesture("wave", 1000);
    page.frame(200); // the first frame may start a moment before the gesture did
    const first = page.visible();
    assert.ok(["w1.png", "w2.png"].includes(first[0]));
    const seen = new Set<string>();
    for (let ms = 200; ms < 950; ms += 40) { // the gesture lasts a second from the real clock, a few milliseconds after t0
      page.frame(ms);
      seen.add(page.visible()[0]);
    }
    assert.deepEqual([...seen].sort(), ["w1.png", "w2.png"]);
    page.frame(1500); // over: back to her face
    assert.deepEqual(page.visible(), ["n.png"]);
  } finally {
    page.restore();
  }
});

test("switching to the drawn avatar and back keeps the emotion, never empties the stage, and leaves no stale pictures behind", () => {
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
    assert.deepEqual(page.visible(), ["h.png"], "the pack's last picture stays until the drawn body has a frame to replace it: the stage is never empty");
    avatar.usePack(pack);
    page.frame(300);
    assert.deepEqual(page.visible(), ["h.png"]);
    assert.deepEqual(page.imgs().map((i) => i.src), ["h.png", "h-blink.png"], "only this pack's pictures of the emotion in use are left");
    assert.doesNotThrow(() => {
      avatar.gesture("wave");
      avatar.setFull(true);
      avatar.receiveFrames({ version: 1, emotion: "happy", svgs: [] });
    });
  } finally {
    page.restore();
  }
});

test("a picture that has not loaded yet is not swapped in: the one on screen stays until it is there (no flicker, she never disappears)", () => {
  const page = fakePage();
  try {
    page.slow("h.png");
    const avatar = createAvatar(page.host, () => {}, () => {});
    avatar.usePack(pack);
    page.frame(100);
    assert.deepEqual(page.visible(), ["n.png"]);
    avatar.setEmotion("happy");
    page.frame(200);
    assert.deepEqual(page.visible(), ["n.png"], "happy is still loading: neutral stays");
    page.frame(300);
    assert.deepEqual(page.visible(), ["n.png"]);
    page.finish("h.png");
    page.frame(400);
    assert.deepEqual(page.visible(), ["h.png"], "and it changes at the next frame once it has loaded");
  } finally {
    page.restore();
  }
});

test("switching to another pack keeps what was on the stage until its first picture has loaded, then removes it", () => {
  const page = fakePage();
  try {
    const avatar = createAvatar(page.host, () => {}, () => {});
    avatar.usePack(pack);
    page.frame(100);
    page.slow("x-n.png");
    const other = { name: "q", gestures: {}, emotions: { neutral: { idle: "x-n.png", talk: [] } } };
    avatar.usePack(other as never);
    page.frame(200);
    assert.deepEqual(page.visible(), ["n.png"], "the first pack's picture is still there while the second one loads");
    assert.equal(page.imgs().length >= 2, true);
    page.finish("x-n.png");
    page.frame(300);
    assert.deepEqual(page.visible(), ["x-n.png"]);
    assert.deepEqual(page.imgs().map((i) => i.src), ["x-n.png"], "the old pack's pictures are gone");
  } finally {
    page.restore();
  }
});

test("an activity loops its pictures until it ends, and the talking set takes over from the same step while she speaks", () => {
  const page = fakePage();
  try {
    const avatar = createAvatar(page.host, () => {}, () => {});
    const swimming = { loop: ["a1.png", "a2.png", "a3.png"], talk: ["t1.png", "t2.png", "t3.png"] };
    avatar.usePack({ ...pack, activities: { swimming } });
    page.frame(100);
    assert.deepEqual(page.visible(), ["n.png"]);
    avatar.setActivity("diving"); // a pack with no pictures for it: she keeps her emotions
    page.frame(200);
    assert.deepEqual(page.visible(), ["n.png"]);
    avatar.setActivity("swimming");
    const start = performance.now() - performance.timeOrigin; // the loop counts from when the activity began
    void start;
    page.frame(300);
    assert.deepEqual(page.visible(), ["a1.png"]);
    page.frame(300 + 340);
    assert.deepEqual(page.visible(), ["a2.png"]);
    avatar.setTalking(true);
    page.frame(300 + 345);
    assert.deepEqual(page.visible(), ["t2.png"], "same step, mouth open: the arms do not jump");
    page.frame(300 + 680);
    assert.deepEqual(page.visible(), ["t3.png"]);
    page.frame(300 + 1010); // and it wraps
    assert.deepEqual(page.visible(), ["t1.png"]);
    avatar.setTalking(false);
    page.frame(300 + 1015);
    assert.deepEqual(page.visible(), ["a1.png"]);
    avatar.setActivity(null);
    page.frame(300 + 1400);
    assert.deepEqual(page.visible(), ["n.png"]);
  } finally {
    page.restore();
  }
});

test("without a talking set the loop goes on while she speaks, and the activity survives a change of outfit", () => {
  const page = fakePage();
  try {
    const avatar = createAvatar(page.host, () => {}, () => {});
    avatar.usePack({ ...pack, activities: { swimming: { loop: ["a1.png", "a2.png"], talk: [] } } });
    avatar.setActivity("swimming");
    avatar.setTalking(true);
    page.frame(100);
    assert.deepEqual(page.visible().length, 1);
    assert.match(page.visible()[0], /^a[12]\.png$/);
    avatar.usePack({ ...pack, name: "q" }); // another outfit with no such pictures: the neutral face, the activity is still on
    page.frame(200);
    assert.deepEqual(page.visible().length, 1);
    avatar.usePack({ ...pack, activities: { swimming: { loop: ["b1.png"], talk: [] } } });
    page.frame(300);
    assert.deepEqual(page.visible(), ["b1.png"]);
  } finally {
    page.restore();
  }
});

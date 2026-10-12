// Shows the frames the backend renders from the anime-character-creator package
// and animates between them. Anything exposing the same few methods can replace
// this (e.g. a VRM or Live2D renderer).

/**
 * The SVG comes from the server, but some of its text is chosen by the model, so it is
 * treated as untrusted: no scripts, no embedded HTML, no event handlers, no external links.
 */
export function sanitize(root) {
  for (const el of [root, ...root.querySelectorAll("*")]) {
    const tag = el.localName.toLowerCase();
    if (tag === "script" || tag === "foreignobject" || tag === "iframe" || tag === "object" || tag === "embed") {
      el.remove();
      continue;
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const link = name === "href" || name === "xlink:href";
      if (name.startsWith("on") || (link && !attr.value.startsWith("#"))) el.removeAttribute(attr.name);
    }
  }
  return root;
}

const CLOSE_UP = "55 0 290 330";
const FULL_BODY = "0 0 400 500";
const BLINK = 4; // frame index; 0-3 are mouth openings from shut to wide

function createDrawnAvatar(host, requestFrames, requestGesture) {
  let active = true;
  let version = -1;
  let emotion = "neutral";
  let talking = false;
  let full = false;
  let shown = -1;
  let blinkUntil = 0;
  let nextBlink = performance.now() + 2500;
  let nextMouth = 0;
  let mouth = 0;
  /** emotion -> parsed <svg> elements, one per frame, for the current version */
  const cache = new Map();
  /** "emotion:gesture" -> the pose frames to alternate between */
  const gestureCache = new Map();
  let gestureName = null;
  let gestureStart = 0;
  let gestureUntil = 0;

  const parser = new DOMParser();

  function setView() {
    const svg = host.firstElementChild;
    if (svg) svg.setAttribute("viewBox", full ? FULL_BODY : CLOSE_UP);
  }

  function showSvg(source, key) {
    const svg = source.cloneNode(true);
    svg.setAttribute("viewBox", full ? FULL_BODY : CLOSE_UP);
    svg.setAttribute("preserveAspectRatio", "xMidYMax meet");
    host.replaceChildren(svg);
    shown = key;
  }

  function show(index) {
    const frames = cache.get(emotion);
    if (frames) showSvg(frames[index], index);
  }

  function ensure(name) {
    if (!cache.has(name)) requestFrames(name);
  }

  function pickFrame(now) {
    if (now > nextBlink) {
      blinkUntil = now + 130;
      nextBlink = now + 2500 + Math.random() * 3500;
    }
    if (now < blinkUntil) return BLINK;
    if (!talking) return 0;
    if (now > nextMouth) {
      mouth = (mouth + 1 + Math.floor(Math.random() * 2)) % 4;
      nextMouth = now + 85 + Math.random() * 60;
    }
    return mouth;
  }

  function frame(now) {
    const poses = now < gestureUntil ? gestureCache.get(`${emotion}:${gestureName}`) : null;
    if (poses) {
      // pose frames carry their own (resting) mouth; keys 100+ mark them apart from normal frames.
      // A frame's timestamp is when it began, which can be a moment before a gesture that started
      // since: never a negative time, or the index goes negative and no pose is found.
      const key = 100 + (Math.floor(Math.max(0, now - gestureStart) / 280) % poses.length);
      if (key !== shown) showSvg(poses[key - 100], key);
    } else {
      const index = pickFrame(now);
      if (index !== shown || host.firstElementChild === null) show(index);
    }
  }

  function tick(now) {
    // One bad frame must never end the loop: an uncaught error here would leave her frozen on
    // whatever she showed last, for good. The next frame tries again.
    try {
      if (active) frame(now);
    } catch (err) {
      console.error("avatar frame failed:", err);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return {
    /** Only the active avatar draws into the host; switching back repaints from scratch. */
    setActive(on) {
      active = on;
      if (on) {
        shown = -1;
        host.replaceChildren();
      }
    },
    /** The character changed on the server: drop every cached frame and refetch. */
    setVersion(v) {
      if (v === version) return;
      version = v;
      cache.clear();
      gestureCache.clear();
      requestFrames(emotion);
    },
    setEmotion(name) {
      if (name === emotion) return;
      emotion = name;
      ensure(name);
      if (performance.now() < gestureUntil && !gestureCache.has(`${name}:${gestureName}`)) requestGesture(name, gestureName);
      shown = -1; // redraw right away if this emotion's frames are already here
    },
    /** Shut the eyes now, for `ms` milliseconds (a blink is about 130). */
    blink(ms = 130) {
      blinkUntil = performance.now() + ms;
    },
    /** Ask for these emotions' frames and gesture poses (in the happy face) ahead of time; resolves once they are here. */
    warm(emotions, gestures = []) {
      for (const name of emotions) ensure(name);
      for (const name of gestures) if (!gestureCache.has(`happy:${name}`)) requestGesture("happy", name);
      const started = performance.now();
      return new Promise((resolve) => {
        const check = () => {
          const ready = emotions.every((n) => cache.has(n)) && gestures.every((n) => gestureCache.has(`happy:${n}`));
          if (ready || performance.now() - started > 5000) resolve();
          else setTimeout(check, 100);
        };
        check();
      });
    },
    /** Raise an arm for a moment: "wave" or "cheer". */
    gesture(name, ms = 2400) {
      const now = performance.now();
      gestureName = name;
      gestureStart = now;
      gestureUntil = now + ms;
      if (!gestureCache.has(`${emotion}:${name}`)) requestGesture(emotion, name);
    },
    receiveGesture(msg) {
      if (msg.version !== version) return;
      gestureCache.set(
        `${msg.emotion}:${msg.gesture}`,
        msg.svgs.map((text) => sanitize(parser.parseFromString(text, "image/svg+xml").documentElement)),
      );
    },
    setTalking(on) {
      talking = on;
      host.classList.toggle("talking", on);
    },
    setFull(on) {
      full = on;
      setView();
    },
    /** Frames arrive from the server for a given version and emotion. */
    receiveFrames(msg) {
      if (msg.version !== version) return;
      cache.set(
        msg.emotion,
        msg.svgs.map((text) => sanitize(parser.parseFromString(text, "image/svg+xml").documentElement)),
      );
      if (msg.emotion === emotion) shown = -1;
    },
  };
}

/**
 * A set of the user's own pictures (see src/frame-pack.ts) instead of the drawn body. Every picture of the
 * emotion in use is in the page at once and only one is visible, so a swap never waits for a decode.
 */
function createPackAvatar(host) {
  let active = false;
  let pack = null;
  let emotion = "neutral";
  let talking = false;
  let blinkUntil = 0;
  let nextBlink = performance.now() + 2500;
  let nextMouth = 0;
  let mouth = 0;
  let shown = null;
  /** url -> its <img>, created the first time the emotion that uses it is on screen */
  const images = new Map();

  const entry = () => pack?.emotions[emotion] ?? pack?.emotions.neutral;

  function imageFor(url) {
    let img = images.get(url);
    if (!img) {
      img = new Image();
      img.className = "frame";
      img.alt = "";
      img.draggable = false;
      img.style.visibility = "hidden";
      img.src = url;
      images.set(url, img);
      host.append(img);
    }
    return img;
  }

  function show(url) {
    if (url === shown) return;
    const next = imageFor(url);
    next.style.visibility = "visible";
    if (shown) images.get(shown).style.visibility = "hidden";
    shown = url;
  }

  function pick(now, e) {
    if (e.blink && now > nextBlink) {
      blinkUntil = now + 130;
      nextBlink = now + 2500 + Math.random() * 3500;
    }
    if (e.blink && now < blinkUntil) return e.blink;
    if (!talking || !e.talk.length) return e.idle;
    if (now > nextMouth) {
      mouth = (mouth + 1 + Math.floor(Math.random() * 2)) % (e.talk.length + 1);
      nextMouth = now + 85 + Math.random() * 60;
    }
    return mouth === 0 ? e.idle : e.talk[mouth - 1];
  }

  function tick(now) {
    try {
      const e = active && entry();
      if (e) {
        for (const url of [e.idle, e.blink, ...e.talk]) if (url) imageFor(url); // load the rest while the idle one shows
        show(pick(now, e));
      }
    } catch (err) {
      console.error("avatar frame failed:", err); // and carry on: see the drawn avatar's loop
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return {
    setActive(on) {
      active = on;
      shown = null;
      images.clear();
      host.replaceChildren();
    },
    setPack(info) {
      pack = info;
      shown = null;
      images.clear();
      host.replaceChildren();
    },
    setEmotion(name) {
      emotion = name;
    },
    setTalking(on) {
      talking = on;
      host.classList.toggle("talking", on);
    },
    blink(ms = 130) {
      blinkUntil = performance.now() + ms;
    },
    /** Load these emotions' pictures ahead of time so none is blank the first time it shows. */
    warm(emotions) {
      const loading = [];
      for (const name of emotions) {
        const e = pack?.emotions[name];
        if (!e) continue;
        for (const url of [e.idle, e.blink, ...e.talk]) {
          if (!url) continue;
          const img = imageFor(url);
          if (!img.complete) loading.push(new Promise((done) => (img.addEventListener("load", done, { once: true }), img.addEventListener("error", done, { once: true }))));
        }
      }
      return Promise.race([Promise.all(loading).then(() => {}), new Promise((done) => setTimeout(done, 5000))]);
    },
    // A picture set has one fixed framing and cannot raise an arm or be redrawn.
    setVersion() {},
    setFull() {},
    gesture() {},
    receiveGesture() {},
    receiveFrames() {},
  };
}

/**
 * What the page talks to: the drawn avatar, or a user's picture pack once the server says one is chosen.
 * Each call goes to whichever is showing, and the state they share (emotion, talking, framing) is replayed
 * on a switch so she does not come back mid-sentence in the wrong face.
 */
export function createAvatar(host, requestFrames, requestGesture) {
  const drawn = createDrawnAvatar(host, requestFrames, requestGesture);
  const packed = createPackAvatar(host);
  let current = drawn;
  const state = { emotion: "neutral", talking: false, full: false, version: -1 };

  return {
    /** The pack to show, or null for the drawn avatar. */
    usePack(info) {
      const next = info ? packed : drawn;
      if (next === packed) packed.setPack(info);
      if (next !== current) {
        current.setActive(false);
        current = next;
        current.setActive(true);
      }
      current.setEmotion(state.emotion);
      current.setTalking(state.talking);
      current.setFull(state.full);
      current.setVersion(state.version);
    },
    get packed() {
      return current === packed;
    },
    setVersion(v) {
      state.version = v;
      drawn.setVersion(v); // keeps its frames current even while a pack is showing, so switching back is instant
    },
    setEmotion(name) {
      state.emotion = name;
      current.setEmotion(name);
    },
    setTalking(on) {
      state.talking = on;
      current.setTalking(on);
    },
    setFull(on) {
      state.full = on;
      current.setFull(on);
    },
    gesture: (...args) => current.gesture(...args),
    blink: (...args) => current.blink(...args),
    warm: (...args) => current.warm(...args),
    receiveGesture: (msg) => drawn.receiveGesture(msg),
    receiveFrames: (msg) => drawn.receiveFrames(msg),
  };
}

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

export function createAvatar(host, requestFrames, requestGesture) {
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

  function tick(now) {
    const poses = now < gestureUntil ? gestureCache.get(`${emotion}:${gestureName}`) : null;
    if (poses) {
      // pose frames carry their own (resting) mouth; keys 100+ mark them apart from normal frames
      const key = 100 + (Math.floor((now - gestureStart) / 280) % poses.length);
      if (key !== shown) showSvg(poses[key - 100], key);
    } else {
      const index = pickFrame(now);
      if (index !== shown || host.firstElementChild === null) show(index);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return {
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

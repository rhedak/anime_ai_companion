// Shows the frames the backend renders from the anime-character-creator package
// and animates between them. Anything exposing the same few methods can replace
// this (e.g. a VRM or Live2D renderer).

const CLOSE_UP = "55 0 290 330";
const FULL_BODY = "0 0 400 500";
const BLINK = 4; // frame index; 0-3 are mouth openings from shut to wide

export function createAvatar(host, requestFrames) {
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

  const parser = new DOMParser();

  function setView() {
    host.classList.toggle("full", full);
    const svg = host.firstElementChild;
    if (svg) svg.setAttribute("viewBox", full ? FULL_BODY : CLOSE_UP);
  }

  function show(index) {
    const frames = cache.get(emotion);
    if (!frames) return;
    const svg = frames[index].cloneNode(true);
    svg.setAttribute("viewBox", full ? FULL_BODY : CLOSE_UP);
    host.replaceChildren(svg);
    shown = index;
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
    const index = pickFrame(now);
    if (index !== shown || host.firstElementChild === null) show(index);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return {
    /** The character changed on the server: drop every cached frame and refetch. */
    setVersion(v) {
      if (v === version) return;
      version = v;
      cache.clear();
      requestFrames(emotion);
    },
    setEmotion(name) {
      if (name === emotion) return;
      emotion = name;
      ensure(name);
      shown = -1; // redraw right away if this emotion's frames are already here
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
        msg.svgs.map((text) => parser.parseFromString(text, "image/svg+xml").documentElement),
      );
      if (msg.emotion === emotion) shown = -1;
    },
  };
}

// A stand-in for the server, living in the page. public/app.js talks to a WebSocket and uses only `send`, `onmessage`, `onclose`,
// `readyState` and `close`; this object has those, and answers the messages the page sends the way src/server.ts would for a chat
// with no tools: it draws her with the renderer, turns a message into a streamed reply, and applies her [avatar …] tags.

import { framesRequest, gestureRequest } from "../public/frames.js";
import { findAvatarTags } from "../public/tags.js";

const OPEN = 1;

/**
 * `renderer` is a promise of `{ call(request) }` (see render-bridge.js), `emotions` is emotions.json, `reply(text)` gives her answer
 * to a message (see script.js). `pause(ms)` paces the streamed words and can be replaced in tests.
 */
export function createLocalSocket({ renderer, emotions, reply, name = "Risa", preset = "risa", pause = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let character = null;
  let version = 1;
  let history = [];
  /** Frames already drawn for the current look, so a repeat request costs nothing. */
  const cache = new Map();
  /** Requests are answered one at a time, in order, like the server's queue. */
  let chain = Promise.resolve();

  const socket = {
    readyState: OPEN,
    onmessage: null,
    onclose: null,
    onopen: null,
    send(data) {
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      chain = chain.then(() => handle(msg)).catch((err) => out({ type: "notice", text: `Something went wrong in the demo: ${err?.message ?? err}` }));
    },
    close() {
      socket.readyState = 3;
    },
    /** Tells the page something in its chat log (loading progress, mostly). */
    notice(text) {
      out({ type: "notice", text });
    },
  };

  // Delivered a moment later, so the page has set its handlers on the object it was just given.
  const out = (msg) => {
    setTimeout(() => socket.onmessage?.({ data: JSON.stringify(msg) }), 0);
  };

  const modeInfo = () => ({
    type: "mode",
    name,
    mode: "chat",
    provider: "ollama",
    canUseTools: false,
    ollamaModels: [],
    ollamaModel: "",
    cursorModels: [],
    opencodeModels: [],
    projectDir: null,
    model: "the demo",
    sessionId: null,
    allowedTools: [],
    permissionMode: "manual",
    claudeSetup: false,
    claudeSkills: false,
    effort: "default",
    effortNow: null,
    shellOff: true,
  });

  async function start() {
    const r = await renderer;
    const base = await r.call({ op: "base", name: preset });
    if (!base.ok) throw new Error(base.error);
    character = base.character;
    const schema = await r.call({ op: "schema" });
    out({ type: "hello", provider: "the demo", version });
    out(modeInfo());
    out({ type: "looks", names: [], presets: schema.ok ? schema.presets : [preset], canUndo: false });
    out({ type: "meter", model: "the demo", effort: null, session: null, week: null, limitsAt: null, ctx: null });
    out({ type: "history", items: history });
    out({ type: "queue", items: [], returned: [] });
  }

  async function draw(request, key, reply) {
    const hit = cache.get(key);
    if (hit) return out(reply(hit));
    const r = await renderer;
    const result = await r.call(request);
    if (!result.ok) return out({ type: "notice", text: `She could not be drawn: ${result.error}` });
    cache.set(key, result.svgs);
    out(reply(result.svgs));
  }

  async function handle(msg) {
    if (msg.type === "frames" && typeof msg.emotion === "string") {
      const request = framesRequest(emotions, character, msg.emotion);
      return draw(request, `${version}:${msg.emotion}`, (svgs) => ({ type: "frames", version, emotion: msg.emotion, svgs }));
    }
    if (msg.type === "gesture-frames" && typeof msg.emotion === "string" && typeof msg.gesture === "string") {
      const request = gestureRequest(emotions, character, msg.emotion, msg.gesture);
      if (!request) return;
      return draw(request, `${version}:${msg.emotion}:${msg.gesture}`, (svgs) => ({ type: "gesture-frames", version, emotion: msg.emotion, gesture: msg.gesture, svgs }));
    }
    if (msg.type === "user" && typeof msg.text === "string" && msg.text.trim()) return answer(msg.text.slice(0, 2000));
    if (msg.type === "reset") {
      history = [];
      out({ type: "reset" });
    }
    // Anything else (rename, looks, permissions, …) is for the real app: the demo does nothing.
  }

  async function answer(text) {
    history.push({ type: "user", text });
    out({ type: "user", text });
    const said = reply(text);
    // Stream it a few words at a time, like a model would.
    for (const piece of said.match(/\S+\s*/g) ?? []) {
      out({ type: "delta", text: piece });
      await pause(35);
    }
    const tags = findAvatarTags(said);
    const applied = [];
    const r = await renderer;
    for (const set of tags) {
      const patched = await r.call({ op: "patch", character, set });
      if (patched.ok && patched.applied.length) {
        character = patched.character;
        applied.push(...patched.applied);
      }
    }
    if (applied.length) {
      version += 1;
      cache.clear();
      out({ type: "avatar", version, applied });
    }
    history.push({ type: "bot", text: said });
    out({ type: "done" });
  }

  chain = chain.then(start).catch((err) => out({ type: "notice", text: `The demo could not start: ${err?.message ?? err}` }));
  return socket;
}

// A stand-in for the server, living in the page. public/app.js talks to a WebSocket and uses only `send`, `onmessage`, `onclose`,
// `readyState` and `close`; this object has those, and answers the messages the page sends the way src/server.ts would for a chat
// with no tools: it draws her with the renderer, turns a message into a streamed reply, applies her [avatar …] tags, and keeps the
// page's look buttons (undo, presets, reset) working. One scripted scene plays out a pretend work-mode session with a real approval card.

import { framesRequest, gestureRequest } from "../public/frames.js";
import { findAvatarTags } from "../public/tags.js";

const OPEN = 1;

/**
 * `renderer` is a promise of `{ call(request) }` (see render-bridge.js); `emotions` is emotions.json (or a promise of it);
 * `reply(text, { presets })` is her answer to a message, `{ text, scene? }` (see script.js); `greeting` is what she says first.
 * `pause(ms)` paces the streamed words and the scene, and can be replaced in tests.
 */
export function createLocalSocket({
  renderer,
  emotions,
  reply,
  greeting = "",
  name = "Risa",
  preset = "risa",
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  let character = null;
  let version = 1;
  let history = [];
  /** Earlier looks, newest last, so the page's Undo works; the server keeps twenty. */
  const looks = [];
  /** Frames already drawn for the current look, so a repeat request costs nothing. */
  const cache = new Map();
  let presets = [preset];
  let thumbnails = null;
  /** The approval card waiting for an answer, if the pretend work session is showing one. */
  let waiting = null;
  /** The opening messages are out and the character is loaded: drawing can start. */
  const ready = Promise.resolve().then(() => start());
  /** The conversation is answered one request at a time, in order, like the server's queue; it starts with her greeting. */
  let chain = ready.then(() => greet()).catch((err) => out({ type: "notice", text: `The demo could not start: ${err?.message ?? err}` }));

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
      // An answer to the approval card must not wait behind the turn that is waiting for it.
      if (msg.type === "permission-reply") return void answerCard(msg.id, msg.decision);
      if (msg.type === "stop") return void (waiting && answerCard(waiting.id, "deny"));
      // Drawing does not wait for the conversation (the face must keep changing while an approval card is open), only for the load.
      if (msg.type === "frames" || msg.type === "gesture-frames" || msg.type === "preset-thumbs") {
        ready.then(() => drawing(msg)).catch(() => {}); // a failed load has already been reported
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
  const looksInfo = () => ({ type: "looks", names: [], presets, canUndo: looks.length > 0 });

  /** The opening messages a page gets, then her greeting. */
  async function start() {
    const r = await renderer;
    const base = await r.call({ op: "base", name: preset });
    if (!base.ok) throw new Error(base.error);
    character = base.character;
    const schema = await r.call({ op: "schema" });
    if (schema.ok) presets = [preset, ...schema.presets.filter((p) => p !== preset)];
    out({ type: "hello", provider: "the demo", version });
    out(modeInfo());
    out(looksInfo());
    out({ type: "meter", model: "the demo", effort: null, session: null, week: null, limitsAt: null, ctx: null });
    out({ type: "history", items: history });
    out({ type: "queue", items: [], returned: [] });
  }

  /** She says something unprompted (the greeting), like a reply with no question before it. */
  async function greet() {
    if (!greeting) return;
    await speak(greeting);
  }

  /** The look changes: remember the old one for Undo, and tell the page so it asks for new frames. */
  function adopt(next, applied) {
    looks.push(character);
    if (looks.length > 20) looks.shift();
    character = next;
    version += 1;
    cache.clear();
    out({ type: "avatar", version, applied });
    out(looksInfo());
  }

  async function draw(request, key, answer) {
    const hit = cache.get(key);
    if (hit) return out(answer(hit));
    const r = await renderer;
    const result = await r.call(request);
    if (!result.ok) return out({ type: "notice", text: `She could not be drawn: ${result.error}` });
    cache.set(key, result.svgs);
    out(answer(result.svgs));
  }

  async function thumbs() {
    thumbnails ??= (async () => {
      const r = await renderer;
      const svgs = {};
      for (const name of presets) {
        const base = await r.call({ op: "base", name });
        if (!base.ok) continue;
        const frames = await r.call({ op: "frames", character: base.character, face: {}, mouth: [0] });
        if (frames.ok) svgs[name] = frames.svgs[0];
      }
      return svgs;
    })().catch((err) => {
      thumbnails = null; // try again next time
      throw err;
    });
    return thumbnails;
  }

  /** The requests that draw her: frames for an emotion, frames for a gesture, the gallery's thumbnails. */
  async function drawing(msg) {
    const feel = await emotions;
    if (msg.type === "frames" && typeof msg.emotion === "string") {
      const request = framesRequest(feel, character, msg.emotion);
      return draw(request, `${version}:${msg.emotion}`, (svgs) => ({ type: "frames", version, emotion: msg.emotion, svgs }));
    }
    if (msg.type === "gesture-frames" && typeof msg.emotion === "string" && typeof msg.gesture === "string") {
      const request = gestureRequest(feel, character, msg.emotion, msg.gesture);
      if (!request) return;
      return draw(request, `${version}:${msg.emotion}:${msg.gesture}`, (svgs) => ({ type: "gesture-frames", version, emotion: msg.emotion, gesture: msg.gesture, svgs }));
    }
    if (msg.type === "preset-thumbs") return out({ type: "preset-thumbs", svgs: await thumbs() });
  }

  /** The rest of what the page sends. */
  async function handle(msg) {
    if (msg.type === "user" && typeof msg.text === "string" && msg.text.trim()) return answer(msg.text.slice(0, 2000));
    if (msg.type === "reset") return newChat();
    if (msg.type === "look-undo") {
      if (looks.length) {
        character = looks.pop();
        version += 1;
        cache.clear();
        out({ type: "avatar", version, applied: ["undid the last change"] });
      }
      return out(looksInfo());
    }
    if (msg.type === "look-preset" && typeof msg.name === "string" && presets.includes(msg.name)) {
      const base = await (await renderer).call({ op: "base", name: msg.name });
      if (base.ok) adopt(base.character, [`base=${msg.name}`]);
      return;
    }
    if (msg.type === "reset-look") {
      const base = await (await renderer).call({ op: "base", name: preset });
      if (base.ok) {
        adopt(base.character, ["back to the original look"]);
        await newChat();
      }
      return;
    }
    // Anything else (rename, saved looks, brains, permissions, …) is for the real app: the demo does nothing.
  }

  /** A fresh conversation: an empty log, and her greeting again. */
  async function newChat() {
    history = [];
    out({ type: "reset" });
    out(modeInfo());
    await greet();
  }

  /** Streams `text` to the page a few words at a time, like a model would, and returns it. */
  async function stream(text) {
    for (const piece of text.match(/\S+\s*/g) ?? []) {
      out({ type: "delta", text: piece });
      await pause(35);
    }
    return text;
  }

  /** Applies the [avatar …] tags of a finished reply as one change, the way the server does. */
  async function applyTags(text) {
    const r = await renderer;
    const applied = [];
    let next = character;
    for (const set of findAvatarTags(text)) {
      const patched = await r.call({ op: "patch", character: next, set });
      if (patched.ok && patched.applied.length) {
        next = patched.character;
        applied.push(...patched.applied);
      }
    }
    if (applied.length) adopt(next, applied);
  }

  /** A whole reply: streamed, its tags applied, kept in the log, and the turn ended. */
  async function speak(text) {
    await stream(text);
    await applyTags(text);
    history.push({ type: "bot", text });
    out({ type: "done" });
  }

  async function answer(text) {
    history.push({ type: "user", text });
    out({ type: "user", text });
    const answered = reply(text, { presets });
    if (answered.scene === "work") return workScene();
    await speak(answered.text);
  }

  // --- the pretend work-mode session ---

  const tool = (id, toolName, summary, status) => ({ type: "tool", id, name: toolName, summary, status });

  /** Shows an approval card and waits for the page's answer. */
  function askCard(request) {
    return new Promise((resolve) => {
      waiting = { id: request.id, resolve };
      out({ type: "permission", request });
    });
  }

  function answerCard(id, decision) {
    if (!waiting || waiting.id !== id) return;
    const card = waiting;
    waiting = null;
    out({ type: "permission-resolved", id, decision });
    card.resolve(decision);
  }

  /**
   * What work mode looks like, with nothing real behind it: she reads a page, wants one small edit, and asks first with the same
   * card the real app shows. Allow or Deny both lead somewhere. The card says it is a pretend one.
   */
  async function workScene() {
    let said = await stream(
      "[emotion:happy] Here's a pretend work-mode session: nothing in this demo touches a real file. In the real app I work in your project " +
        "folder with your own coding agent, and I ask before anything changes. First I'll look at a page.",
    );
    out(tool("demo-read", "Read", "index.html", "running"));
    await pause(600);
    out(tool("demo-read", "Read", "index.html", "done"));
    said += await stream(" [emotion:thinking] The heading is plain. Let's make it pink: one small edit.");
    out(tool("demo-edit", "Edit", "index.html", "running"));
    const decision = await askCard({
      id: "demo-edit",
      tool: "Edit",
      summary: "index.html",
      input: {
        file_path: "index.html",
        old_string: "<h1>My little page</h1>",
        new_string: '<h1 style="color:#ff69b4">My little page</h1>',
      },
      description: "A pretend card: this demo changes nothing. In the real app this is the exact edit you approve.",
    });
    if (decision === "deny") {
      out(tool("demo-edit", "Edit", "index.html", "error"));
      said += await stream(" [emotion:shy] Okay, I'll leave it alone. A denial is never retried: I'd ask what you'd rather do instead.");
    } else {
      out(tool("demo-edit", "Edit", "index.html", "done"));
      said += await stream(" [emotion:happy] Done: the heading is pink now. (Pretend, of course.) In the real app a phone on your network can answer these cards too.");
    }
    history.push({ type: "bot", text: said });
    out({ type: "done" });
  }

  return socket;
}

// A stand-in for the server, living in the page. public/app.js talks to a WebSocket and uses only `send`, `onmessage`, `onclose`,
// `readyState` and `close`; this object has those, and answers the messages the page sends the way src/server.ts would for a chat
// with no tools: it draws her with the renderer, turns a message into a streamed reply, applies her [avatar …] tags, and keeps the
// page's look buttons (undo, presets, reset) working. One scripted scene plays out a pretend work-mode session with a real approval card.

import { drawnDemoMessage, packDemoMessage } from "../public/demo.js";
import { GESTURES, framesRequest, gestureRequest, gestureView } from "../public/frames.js";
import { findAvatarTags } from "../public/tags.js";
import { buildMessages, emotionFix } from "./model-prompt.js";
import { packInfoFrom } from "./remote-packs.js";
import { DRAWN_AGAIN, packIntroFor, personaFor } from "../public/script.js";

const OPEN = 1;

/**
 * `renderer` is a promise of `{ call(request) }` (see render-bridge.js); `emotions` is emotions.json (or a promise of it);
 * `reply(text, { presets })` is her answer to a message, `{ text, scene? }` (see script.js); `greeting` is what she says first.
 * `pause(ms)` paces the streamed words and the scene, and can be replaced in tests. `packs` is the picture packs she can be switched to, by
 * name, each as the page's PackInfo (or a promise of them); `onPack(name | null)` is told when one is chosen or left. `model` is the small
 * in-browser language model, if the visitor has switched it on (`ready()`, `chat(messages, onPiece)`, `stop()`; see model.js): it answers what
 * the script cannot, and nothing else.
 */
export function createLocalSocket({
  renderer,
  emotions,
  reply,
  greeting = "",
  name = "Risa",
  preset = "risa",
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
  packs = {},
  characters = {},
  remote = {},
  fetchJson = (/** @type {string} */ url) => fetch(url, { signal: AbortSignal.timeout(15000) }).then((res) => (res.ok ? res.json() : Promise.reject(new Error(`the server answered ${res.status}`)))),
  preload = (/** @type {string} */ _url) => Promise.resolve(),
  want = "",
  agreed = /** @type {string[]} */ ([]),
  onAgree = (/** @type {string} */ _id) => {},
  onPack = (/** @type {string | null} */ _name) => {},
  model = null,
  restore = null,
  onSave = (/** @type {{ character: any, pack: string | null, base: string | null } | null} */ _saved) => {},
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
  /** The picture packs on offer, and the one she is showing as just now (null: the drawn avatar). */
  let packList = {};
  let pack = null;
  /** Who each pack's character is ({ pack: { id, name, default? } }), for the gallery's grouping, and the packs that can be fetched from the packs site. */
  let characterList = {};
  let remoteList = {};
  /** The visitor chose "Allow for this session" on the pretend Edit card: it is not asked again until a new conversation. */
  let editAllowed = false;
  /** The built-in character her look started from (a tweak keeps it), for the gallery to mark; null when it is not known. */
  let basePreset = preset;
  /** The base she had at each earlier look, in step with `looks`, so Undo goes back to it too. */
  const bases = [];
  /** Turns running or waiting in the chain, and the user's messages that are waiting behind a running one (listed above the box). */
  let working = 1;
  const queued = [];
  let nextQueueId = 1;
  const queueMessage = (returned = []) => ({ type: "queue", items: queued.map(({ id, text }) => ({ id, text })), returned });
  /** The stop button was pressed: the reply being streamed ends where it is. */
  let aborted = false;
  /** The approval card waiting for an answer, if the pretend work session is showing one. */
  let waiting = null;
  /** The opening messages are out and the character is loaded: drawing can start. */
  const ready = Promise.resolve().then(() => start());
  /** Why the demo could not start (its drawing code did not load, say), or null. Nothing she says is any use without her, so every message gets this. */
  let failure = null;
  const startFailure = (err) =>
    "Could not load the drawing code, so she cannot be drawn or answer yet. It is a few JavaScript files that come from the same place as this page: " +
    "an interrupted connection, a content blocker or a browser too old for modern JavaScript stops that. Reload the page to try again, or read about the real thing at " +
    `https://rhedak.github.io/anime_ai_companion/ . (Details: ${err?.message ?? err})`;
  ready.catch((err) => void (failure = startFailure(err)));
  /** The conversation is answered one request at a time, in order, like the server's queue; it starts with her greeting. */
  let chain = ready
    .then(() => greet())
    .catch(() => out({ type: "notice", text: failure ?? "The demo could not start." }))
    .finally(() => void (working -= 1)); // the greeting is the first turn: a message sent during it waits, and is shown as waiting

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
      if (msg.type === "stop") {
        aborted = true;
        if (queued.length) out(queueMessage(queued.splice(0).map((q) => q.text))); // the waiting words go back to the box
        model?.stop();
        return void (waiting && answerCard(waiting.id, "deny"));
      }
      // Drawing does not wait for the conversation (the face must keep changing while an approval card is open), only for the load.
      if (msg.type === "frames" || msg.type === "gesture-frames" || msg.type === "preset-thumbs") {
        ready.then(() => drawing(msg)).catch(() => {}); // a failed load has already been reported
        return;
      }
      if (msg.type === "unqueue") {
        const at = queued.findIndex((q) => q.id === msg.id);
        if (at >= 0) queued.splice(at, 1);
        return void out(queueMessage());
      }
      // A message that arrives while a turn is running waits its turn, and is listed above the box meanwhile.
      const entry = msg.type === "user" && typeof msg.text === "string" && msg.text.trim() && working > 0 ? { id: `q${nextQueueId++}`, text: msg.text.trim() } : null;
      if (entry) {
        queued.push(entry);
        out(queueMessage());
      }
      working += 1;
      chain = chain
        .then(async () => {
          if (entry) {
            const at = queued.indexOf(entry);
            if (at < 0) return; // taken out, or given back by Stop
            queued.splice(at, 1);
            out(queueMessage());
          }
          await handle(msg);
        })
        .catch((err) => out({ type: "notice", text: `Something went wrong in the demo: ${err?.message ?? err}` }))
        .finally(() => void (working -= 1));
    },
    close() {
      socket.readyState = 3;
    },
    /** She says something unprompted, in her turn (the model is ready, the model is off). Tags in it work as in any reply. */
    announce(text) {
      chain = chain.then(() => speak(text)).catch(() => {});
    },
    /** Settles when the drawing code is loaded (or has failed to): until then the page holds its buttons. */
    ready: ready.then(
      () => undefined,
      () => undefined,
    ),
    /** Shows `text` as the visitor's own message, for a button that sends a command, which the server never echoes. */
    echo(text) {
      history.push({ type: "user", text });
      echoOpen = true;
      out({ type: "user", text });
    },
    /** Tells the page something in its chat log (loading progress, mostly). */
    notice(text) {
      out({ type: "notice", text });
    },
  };

  // Delivered a moment later, so the page has set its handlers on the object it was just given.
  const out = (msg) => {
    if (msg.type === "done" || msg.type === "reset") echoOpen = false; // the page's turn is over
    setTimeout(() => socket.onmessage?.({ data: JSON.stringify(msg) }), 0);
  };

  /**
   * The page takes any `user` message as the start of a turn and waits for `done` (until then it is busy and refuses the showcase). An idea
   * button for a command is echoed that way, but a command is answered without a turn, so this ends the one the echo opened. A command typed
   * by hand opened nothing and gets nothing extra, as on the server.
   */
  let echoOpen = false;
  const endEchoTurn = () => {
    if (echoOpen) out({ type: "done" });
  };

  /** Her name: the character's while a pack of a character is on (the demo has no rename), else the demo's own. */
  const herName = () => (pack ? (characterList[pack]?.name ?? name) : name);
  const modeInfo = () => ({
    type: "mode",
    name: herName(),
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
    claudeChrome: false,
    effort: "default",
    effortNow: null,
    shellOff: true,
  });
  const packMessage = () => ({ type: "pack", pack: pack ? packList[pack] : null });
  const packsMessage = () => ({
    type: "packs",
    names: Object.keys(packList),
    characters: characterList,
    active: pack,
    remote: Object.values(remoteList).filter((entry) => !Object.hasOwn(packList, entry.id)),
    // The preview of every pack the packs site lists, fetched or not: the gallery needs it for a pack once it is fetched too (the demo has no folder of previews for them).
    thumbs: Object.fromEntries(Object.values(remoteList).filter((entry) => entry.thumb).map((entry) => [entry.id, entry.thumb])),
  });
  const looksInfo = () => ({ type: "looks", names: [], presets, canUndo: looks.length > 0, current: basePreset });

  /** The opening messages a page gets, then her greeting. */
  async function start() {
    const r = await renderer;
    const base = await r.call({ op: "base", name: preset });
    if (!base.ok) throw new Error(base.error);
    character = base.character;
    // The look and the pack from the visitor's last visit, if the drawing code still accepts that look.
    if (restore?.character && typeof restore.character === "object") {
      const trial = await r.call({ op: "frames", character: restore.character, mouth: [0], face: {} }).catch(() => ({ ok: false }));
      if (trial.ok) {
        character = restore.character;
        basePreset = typeof restore.base === "string" ? restore.base : null;
      }
    }
    const schema = await r.call({ op: "schema" });
    if (schema.ok) presets = [preset, ...schema.presets.filter((p) => p !== preset)];
    out({ type: "hello", provider: "the demo", version });
    out(modeInfo());
    out(looksInfo());
    packList = await packs;
    characterList = await characters;
    remoteList = await remote;
    // A pack fetched on an earlier visit is fetched again (quietly: the visitor asked for it then).
    // (A link that names a pack or a character wins, so the last visit's pack is neither fetched nor shown first.)
    const last = want ? null : restore?.pack;
    if (last && !Object.hasOwn(packList, last) && Object.hasOwn(remoteList, last)) await fetchPack(last).catch(() => {});
    if (last && Object.hasOwn(packList, last)) {
      pack = last;
      onPack(pack);
    }
    out(packMessage());
    out(packsMessage());
    if (want) await applyWanted();
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
    bases.push(basePreset);
    if (looks.length > 20) {
      looks.shift();
      bases.shift();
    }
    const based = applied.find((a) => a.startsWith("base="));
    if (based) basePreset = based.slice("base=".length);
    character = next;
    version += 1;
    cache.clear();
    out({ type: "avatar", version, applied });
    out(looksInfo());
    save();
  }

  /** What the page keeps for the visitor's next visit: her look, and the pack she shows if any. */
  function save() {
    onSave({ character, pack, base: basePreset });
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
      return draw(request, `${version}:${msg.emotion}:${msg.gesture}`, (svgs) => ({ type: "gesture-frames", version, emotion: msg.emotion, gesture: msg.gesture, svgs, ...(gestureView(character, msg.gesture) ? { view: gestureView(character, msg.gesture) } : {}) }));
    }
    if (msg.type === "preset-thumbs") return out({ type: "preset-thumbs", svgs: await thumbs() });
  }

  /** The rest of what the page sends. */
  async function handle(msg) {
    if (msg.type === "user" && typeof msg.text === "string" && msg.text.trim()) {
      if (!msg.text.trimStart().startsWith("/")) return answer(msg.text.slice(0, 2000));
      await command(msg.text.trim());
      return endEchoTurn();
    }
    if (msg.type === "reset") return newChat();
    if (msg.type === "look-undo") {
      if (pack && looks.length) await choosePack(null, true); // a drawn look was picked: show it, as the app does
      if (looks.length) {
        character = looks.pop();
        basePreset = bases.pop() ?? null;
        version += 1;
        cache.clear();
        out({ type: "avatar", version, applied: ["undid the last change"] });
        save();
      }
      return out(looksInfo());
    }
    if (msg.type === "pack-select" && (msg.name === null || typeof msg.name === "string")) return choosePack(msg.name);
    if (msg.type === "pack-install" && typeof msg.name === "string") return installPack(msg.name);
    if (msg.type === "look-preset" && typeof msg.name === "string" && presets.includes(msg.name)) {
      const base = await (await renderer).call({ op: "base", name: msg.name });
      if (base.ok) {
        if (pack) await choosePack(null, true);
        adopt(base.character, [`base=${msg.name}`]);
      }
      return;
    }
    if (msg.type === "reset-look") {
      const base = await (await renderer).call({ op: "base", name: preset });
      if (base.ok) {
        if (pack) await choosePack(null, true);
        adopt(base.character, ["back to the original look"]);
        basePreset = preset;
        onSave(null); // nothing to come back to: the next visit starts from the default
      }
      return;
    }
    // Anything else (rename, saved looks, brains, permissions, …) is for the real app: the demo does nothing.
  }

  /**
   * The few slash commands the demo has, answered like the server does: no message of the user's in the log, and no model asked.
   * Anything else belongs to the real app, and the demo says so.
   */
  async function command(text) {
    const name = /^\/(\w*)/.exec(text)?.[1].toLowerCase() ?? "";
    if (name === "show") {
      const steps = await showMessage();
      endEchoTurn(); // the page refuses the showcase while a turn is open
      return out(steps);
    }
    if (name === "frames") return framesCommand(text.slice(1 + name.length).trim());
    if (name === "clear" || name === "new") return newChat();
    if (name === "help") {
      return out({
        type: "notice",
        text:
          "/show: she shows all her emotions, a blink, talking and her gestures, one at a time, naming each\n" +
          "/frames <name>: she is a set of pictures instead of the drawn avatar; /frames off goes back; /frames lists them\n" +
          "/clear (or /new): a fresh conversation\n" +
          "/help: this list\n" +
          "The real app has many more commands (the documentation lists them).",
      });
    }
    out({ type: "notice", text: `/${name} is a command of the real app. This demo knows /show, /frames, /clear and /help.` });
  }

  /** The id of the character whose pack she is showing, whose voice she speaks in ("" for the drawn avatar or a pack of nobody in particular). */
  const characterId = () => (pack ? (characterList[pack]?.id ?? packList[pack]?.character ?? "") : "");

  /** The show-off sequence for what she is just now: the drawn avatar, or the picture pack's own pictures. */
  async function showMessage() {
    const names = Object.keys(await emotions);
    return pack ? packDemoMessage(names, Object.keys(GESTURES), packList[pack]) : drawnDemoMessage(names, Object.keys(GESTURES));
  }

  /** She becomes a set of pictures (by name), or the drawn avatar again (null), and says what that means unless `quiet`. */
  async function choosePack(name, quiet = false) {
    if (name === null) {
      if (!pack) return out({ type: "notice", text: "Already showing the drawn avatar." });
      pack = null;
    } else {
      if (!Object.hasOwn(packList, name)) return out({ type: "notice", text: `There is no pack called "${name}" in this demo (it has: ${Object.keys(packList).join(", ") || "none"}).` });
      if (pack === name) return out({ type: "notice", text: `Already showing the pack "${name}".` });
      pack = name;
    }
    out(modeInfo()); // her name may be the character's now
    out(packMessage());
    out(packsMessage());
    onPack(pack);
    save();
    if (!quiet) await speak(pack ? packIntroFor(characterId()) : DRAWN_AGAIN);
  }

  /** Reads a pack's `pack.json` from the packs site and keeps it in the list (nothing is shown yet). Throws what went wrong, in words. */
  async function fetchPack(id) {
    const entry = remoteList[id];
    if (!entry) throw new Error(`There is no pack called "${id}".`);
    let json;
    try {
      json = await fetchJson(`${entry.base}pack.json`);
    } catch (err) {
      throw new Error(`${entry.name} is not available in the demo yet (${err?.message ?? err}). The full app has it.`);
    }
    const info = packInfoFrom(json, entry.base);
    if (!info) throw new Error(`The description of ${entry.name} on the server does not look right, so it was not used.`);
    await preload(info.emotions.neutral.idle).catch(() => {});
    packList[id] = info;
    if (entry.character && !characterList[id]) characterList[id] = entry.character;
  }

  /** The visitor said yes to this pack, now or on an earlier visit (kept in the browser by the page): a link to it does not ask again. */
  const agree = (id) => {
    if (!agreed.includes(id)) agreed = [...agreed, id];
    onAgree(id);
  };

  /**
   * The link asked for a pack or a character (`?pack=…`): one that is here is shown at once, one that is only on the packs site is asked about first
   * (the same question as a click on its tile: size and host, nothing fetched until the visitor says yes). Anything else is ignored.
   */
  async function applyWanted() {
    const id = Object.keys(packList).find((n) => n.toLowerCase() === want) ?? Object.keys(remoteList).find((n) => n.toLowerCase() === want);
    const ofCharacter = (list) => Object.keys(list).filter((n) => (list === packList ? characterList[n]?.id : list[n].character?.id) === want);
    // A character: the outfit its file names as the default if that is here, else any outfit that is here, else the first one to fetch.
    const here = ofCharacter(packList);
    const chosen = id ?? (here.find((n) => characterList[n]?.default === n) ?? here[0] ?? ofCharacter(remoteList)[0]);
    if (!chosen || chosen === pack) return;
    if (Object.hasOwn(packList, chosen)) return choosePack(chosen);
    // A pack the visitor already said yes to (the one she showed last time, or one they agreed to on an earlier visit) is fetched again without asking, as the plain page does.
    if (restore?.pack === chosen || agreed.includes(chosen)) {
      try {
        await fetchPack(chosen);
        return choosePack(chosen);
      } catch {} // gone from the server: ask as for any other pack
    }
    const entry = remoteList[chosen];
    out({ type: "pack-offer", id: chosen, name: entry.name, bytes: entry.sizes.archiveBytes, host: entry.host, saved: entry.saved });
  }

  /** The visitor said yes to the question the page asked: fetch the pack, then show it, as the app does after an install. */
  async function installPack(id) {
    try {
      out({ type: "pack-progress", id, phase: "download" });
      await fetchPack(id);
    } catch (err) {
      return void out({ type: "pack-progress", id, phase: "error", message: err?.message ?? String(err) });
    }
    agree(id);
    out({ type: "pack-progress", id, phase: "done" });
    await choosePack(id);
  }

  /** `/frames`: the packs there are, `/frames off` for the drawn avatar, `/frames <name>` for a pack. */
  async function framesCommand(arg) {
    if (!arg) {
      const names = Object.keys(packList);
      return out({
        type: "notice",
        text: names.length
          ? `Picture packs in this demo: ${names.join(", ")}${Object.keys(remoteList).length ? ` (more to fetch in Looks → Packs…, or /frames <name>: ${Object.keys(remoteList).filter((id) => !names.includes(id)).join(", ")})` : ""}. Showing ${pack ? `the pack "${pack}"` : "the drawn avatar"}. /frames <name> shows one, /frames off goes back to the drawn avatar.`
          : "This demo has no picture packs.",
      });
    }
    const wanted = Object.keys(remoteList).find((id) => id.toLowerCase() === arg.toLowerCase());
    if (wanted && !Object.hasOwn(packList, wanted)) {
      // Like the app: a pack that is not here is asked about first (its size and which server), never fetched by the command alone.
      const entry = remoteList[wanted];
      return out({ type: "pack-offer", id: wanted, name: entry.name, bytes: entry.sizes.archiveBytes, host: entry.host, saved: entry.saved });
    }
    return choosePack(arg.toLowerCase() === "off" ? null : arg);
  }

  /** A fresh conversation: an empty log, and her greeting again. */
  async function newChat() {
    history = [];
    editAllowed = false;
    out({ type: "reset" });
    out(modeInfo());
    if (failure) return void out({ type: "notice", text: failure });
    await greet();
  }

  /** Streams `text` to the page a few words at a time, like a model would, and returns it. */
  async function stream(text) {
    let said = "";
    for (const piece of text.match(/\S+\s*/g) ?? []) {
      if (aborted) break;
      out({ type: "delta", text: piece });
      said += piece;
      await pause(35);
    }
    return said;
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
  async function speak(whole) {
    aborted = false;
    const text = await stream(whole);
    if (aborted) {
      // Stopped: what was said stays, nothing more happens, and the turn is over now.
      aborted = false;
      if (text) history.push({ type: "bot", text });
      return void out({ type: "done" });
    }
    await applyTags(text);
    history.push({ type: "bot", text });
    out({ type: "done" });
    // Asked to show off, a model ends with [demo] and the server then lists the steps; so does she.
    if (/\[demo\]/.test(text)) out(await showMessage());
  }

  async function answer(text) {
    history.push({ type: "user", text });
    out({ type: "user", text });
    if (failure) {
      // Say why, once per message, and end her turn: the page waits for it.
      out({ type: "notice", text: failure });
      return void out({ type: "done" });
    }
    // The last few lines, without tags, so "that colour" can mean one she or the visitor just named.
    const recent = history.slice(-7, -1).map((h) => String(h.text).replace(/\[[^\]\n]*\]/g, " "));
    const answered = reply(text, { presets, pack: pack !== null, character: characterId(), model: Boolean(model?.ready()), recent });
    if (answered.scene === "work") return workScene();
    if (answered.needsModel && model?.ready()) return modelReply();
    await speak(answered.text);
  }

  /**
   * The small model answers: streamed as it writes. Only her emotion and gesture tags count; a look-changing tag it might write is shown to
   * nobody and applied to nothing, because she can only change her look through the script's reader.
   */
  async function modelReply() {
    const names = Object.keys(await emotions);
    let said = "";
    try {
      said = await model.chat(buildMessages(history, names, herName(), 8, model.kind?.() ?? "browser", pack ? personaFor(characterId()) : ""), (piece) => out({ type: "delta", text: piece }));
    } catch (err) {
      out({ type: "notice", text: `The small model stopped: ${err?.message ?? err}` });
    }
    const fix = said ? emotionFix(said, names) : "";
    if (fix) out({ type: "delta", text: fix });
    history.push({ type: "bot", text: said + fix });
    out({ type: "done" });
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
    if (editAllowed) {
      out(tool("demo-edit", "Edit", "index.html", "done"));
      said += await stream(" [emotion:happy] You've already allowed Edit for this session, so I don't ask again: the heading is pink. (Pretend, of course.)");
      history.push({ type: "bot", text: said });
      return void out({ type: "done" });
    }
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
    if (decision === "allow-session") editAllowed = true;
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

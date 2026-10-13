import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { GESTURES, framesRequest, gestureRequest } from "../public/frames.js";
import { findAvatarTags } from "../public/tags.js";
import { createLocalSocket, type Renderer } from "../demo/local-socket.js";
import { reply } from "../demo/script.js";
import { stage } from "../demo/stage.mjs";
import { findAvatarTags as serverFindAvatarTags } from "../src/avatar-tags.ts";

const repo = resolve(fileURLToPath(import.meta.url), "../..");
const emotions = JSON.parse(readFileSync(join(repo, "emotions.json"), "utf8"));

/** A renderer that answers like python/render_ops.py would, without Python, and remembers what it was asked. */
function fakeRenderer() {
  const calls: Record<string, any>[] = [];
  const renderer: Renderer = {
    async call(request) {
      calls.push(request);
      if (request.op === "base") return { ok: true, character: { hair_color: "#800000", face: { mouth_open: 0 } } };
      if (request.op === "schema") return { ok: true, presets: ["risa", "linnea"] };
      if (request.op === "frames") return { ok: true, svgs: request.poses ? request.poses.map((_: unknown, i: number) => `<svg pose=${i}/>`) : [...request.mouth, "blink"].map((_: unknown, i: number) => `<svg frame=${i}/>`) };
      if (request.op === "patch") return { ok: true, character: { ...request.character, ...request.set }, applied: Object.entries(request.set).map(([k, v]) => `${k}=${v}`), rejected: [] };
      return { ok: false, error: "unknown op" };
    },
  };
  return { renderer, calls };
}

/** A socket with the page's side of it: what the page receives, in order. */
function connect(options: { renderer?: Promise<Renderer>; reply?: (text: string) => string } = {}) {
  const fake = fakeRenderer();
  const socket = createLocalSocket({ renderer: options.renderer ?? Promise.resolve(fake.renderer), emotions, reply: options.reply ?? reply, pause: async () => {} });
  const events: any[] = [];
  socket.onmessage = (e) => events.push(JSON.parse(e.data));
  const next = async (match: (e: any) => boolean, from = 0, ms = 3000) => {
    const started = Date.now();
    for (;;) {
      const found = events.slice(from).find(match);
      if (found) return found;
      if (Date.now() - started > ms) throw new Error(`timed out; saw: ${events.slice(from).map((e) => e.type).join(", ")}`);
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  const send = (msg: object) => socket.send(JSON.stringify(msg));
  return { socket, events, next, send, calls: fake.calls };
}

test("the stand-in opens like the server does: hello first, then what the page needs to show a chat", async () => {
  const { events, next } = connect();
  await next((e) => e.type === "queue");
  assert.deepEqual(events.map((e) => e.type), ["hello", "mode", "looks", "meter", "history", "queue"]);
  assert.equal(events[0].version, 1);
  assert.equal(events[1].mode, "chat");
  assert.equal(events[1].canUseTools, false, "no work mode in the demo");
  assert.deepEqual(events[2].presets, ["risa", "linnea"]);
  assert.deepEqual(events[4].items, []);
});

test("the page's request for frames is answered with the same request the server would make, and a repeat costs nothing", async () => {
  const { events, next, send, calls } = connect();
  await next((e) => e.type === "queue");
  send({ type: "frames", emotion: "happy" });
  const frames = await next((e) => e.type === "frames");
  assert.equal(frames.emotion, "happy");
  assert.equal(frames.version, 1);
  assert.equal(frames.svgs.length, 5, "four mouth openings and a blink");
  const asked = calls.filter((c) => c.op === "frames");
  assert.deepEqual(asked[0], framesRequest(emotions, { hair_color: "#800000", face: { mouth_open: 0 } }, "happy"));

  const before = calls.length;
  send({ type: "frames", emotion: "happy" });
  await next((e) => e.type === "frames", events.indexOf(frames) + 1);
  assert.equal(calls.length, before, "served from the cache");
});

test("an emotion she does not know is drawn neutral, under the name the page asked for", async () => {
  const { next, send, calls } = connect();
  await next((e) => e.type === "queue");
  send({ type: "frames", emotion: "flabbergasted" });
  const frames = await next((e) => e.type === "frames");
  assert.equal(frames.emotion, "flabbergasted");
  assert.deepEqual(calls.at(-1)!.face, emotions.neutral);
});

test("a gesture comes back as its two poses; an unknown one is not answered", async () => {
  const { events, next, send } = connect();
  await next((e) => e.type === "queue");
  send({ type: "gesture-frames", emotion: "happy", gesture: "wave" });
  const wave = await next((e) => e.type === "gesture-frames");
  assert.equal(wave.gesture, "wave");
  assert.equal(wave.svgs.length, 2);
  send({ type: "gesture-frames", emotion: "happy", gesture: "backflip" });
  send({ type: "frames", emotion: "sad" }); // a later request that is answered, so the first had its turn
  await next((e) => e.type === "frames" && e.emotion === "sad");
  assert.ok(!events.some((e) => e.gesture === "backflip"));
});

test("a message is shown, answered in pieces, applied to her look, and the page is told the look changed", async () => {
  const { events, next, send, calls } = connect();
  await next((e) => e.type === "queue");
  const from = events.length;
  send({ type: "user", text: "make my hair mint green" });
  await next((e) => e.type === "done", from);
  const mine = events.slice(from);
  assert.equal(mine[0].type, "user");
  assert.equal(mine[0].text, "make my hair mint green");
  assert.equal(mine.filter((e) => e.type === "delta").map((e) => e.text).join(""), reply("make my hair mint green"));
  const avatar = mine.find((e) => e.type === "avatar");
  assert.deepEqual(avatar.applied, ["hair_color=#8fe3b4"]);
  assert.equal(avatar.version, 2);
  assert.equal(mine.at(-1).type, "done");
  assert.ok(mine.indexOf(avatar) < mine.length - 1, "the look changes before the reply is finished");

  // The next frames are drawn for the new look, not taken from before.
  send({ type: "frames", emotion: "neutral" });
  const frames = await next((e) => e.type === "frames", from);
  assert.equal(frames.version, 2);
  assert.equal(calls.filter((c) => c.op === "frames").at(-1)!.character.hair_color, "#8fe3b4");
});

test("a reply with nothing to redraw leaves her look and the version alone", async () => {
  const { events, next, send } = connect();
  await next((e) => e.type === "queue");
  const from = events.length;
  send({ type: "user", text: "tell me a story" });
  await next((e) => e.type === "done", from);
  assert.ok(!events.slice(from).some((e) => e.type === "avatar"));
});

test("a new chat empties the history; odd input is ignored without a sound", async () => {
  const { events, next, send, socket } = connect();
  await next((e) => e.type === "queue");
  socket.send("not json");
  send({ type: "user", text: "   " });
  send({ type: "rename", name: "Hana" });
  send({ type: "provider", provider: "claude" });
  send({ type: "reset" });
  const reset = await next((e) => e.type === "reset");
  assert.ok(reset);
  assert.ok(!events.some((e) => e.type === "user" || e.type === "notice"), "nothing was said for input the demo does not handle");
});

test("when the renderer cannot load, the page is told instead of waiting for ever", async () => {
  const { next } = connect({ renderer: Promise.reject(new Error("no network")) });
  const notice = await next((e) => e.type === "notice");
  assert.match(notice.text, /could not start: no network/);
});

test("the page's socket has the few members the page uses", () => {
  const { socket } = connect();
  assert.equal(socket.readyState, 1, "open, the same number as WebSocket.OPEN");
  for (const member of ["send", "close", "notice"] as const) assert.equal(typeof socket[member], "function");
});

test("the frame requests are shared with the server: every emotion, and the gestures", () => {
  const character = { face: { mouth_open: 0.1 } };
  for (const [name, face] of Object.entries(emotions) as [string, Record<string, number>][]) {
    const request = framesRequest(emotions, character, name);
    assert.deepEqual(request.face, face);
    const rest = face.mouth_open ?? 0.1;
    assert.equal(request.mouth[0], rest, "the emotion's own resting mouth, which talking never closes");
    assert.deepEqual(request.mouth, [...request.mouth].sort((a, b) => a - b), "wider and wider");
    assert.ok(request.mouth.every((m) => m >= rest));
  }
  assert.deepEqual(gestureRequest(emotions, character, "happy", "cheer")!.poses, GESTURES.cheer);
  assert.equal(gestureRequest(emotions, character, "happy", "nope"), null);
  assert.equal(findAvatarTags, serverFindAvatarTags, "the server and the demo read [avatar …] tags with the same code");
});

test("the scripted answers: the colour word that comes first wins, glasses work, anything else is honest about what the demo knows", () => {
  assert.match(reply("make my hair mint green"), /hair_color=#8fe3b4/);
  assert.match(reply("Hair: BLUE please"), /hair_color=#3a6fe0/);
  assert.match(reply("can I have glasses"), /\[avatar glasses=true\]/);
  assert.match(reply("how are you"), /only knows a few tricks/);
  assert.match(reply("make my shoes red"), /only knows a few tricks/, "a colour without hair is not a hair request");
  for (const text of ["make my hair red", "put on glasses", "hello"]) assert.match(reply(text), /^\[emotion:\w+\]/, "every reply starts with an emotion, like a model's");
  assert.deepEqual(findAvatarTags(reply("hair pink")), [{ hair_color: "#ff88cc" }]);
});

const creatorAvailable = existsSync(process.env.CREATOR_SRC ?? resolve(repo, "../anime-character-creator/src"));
test("staging the demo gives a flat static folder that loads the demo's socket first and carries the renderer", { skip: creatorAvailable ? false : "the character creator is not next to this repo" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "anaico-demo-"));
  try {
    const done = await stage(dir);
    assert.ok(done.files > 5);
    const html = readFileSync(join(dir, "index.html"), "utf8");
    assert.ok(html.indexOf("demo-boot.js") > 0 && html.indexOf("demo-boot.js") < html.indexOf('src="app.js"'), "the socket is set before the page starts");
    assert.match(html, /href="custom\.css"/, "no absolute path, which breaks under a sub-folder");
    assert.doesNotMatch(html, /href="\//);
    const list = JSON.parse(readFileSync(join(dir, "creator-files.json"), "utf8")) as string[];
    assert.ok(list.includes("anime_character_creator/__init__.py"));
    for (const file of list) assert.ok(existsSync(join(dir, "creator", file)), file);
    for (const file of ["app.js", "avatar.js", "frames.js", "tags.js", "local-socket.js", "render-bridge.js", "script.js", "demo-boot.js", "render_ops.py", "emotions.json", "custom.css"]) assert.ok(existsSync(join(dir, file)), file);
    const socket = readFileSync(join(dir, "local-socket.js"), "utf8");
    assert.doesNotMatch(socket, /\.\.\/public\//);
    assert.match(socket, /from "\.\/frames\.js"/);
    assert.ok(!existsSync(join(dir, "frames.d.ts")) && !existsSync(join(dir, "stage.mjs")), "no declarations or build scripts in the site");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

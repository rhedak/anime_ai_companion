import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { GESTURES, framesRequest, gestureRequest } from "../public/frames.js";
import { findAvatarTags } from "../public/tags.js";
import { drawnDemoMessage, packDemoMessage } from "../public/demo.js";
import { createLocalSocket, type PackInfo, type Renderer } from "../demo/local-socket.js";
import { repeatsItself } from "../demo/model.js";
import { MODEL, buildMessages, emotionFix, guessEmotion, modelId, systemPrompt } from "../demo/model-prompt.js";
import { DRAWN_AGAIN, GREETING, PACK_INTRO, reply } from "../demo/script.js";
import { DEMO_PACKS, stage } from "../demo/stage.mjs";
import { findAvatarTags as serverFindAvatarTags } from "../src/avatar-tags.ts";
import { demoMessage } from "../src/demo.ts";

const repo = resolve(fileURLToPath(import.meta.url), "../..");
const emotions = JSON.parse(readFileSync(join(repo, "emotions.json"), "utf8"));
const PRESETS = ["risa", "linnea", "kyoko"];

/** A renderer that answers like python/render_ops.py would, without Python, and remembers what it was asked. */
function fakeRenderer() {
  const calls: Record<string, any>[] = [];
  const renderer: Renderer = {
    async call(request) {
      calls.push(request);
      if (request.op === "base") return { ok: true, character: { preset: request.name, hair_color: "#800000", face: { mouth_open: 0 } } };
      if (request.op === "schema") return { ok: true, presets: PRESETS };
      if (request.op === "frames") return { ok: true, svgs: request.poses ? request.poses.map((_: unknown, i: number) => `<svg pose=${i}/>`) : [...request.mouth, "blink"].map((_: unknown, i: number) => `<svg frame=${i}/>`) };
      if (request.op === "patch") {
        const { base, ...rest } = request.set;
        return { ok: true, character: { ...request.character, ...(base ? { preset: base } : {}), ...rest }, applied: Object.entries(request.set).map(([k, v]) => `${k}=${v}`), rejected: [] };
      }
      return { ok: false, error: "unknown op" };
    },
  };
  return { renderer, calls };
}

/** A socket with the page's side of it: what the page receives, in order. */
type FakeModel = { ready(): boolean; chat(messages: { role: string; content: string }[], onPiece: (piece: string) => void): Promise<string>; stop(): void };
function connect(options: { renderer?: Promise<Renderer>; greeting?: string; packs?: Record<string, PackInfo>; onPack?: (name: string | null) => void; model?: FakeModel } = {}) {
  const fake = fakeRenderer();
  const socket = createLocalSocket({ renderer: options.renderer ?? Promise.resolve(fake.renderer), emotions, reply, greeting: options.greeting ?? "", pause: async () => {}, packs: options.packs, onPack: options.onPack, model: options.model });
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
  /** Says something and waits until her answer is complete; returns what the page received for it. */
  const say = async (text: string) => {
    const from = events.length;
    send({ type: "user", text });
    await next((e) => e.type === "done", from);
    return events.slice(from);
  };
  return { socket, events, next, send, say, calls: fake.calls };
}

test("the stand-in opens like the server does, then she greets the visitor", async () => {
  const { events, next } = connect({ greeting: GREETING });
  await next((e) => e.type === "done");
  assert.deepEqual(events.slice(0, 8).map((e) => e.type), ["hello", "mode", "looks", "pack", "packs", "meter", "history", "queue"]);
  assert.equal(events[0].version, 1);
  assert.equal(events[1].mode, "chat");
  assert.equal(events[1].canUseTools, false, "no real work mode in the demo");
  assert.deepEqual(events[2].presets, PRESETS);
  assert.equal(events[2].canUndo, false);
  assert.equal(events.filter((e) => e.type === "delta").map((e) => e.text).join(""), GREETING);
  assert.match(GREETING, /runs entirely in your browser/);
});

test("the page's request for frames is answered with the same request the server would make, and a repeat costs nothing", async () => {
  const { events, next, send, calls } = connect();
  await next((e) => e.type === "queue");
  send({ type: "frames", emotion: "happy" });
  const frames = await next((e) => e.type === "frames");
  assert.equal(frames.version, 1);
  assert.equal(frames.svgs.length, 5, "four mouth openings and a blink");
  const asked = calls.filter((c) => c.op === "frames");
  assert.deepEqual(asked[0], framesRequest(emotions, { preset: "risa", hair_color: "#800000", face: { mouth_open: 0 } }, "happy"));

  const before = calls.length;
  send({ type: "frames", emotion: "happy" });
  await next((e) => e.type === "frames", events.indexOf(frames) + 1);
  assert.equal(calls.length, before, "served from the cache");
});

test("an emotion she does not know is drawn neutral, and a gesture comes back as its two poses", async () => {
  const { events, next, send, calls } = connect();
  await next((e) => e.type === "queue");
  send({ type: "frames", emotion: "flabbergasted" });
  assert.equal((await next((e) => e.type === "frames")).emotion, "flabbergasted");
  assert.deepEqual(calls.at(-1)!.face, emotions.neutral);
  send({ type: "gesture-frames", emotion: "happy", gesture: "wave" });
  assert.equal((await next((e) => e.type === "gesture-frames")).svgs.length, 2);
  send({ type: "gesture-frames", emotion: "happy", gesture: "backflip" });
  send({ type: "frames", emotion: "sad" });
  await next((e) => e.type === "frames" && e.emotion === "sad");
  assert.ok(!events.some((e) => e.gesture === "backflip"));
});

test("several requests in one message become one change of her look, and the page's Undo takes it back", async () => {
  const { events, next, send, say, calls } = connect();
  await next((e) => e.type === "queue");
  const mine = await say("make my hair mint green and put on glasses");
  const avatar = mine.find((e) => e.type === "avatar");
  assert.deepEqual(avatar.applied, ["hair_color=#8fe3b4", "glasses=true"]);
  assert.equal(avatar.version, 2);
  assert.equal(mine.filter((e) => e.type === "looks").at(-1).canUndo, true);
  assert.ok(mine.indexOf(avatar) < mine.length - 1, "the look changes before the turn is over");

  send({ type: "frames", emotion: "neutral" });
  assert.equal((await next((e) => e.type === "frames" && e.version === 2)).version, 2);
  assert.equal(calls.filter((c) => c.op === "frames").at(-1)!.character.hair_color, "#8fe3b4");

  const from = events.length;
  send({ type: "look-undo" });
  const undone = await next((e) => e.type === "avatar", from);
  assert.deepEqual(undone.applied, ["undid the last change"]);
  assert.equal(undone.version, 3);
  assert.equal((await next((e) => e.type === "looks", from)).canUndo, false);
  send({ type: "frames", emotion: "neutral" });
  await next((e) => e.type === "frames" && e.version === 3, from);
  assert.equal(calls.filter((c) => c.op === "frames").at(-1)!.character.hair_color, "#800000", "the old look is drawn again");
});

test("a reply with nothing to redraw leaves her look and the version alone", async () => {
  const { next, say } = connect();
  await next((e) => e.type === "queue");
  const mine = await say("tell me a story");
  assert.ok(!mine.some((e) => e.type === "avatar"));
});

test("the page's look buttons work: a preset, the gallery's thumbnails (once), and back to the original", async () => {
  const { events, next, send, calls } = connect({ greeting: "Hello!" });
  await next((e) => e.type === "done");

  send({ type: "look-preset", name: "linnea" });
  assert.deepEqual((await next((e) => e.type === "avatar")).applied, ["base=linnea"]);
  send({ type: "look-preset", name: "nobody" });
  send({ type: "preset-thumbs" });
  const thumbs = await next((e) => e.type === "preset-thumbs");
  assert.deepEqual(Object.keys(thumbs.svgs), PRESETS);
  const asked = calls.length;
  send({ type: "preset-thumbs" });
  await next((e) => e.type === "preset-thumbs", events.indexOf(thumbs) + 1);
  assert.equal(calls.length, asked, "the thumbnails are drawn once");
  assert.equal(events.filter((e) => e.type === "avatar").length, 1, "an unknown preset changes nothing");

  const from = events.length;
  send({ type: "reset-look" });
  assert.deepEqual((await next((e) => e.type === "avatar", from)).applied, ["back to the original look"]);
  await next((e) => e.type === "reset", from);
  await next((e) => e.type === "done", from); // her greeting again
  send({ type: "frames", emotion: "neutral" });
  await next((e) => e.type === "frames" && e.version === 3);
  assert.equal(calls.filter((c) => c.op === "frames").at(-1)!.character.preset, "risa");
});

test("a new chat empties the log and she greets again; odd input is ignored without a sound", async () => {
  const { events, next, send, socket } = connect({ greeting: "Hello!" });
  await next((e) => e.type === "done");
  socket.send("not json");
  send({ type: "user", text: "   " });
  send({ type: "rename", name: "Hana" });
  send({ type: "provider", provider: "claude" });
  send({ type: "look-save", name: "mine" });
  const from = events.length;
  send({ type: "reset" });
  await next((e) => e.type === "reset", from);
  await next((e) => e.type === "done", from);
  const after = events.slice(from).map((e) => e.type);
  assert.deepEqual(after.filter((t) => t !== "delta"), ["reset", "mode", "done"]);
  assert.ok(!events.some((e) => e.type === "notice" || e.type === "user"));
});

test("/show plays the same show as the real app, with nothing said and no message of the visitor's in the log", async () => {
  const { events, next, send } = connect({ greeting: "Hello!" });
  await next((e) => e.type === "done");
  const from = events.length;
  send({ type: "user", text: "/show" });
  const show = await next((e) => e.type === "demo", from);
  assert.deepEqual(show, drawnDemoMessage(Object.keys(emotions), Object.keys(GESTURES)));
  assert.deepEqual(show.steps.slice(0, Object.keys(emotions).length).map((s: any) => s.name), Object.keys(emotions), "every emotion first");
  assert.deepEqual(show.steps.slice(-2).map((s: any) => s.name), Object.keys(GESTURES), "then the gestures");
  assert.deepEqual(events.slice(from).map((e) => e.type), ["demo"], "no user line, no reply, nothing asked of a model");
  assert.deepEqual(show, demoMessage(Object.keys(emotions), Object.keys(GESTURES), null), "the server builds the same list for a drawn character");
});

test("the other slash commands: /clear starts afresh, /help lists what there is, and the real app's commands are named as such", async () => {
  const { events, next, send } = connect({ greeting: "Hello!" });
  await next((e) => e.type === "done");
  let from = events.length;
  send({ type: "user", text: "/help" });
  const help = await next((e) => e.type === "notice", from);
  assert.match(help.text, /\/show[^]*\/clear[^]*\/help/);
  from = events.length;
  send({ type: "user", text: "/compact" });
  assert.match((await next((e) => e.type === "notice", from)).text, /\/compact is a command of the real app/);
  from = events.length;
  send({ type: "user", text: "/clear" });
  await next((e) => e.type === "reset", from);
  await next((e) => e.type === "done", from);
  assert.ok(!events.slice(from).some((e) => e.type === "user"));
});

const PICTURES: Record<string, PackInfo> = {
  pic: {
    name: "pic",
    credit: "Pictures by someone.",
    emotions: { neutral: { idle: "frames/pic/n.png", blink: "frames/pic/nb.png", talk: ["frames/pic/t1.png"] }, happy: { idle: "frames/pic/h.png", talk: [] } },
    gestures: { wave: ["frames/pic/w1.png", "frames/pic/w2.png"] },
  },
};

test("the demo offers its picture packs like the app's Looks menu does, and choosing one makes her say what that means", async () => {
  const told: (string | null)[] = [];
  const { events, next, send } = connect({ packs: PICTURES, onPack: (name) => told.push(name) });
  await next((e) => e.type === "queue");
  assert.deepEqual(events.find((e) => e.type === "packs"), { type: "packs", names: ["pic"], active: null });
  assert.deepEqual(events.find((e) => e.type === "pack"), { type: "pack", pack: null });
  let from = events.length;
  send({ type: "pack-select", name: "pic" });
  const shown = await next((e) => e.type === "pack", from);
  assert.deepEqual(shown.pack, PICTURES.pic);
  assert.deepEqual(await next((e) => e.type === "packs", from), { type: "packs", names: ["pic"], active: "pic" });
  await next((e) => e.type === "done", from);
  const said = events.slice(from).filter((e) => e.type === "delta").map((e) => e.text).join("");
  assert.equal(said, PACK_INTRO);
  assert.match(said, /image pack[^]*can't redraw myself[^]*Drawn avatar/, "she says it is a picture pack and cannot redraw");
  assert.match(said, /^\[emotion:happy\]/);
  assert.deepEqual(told, ["pic"]);
  from = events.length;
  send({ type: "pack-select", name: null });
  assert.deepEqual((await next((e) => e.type === "pack", from)).pack, null);
  await next((e) => e.type === "done", from);
  assert.equal(events.slice(from).filter((e) => e.type === "delta").map((e) => e.text).join(""), DRAWN_AGAIN);
  assert.deepEqual(told, ["pic", null]);
});

test("/frames lists the packs, takes a name or off, and says so when there is no such pack", async () => {
  const { events, next, send } = connect({ packs: PICTURES });
  await next((e) => e.type === "queue");
  const notice = async (text: string) => {
    const from = events.length;
    send({ type: "user", text });
    return (await next((e) => e.type === "notice", from)).text as string;
  };
  assert.match(await notice("/frames"), /pic[^]*Showing the drawn avatar/);
  assert.match(await notice("/frames off"), /Already showing the drawn avatar/);
  assert.match(await notice("/frames nothing"), /no pack called "nothing"[^]*pic/);
  const from = events.length;
  send({ type: "user", text: "/frames pic" });
  await next((e) => e.type === "done", from);
  assert.ok(!events.slice(from).some((e) => e.type === "user"), "a command is not a line of the visitor's");
  assert.match(await notice("/frames pic"), /Already showing the pack "pic"/);
  assert.match(await notice("/frames"), /Showing the pack "pic"/);
  assert.equal(events.filter((e) => e.type === "pack").at(-1).pack.name, "pic");
});

test("while she is a picture pack she cannot be redrawn, a mood or a gesture still works, and /show shows what the pictures have", async () => {
  const { events, next, send, say, calls } = connect({ packs: PICTURES });
  await next((e) => e.type === "queue");
  send({ type: "pack-select", name: "pic" });
  await next((e) => e.type === "done" && events.some((x) => x.type === "pack" && x.pack));
  const version = events.find((e) => e.type === "hello").version;
  const patches = () => calls.filter((c) => c.op === "patch").length;
  const refused = await say("make my hair mint green and put on glasses");
  assert.match(refused.filter((e) => e.type === "delta").map((e) => e.text).join(""), /can't do that as a picture pack[^]*Drawn avatar/);
  assert.ok(!refused.some((e) => e.type === "avatar"), "her look did not change");
  assert.equal(patches(), 0);
  assert.equal(version, 1);
  const also = await say("become Linnea");
  assert.ok(!also.some((e) => e.type === "avatar"));
  const mood = await say("wave at me");
  assert.match(mood.filter((e) => e.type === "delta").map((e) => e.text).join(""), /\[gesture:wave\]/);
  const from = events.length;
  send({ type: "user", text: "/show" });
  const show = await next((e) => e.type === "demo", from);
  assert.deepEqual(show, packDemoMessage(Object.keys(emotions), Object.keys(GESTURES), PICTURES.pic));
  assert.deepEqual(show.steps.filter((s: any) => s.kind === "gesture").map((s: any) => s.name), ["wave"], "only the gesture it has pictures for");
  assert.match(show.note ?? "", /cheer \(no pictures\)/);
});

test("picking a drawn look while she is a picture pack shows the drawn avatar again, as the app does", async () => {
  const { events, next, send } = connect({ packs: PICTURES });
  await next((e) => e.type === "queue");
  send({ type: "pack-select", name: "pic" });
  await next((e) => e.type === "done" && events.some((x) => x.type === "pack" && x.pack));
  const from = events.length;
  send({ type: "look-preset", name: "linnea" });
  await next((e) => e.type === "avatar", from);
  const after = events.slice(from);
  assert.deepEqual(after.find((e) => e.type === "pack"), { type: "pack", pack: null });
  assert.ok(!after.some((e) => e.type === "delta"), "no speech for it: the visitor chose it themselves");
});

test("what she answers as a picture pack: no redrawing, honest help, and moods and gestures as before", () => {
  const pack = (text: string) => reply(text, { presets: PRESETS, pack: true });
  assert.doesNotMatch(pack("make my hair mint green").text, /\[avatar/);
  assert.match(pack("make my hair mint green").text, /^\[emotion:shy\]/);
  assert.doesNotMatch(pack("become Linnea").text, /\[avatar/);
  assert.doesNotMatch(pack("a red coat").text, /\[avatar/);
  assert.match(pack("be shy").text, /^\[emotion:shy\]/);
  assert.match(pack("cheer").text, /\[gesture:cheer\]/);
  assert.match(pack("what can you do?").text, /picture pack[^]*\/frames off/);
  assert.doesNotMatch(pack("what can you do?").text, /hair/, "the help does not offer redrawing");
  assert.match(pack("undo").text, /nothing to undo/);
  assert.match(pack("how is the weather").text, /as a picture pack I only know/);
  assert.equal(pack("show me work mode").scene, "work");
  assert.match(pack("show me all your expressions").text, /\[demo\]$/);
});

test("\"that colour\" is the colour named a moment ago, by either of them; a look request she cannot complete stays with the script", () => {
  const r = (text: string, recent: string[] = []) => reply(text, { presets: PRESETS, recent });
  const said = ["what is your favorite color", '[emotion:happy] I think my favorite color is probably "blue"! It is the color of the ocean.'];
  assert.match(r("turn your hair that color", said).text, /\[avatar hair_color=#3a6fe0\]/);
  assert.match(r("make my eyes the same colour", ["I love purple"]).text, /eye_color=#8a4fd0/);
  assert.match(r("a hat in that color", ["red", "ok"]).text, /hat_color=#d02a2a/);
  assert.equal(r("turn your hair that color", ["nothing about colours here"]).needsModel, undefined, "with none to refer to she asks, and does not hand it to a model");
  assert.match(r("turn your hair that color").text, /I need to know how[^]*mint green/);
  for (const text of ["make it look nicer", "change your style", "give me a new look"]) {
    const answer = r(text);
    assert.ok(!answer.needsModel, text);
    assert.match(answer.text, /^\[emotion:thinking\]/);
  }
  // chat about her look is chat; a compliment is not a request
  for (const text of ["what is your favorite hair color", "I like your hair", "do you like your eyes?", "how is the weather"]) assert.equal(r(text).needsModel, true, text);
});

test("with the model on, a look request never reaches it: the script changes her hair even when the words are loose", async () => {
  const { model, asked } = fakeModel("[emotion:happy] Blue is my favourite!");
  const { next, say } = connect({ model });
  await next((e) => e.type === "queue");
  await say("what is your favorite color");
  assert.equal(asked.length, 1, "a chat question goes to the model");
  const looked = await say("turn your hair that color");
  assert.ok(looked.some((e) => e.type === "avatar"), "and her hair changed");
  assert.equal(asked.length, 1, "the model was not asked about it");
  const loose = await say("make it look nicer");
  assert.match(loose.filter((e) => e.type === "delta").map((e) => e.text).join(""), /I need to know how/);
  assert.equal(asked.length, 1);
});

/** A model that answers with the given text in pieces, and remembers what it was asked. */
function fakeModel(answer: string, options: { on?: boolean; fail?: string } = {}) {
  const asked: { role: string; content: string }[][] = [];
  const state = { stopped: 0, on: options.on ?? true };
  const model: FakeModel = {
    ready: () => state.on,
    async chat(messages, onPiece) {
      asked.push(messages);
      if (options.fail) throw new Error(options.fail);
      for (const piece of answer.match(/\S+\s*/g) ?? []) onPiece(piece);
      return answer;
    },
    stop: () => void state.stopped++,
  };
  return { model, asked, state };
}

test("the small model answers what the script cannot, with its emotion tag, and never changes her look or answers what the script can do", async () => {
  const { model, asked } = fakeModel("[emotion:happy] Hello! I like quiet evenings. [avatar hair_color=#ff0000] [gesture:wave]");
  const { events, next, say, calls } = connect({ model });
  await next((e) => e.type === "queue");
  const chat = await say("how is the weather");
  assert.equal(chat.filter((e) => e.type === "delta").map((e) => e.text).join(""), "[emotion:happy] Hello! I like quiet evenings. [avatar hair_color=#ff0000] [gesture:wave]");
  assert.ok(!chat.some((e) => e.type === "avatar"), "a look tag from the model is applied to nothing");
  assert.equal(calls.filter((c) => c.op === "patch").length, 0);
  assert.equal(asked.length, 1);
  assert.equal(asked[0][0].role, "system");
  assert.match(asked[0][0].content, /\[emotion:neutral\][^]*\[emotion:thinking\]/, "she is told which faces she has");
  assert.deepEqual(asked[0].at(-1), { role: "user", content: "how is the weather" });
  // what the script can do stays with the script
  const redraw = await say("make my hair mint green");
  assert.ok(redraw.some((e) => e.type === "avatar"), "a redraw is still done by the script");
  assert.equal(asked.length, 1, "and the model was not asked");
  const chat2 = await say("can we chat?");
  assert.equal(asked.length, 2, "a request to chat goes to the model");
  assert.ok(asked[1].some((m) => m.role === "assistant"), "with the earlier turns");
  assert.ok(!asked[1].some((m) => /avatar|hair_color/.test(m.content) && m.role === "system"));
  assert.ok(chat2.some((e) => e.type === "done"));
  assert.equal(events.filter((e) => e.type === "notice").length, 0);
});

test("with the model off, or when it is not there, she points to the real app as before; and a model that fails says so and ends her turn", async () => {
  const off = fakeModel("never", { on: false });
  const a = connect({ model: off.model });
  await a.next((e) => e.type === "queue");
  const answer = await a.say("tell me a joke");
  assert.match(answer.filter((e) => e.type === "delta").map((e) => e.text).join(""), /no language model[^]*Ollama/);
  assert.equal(off.asked.length, 0);
  const broken = fakeModel("x", { fail: "GPU lost" });
  const b = connect({ model: broken.model });
  await b.next((e) => e.type === "queue");
  const failed = await b.say("tell me a joke");
  assert.match(failed.find((e) => e.type === "notice")?.text, /The small model stopped: GPU lost/);
  assert.ok(failed.some((e) => e.type === "done"), "her turn still ends");
});

test("an answer without a usable emotion gets one added at the end, and the stop button reaches the model", async () => {
  const { model, state } = fakeModel("Sorry, I do not know that one?");
  const { events, next, send, say } = connect({ model });
  await next((e) => e.type === "queue");
  const reply = await say("who is the president");
  const tail = reply.filter((e) => e.type === "delta").map((e) => e.text).join("");
  assert.match(tail, /\[emotion:(sad|thinking)\]$/);
  send({ type: "stop" });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(state.stopped, 1);
  assert.ok(events.length > 0);
});

test("she can be told to say something unprompted (the model is ready), and tags in it work", async () => {
  const { socket, events, next } = connect();
  await next((e) => e.type === "queue");
  const from = events.length;
  (socket as any).announce("[emotion:happy] [gesture:wave] Ready!");
  await next((e) => e.type === "done", from);
  assert.equal(events.slice(from).filter((e) => e.type === "delta").map((e) => e.text).join(""), "[emotion:happy] [gesture:wave] Ready!");
});

test("what the small model is told: her faces, the tags it may use, and the last few turns without any tag but the emotion", () => {
  const names = Object.keys(emotions);
  const system = systemPrompt(names);
  for (const name of names) assert.ok(system.includes(`[emotion:${name}]`), name);
  assert.match(system, /\[gesture:wave\] or \[gesture:cheer\]/);
  assert.match(system, /cannot change your own looks/);
  const history = [
    { type: "bot", text: "[emotion:happy] [gesture:wave] Hi! [avatar hair_color=#fff] Welcome." },
    { type: "user", text: "make my hair mint green" },
    { type: "bot", text: "[emotion:happy] Okay! Mint hair. [avatar hair_color=#8fe3b4] How does that look?" },
    { type: "notice", text: "something else" },
    { type: "user", text: "how are you [image x.png]" },
  ];
  const messages = buildMessages(history, names);
  assert.deepEqual(messages.map((m) => m.role), ["system", "assistant", "user", "assistant", "user"]);
  assert.equal(messages[1].content, "[emotion:happy] Hi! Welcome.");
  assert.equal(messages[3].content, "[emotion:happy] Okay! Mint hair. How does that look?");
  assert.equal(messages[4].content, "how are you");
  const long = Array.from({ length: 30 }, (_, i) => ({ type: i % 2 ? "bot" : "user", text: `line ${i}` }));
  assert.equal(buildMessages(long, names).length, 9, "the system prompt and the last eight turns");
  assert.ok(buildMessages([{ type: "user", text: "x".repeat(5000) }], names)[1].content.length <= 600);
});

test("the emotion of an answer is fixed at its end only when it needs it, and the model build follows what the GPU can do", () => {
  const names = Object.keys(emotions);
  assert.equal(emotionFix("[emotion:happy] Hi!", names), "");
  assert.equal(emotionFix("[emotion:sad] ok [emotion:shy] fine", names), "");
  assert.match(emotionFix("[emotion:ecstatic] Wow!", names), /^ \[emotion:happy\]$/, "an invented face is replaced by a guess");
  assert.match(emotionFix("Hello there!", names), /^ \[emotion:happy\]$/);
  assert.match(emotionFix("What do you mean?", names), /^ \[emotion:thinking\]$/);
  assert.match(emotionFix("Nothing much", names), /^ \[emotion:neutral\]$/);
  assert.equal(guessEmotion("I am sorry about that", names), "sad");
  assert.equal(guessEmotion("hello", ["neutral"]), "neutral", "only faces she has");
  assert.equal(modelId(true), MODEL.idF16);
  assert.equal(modelId(false), MODEL.idF32);
  assert.match(MODEL.library, /@mlc-ai\/web-llm@\d+\.\d+\.\d+\/\+esm$/, "an exact version of the library");
  assert.equal(MODEL.licence, "Apache-2.0");
});

test("a looping answer is recognised, and an ordinary one is not", () => {
  const loop = 'A cat is on the couch. "Mouse, mouse, I want to play with you!" The cat says. "Mouse, mouse, I want to play with you!" The cat says again.';
  assert.equal(repeatsItself(loop), false, "once is fine");
  assert.equal(repeatsItself(loop + ' "Mouse, mouse, I want to play with you!" The cat says again.'), true);
  assert.equal(repeatsItself("Hello! I am fine."), false);
  assert.equal(repeatsItself("a ".repeat(80)), true);
});

test("asked in words to show off, she says so and ends with [demo], and the show follows her reply like the server's", async () => {
  const { events, next, send } = connect();
  await next((e) => e.type === "queue");
  const from = events.length;
  send({ type: "user", text: "show me all your emotions" });
  await next((e) => e.type === "demo", from);
  const types = events.slice(from).map((e) => e.type);
  assert.ok(types.indexOf("done") < types.indexOf("demo"), "the show starts after her reply is done");
  assert.match(events.slice(from).filter((e) => e.type === "delta").map((e) => e.text).join(""), /Sure, watch this! \[demo\]/);
});

test("work mode, pretended: she asks with a real approval card, nothing ends until it is answered, and the face keeps moving meanwhile", async () => {
  const { events, next, send, say } = connect();
  await next((e) => e.type === "queue");
  const from = events.length;
  send({ type: "user", text: "show me work mode" });
  const card = await next((e) => e.type === "permission", from);
  assert.equal(card.request.tool, "Edit");
  assert.equal(card.request.summary, "index.html");
  assert.deepEqual(Object.keys(card.request.input), ["file_path", "old_string", "new_string"]);
  assert.match(card.request.description, /pretend/i);
  const tools = events.slice(from).filter((e) => e.type === "tool").map((e) => `${e.name}:${e.status}`);
  assert.deepEqual(tools, ["Read:running", "Read:done", "Edit:running"]);
  assert.ok(!events.slice(from).some((e) => e.type === "done"), "she is waiting for the answer");

  // While the card is open, the page can still ask for frames (her face must not freeze).
  send({ type: "frames", emotion: "thinking" });
  await next((e) => e.type === "frames" && e.emotion === "thinking", from);

  send({ type: "permission-reply", id: card.request.id, decision: "allow" });
  assert.deepEqual((await next((e) => e.type === "permission-resolved", from)).decision, "allow");
  await next((e) => e.type === "done", from);
  const said = events.slice(from).filter((e) => e.type === "delta").map((e) => e.text).join("");
  assert.match(said, /pretend work-mode session/);
  assert.match(said, /heading is pink/);
  assert.equal(events.slice(from).filter((e) => e.type === "tool").at(-1).status, "done");
  // The conversation goes on afterwards.
  assert.ok((await say("be shy")).some((e) => e.type === "done"));
});

test("pretend work mode, denied: she accepts it; and the stop button counts as a no", async () => {
  const denied = connect();
  await denied.next((e) => e.type === "queue");
  denied.send({ type: "user", text: "show me work mode" });
  const card = await denied.next((e) => e.type === "permission");
  denied.send({ type: "permission-reply", id: card.request.id, decision: "deny" });
  await denied.next((e) => e.type === "done");
  assert.equal(denied.events.filter((e) => e.type === "tool").at(-1).status, "error");
  assert.match(denied.events.filter((e) => e.type === "delta").map((e) => e.text).join(""), /leave it alone/);

  const stopped = connect();
  await stopped.next((e) => e.type === "queue");
  stopped.send({ type: "user", text: "can you show me the coding part" });
  await stopped.next((e) => e.type === "permission");
  stopped.send({ type: "stop" });
  assert.equal((await stopped.next((e) => e.type === "permission-resolved")).decision, "deny");
  await stopped.next((e) => e.type === "done");
});

test("a card answered with a wrong id does nothing", async () => {
  const { events, next, send } = connect();
  await next((e) => e.type === "queue");
  send({ type: "user", text: "show me work mode" });
  await next((e) => e.type === "permission");
  send({ type: "permission-reply", id: "something-else", decision: "allow" });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!events.some((e) => e.type === "permission-resolved"));
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

const say = (text: string) => reply(text, { presets: PRESETS });

test("she understands several requests in one message, in any order, and says what she did", () => {
  assert.match(say("make my hair mint green").text, /\[avatar hair_color=#8fe3b4\]/);
  assert.match(say("make my hair mint green").text, /Okay! Mint hair\./, "the colour word that comes first: mint, not green");
  assert.match(say("blue eyes, a witch hat and a red coat").text, /\[avatar eye_color=#3a6fe0 hat_color=#2a1a4a coat_color=#d02a2a\]/);
  assert.match(say("blue eyes, a witch hat and a red coat").text, /Blue eyes, a witch hat and a red coat\./);
  assert.match(say("short dark purple hair and pink tips").text, /hair_color=#532f7d hairstyle=short_layered hair_tip_color=#ff88cc/);
  assert.match(say("light blue skirt").text, /skirt_color=#[0-9a-f]{6}/);
  assert.match(say("hair #ff00aa").text, /hair_color=#ff00aa/);
  assert.deepEqual(findAvatarTags(say("hair pink and glasses").text), [{ hair_color: "#ff88cc", glasses: "true" }]);
});

test("asked to chat, or for what only a model could do, she says plainly that the demo has none and where to get one", () => {
  for (const text of ["can we chat?", "let's talk", "how are you", "who are you?", "what is your name", "tell me a joke", "write me a poem", "explain quantum physics", "what do you think about cats"]) {
    const answer = say(text).text;
    assert.match(answer, /^\[emotion:happy\]/, text);
    assert.match(answer, /no language model[^]*Claude Code, Cursor or opencode[^]*\[Ollama\]\(https:\/\/ollama\.com\)/, text);
    assert.doesNotMatch(answer, /\[avatar|\[gesture/, text);
  }
  // things she can do are not mistaken for chatting
  for (const text of ["wave at me", "can you wave", "show me everything", "become Linnea", "talk about my hair: make it pink", "be shy", "what can you do?"]) {
    assert.doesNotMatch(say(text).text, /no language model/, text.includes("what can") ? "the help mentions it differently" : text);
  }
  assert.match(say("what can you do?").text, /can't chat freely/);
  assert.match(reply("tell me a joke", { presets: PRESETS, pack: true }).text, /no language model/);
  assert.match(reply("how is the weather", { presets: PRESETS, pack: true }).text, /no language model[^]*as a picture pack/);
  const ends = say("how is the weather").text;
  assert.match(ends, /runs a tiny one right here in your browser\.$/, "ends on words, because the bubble over her picture shows the tail as plain text");
});

test("taking things off works across an 'and', and putting on after taking off does not inherit it", () => {
  assert.match(say("remove my glasses and hat").text, /\[avatar glasses=false hat_color=none\]/);
  assert.match(say("take off the hat and put on glasses").text, /\[avatar hat_color=none glasses=true\]/);
  assert.match(say("no glasses, no hat").text, /glasses=false hat_color=none/);
});

test("presets, moods, gestures, and the things she is honest about", () => {
  assert.match(say("become Linnea").text, /\[avatar base=linnea\]/);
  assert.match(say("reset").text, /\[avatar base=risa\]/);
  assert.match(say("surprise me").text, /\[avatar base=(risa|linnea|kyoko)\]/);
  assert.match(say("be shy").text, /^\[emotion:shy\]/);
  assert.doesNotMatch(say("be shy").text, /\[avatar/, "a mood changes her face, not her look");
  assert.match(say("wave at me").text, /\[gesture:wave\]/);
  assert.match(say("cheer").text, /\[gesture:cheer\]/);
  assert.match(say("put on a coat").text, /I need a colour for the coat/);
  assert.match(say("how is the weather").text, /beyond my script[^]*no language model[^]*Ollama/);
  assert.match(say("how is the weather").text, /\(https:\/\/rhedak\.github\.io\/anime_ai_companion\/brains\.html#ollama\)/, "the way to set a model up");
  assert.match(say("what can you do?").text, /20 characters/);
  assert.match(say("what can you do?").text, /\/show/);
  assert.match(say("show me all your expressions").text, /\[demo\]$/);
  assert.match(say("run through everything").text, /\[demo\]/);
  assert.match(say("undo").text, /Undo button/);
  assert.equal(say("show me work mode").scene, "work");
  assert.equal(say("what is my project command").scene, "work");
  for (const text of ["make my hair red", "put on glasses", "hello", "how is the weather", "be sad"]) assert.match(say(text).text, /^\[emotion:\w+\]/, "every reply starts with an emotion, like a model's");
});

test("every redraw she can ask for is something the creator's patch op accepts (checked against its real schema)", { skip: existsSync(resolve(repo, "../anime-character-creator/src")) ? false : "the creator is not next to this repo" }, async () => {
  const { spawnSync } = await import("node:child_process");
  const keys = new Set<string>();
  for (const text of ["hair mint green and blue eyes", "short messy hair", "pink tips", "witch hat", "a red coat and skirt and top", "ribbon scarf mask boots belt black", "glasses"]) {
    for (const tag of findAvatarTags(say(text).text)) for (const key of Object.keys(tag)) keys.add(key);
  }
  const venv = join(repo, ".venv", "bin", "python");
  const python = existsSync(venv) ? venv : "python3";
  const probe = spawnSync(
    python,
    ["-I", "-c", `import sys, json; sys.path.insert(0, "python"); from render_ops import handle; s = handle({"op": "schema"}); known = set(s["top"]) | set(s["face"]) | set(s["outfit"]); print(json.dumps([k for k in json.loads(sys.argv[1]) if k not in known]))`, JSON.stringify([...keys])],
    { cwd: repo, encoding: "utf8", env: { ...process.env, CREATOR_SRC: resolve(repo, "../anime-character-creator/src") } },
  );
  if (probe.status !== 0 && /Python 3\.(9|10)|SyntaxError/.test(probe.stderr)) return; // an old python: the renderer tests report that
  assert.equal(probe.status, 0, probe.stderr);
  assert.deepEqual(JSON.parse(probe.stdout), [], "every field she can change exists in the creator");
});

const creatorAvailable = existsSync(process.env.CREATOR_SRC ?? resolve(repo, "../anime-character-creator/src"));
test("staging the demo gives a flat static folder in demo mode that loads the demo's socket first and carries the renderer", { skip: creatorAvailable ? false : "the character creator is not next to this repo" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "anaico-demo-"));
  try {
    const done = await stage(dir);
    assert.ok(done.files > 5);
    const html = readFileSync(join(dir, "index.html"), "utf8");
    assert.ok(html.indexOf("demo-boot.js") > 0 && html.indexOf("demo-boot.js") < html.indexOf('src="app.js"'), "the socket is set before the page starts");
    assert.match(html, /href="custom\.css"/, "no absolute path, which breaks under a sub-folder");
    assert.doesNotMatch(html, /href="\//);
    assert.match(html, /<body class="demo">/);
    assert.match(html, /href="demo\.css"/);
    assert.match(html, /<title>Anime AI Companion \(demo\)<\/title>/);
    assert.match(html, /demo-banner[^]*nothing you type is sent anywhere[^]*github\.com\/rhedak\/anime_ai_companion/);
    const list = JSON.parse(readFileSync(join(dir, "creator-files.json"), "utf8")) as string[];
    assert.ok(list.includes("anime_character_creator/__init__.py"));
    for (const file of list) assert.ok(existsSync(join(dir, "creator", file)), file);
    for (const file of ["app.js", "avatar.js", "frames.js", "tags.js", "local-socket.js", "render-bridge.js", "script.js", "demo-boot.js", "demo.css", "render_ops.py", "emotions.json", "custom.css"]) assert.ok(existsSync(join(dir, file)), file);
    const packs = JSON.parse(readFileSync(join(dir, "packs.json"), "utf8"));
    assert.deepEqual(Object.keys(packs), DEMO_PACKS);
    for (const [name, info] of Object.entries<any>(packs)) {
      assert.ok(existsSync(join(dir, "pack-thumb", name)), "the gallery's picture of the pack");
      const urls = [...Object.values<any>(info.emotions).flatMap((e) => [e.idle, e.blink, ...e.talk]), ...Object.values<any>(info.gestures).flat()].filter(Boolean);
      assert.ok(urls.length > 30);
      for (const url of urls) {
        assert.match(url, /^frames\//, "relative, so the demo works under a sub-folder");
        assert.ok(existsSync(join(dir, url)), url);
      }
    }
    const socket = readFileSync(join(dir, "local-socket.js"), "utf8");
    assert.doesNotMatch(socket, /\.\.\/public\//);
    assert.match(socket, /from "\.\/frames\.js"/);
    assert.ok(!existsSync(join(dir, "frames.d.ts")) && !existsSync(join(dir, "stage.mjs")), "no declarations or build scripts in the site");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

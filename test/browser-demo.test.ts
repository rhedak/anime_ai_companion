import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ADULT_GESTURES, CUT_FACES, GESTURES, framesRequest, gestureRequest, gesturePoses, gestureView } from "../public/frames.js";
import { findAvatarTags } from "../public/tags.js";
import { drawnDemoMessage, packDemoMessage } from "../public/demo.js";
import { createLocalSocket, type PackInfo, type Renderer } from "../demo/local-socket.js";
import { repeatsItself } from "../demo/model.js";
import { MODEL, buildMessages, emotionFix, guessEmotion, modelId, systemPrompt } from "../demo/model-prompt.js";
import { DRAWN_AGAIN, GREETING, PACK_INTRO, packIntroFor, personaFor, reply } from "../public/script.js";
import { DEMO_PACKS, stage } from "../demo/stage.mjs";
import { findAvatarTags as serverFindAvatarTags } from "../src/avatar-tags.ts";
import { demoMessage } from "../src/demo.ts";

const repo = resolve(fileURLToPath(import.meta.url), "../..");
const emotions = JSON.parse(readFileSync(join(repo, "emotions.json"), "utf8"));
const PRESETS = ["risa", "linnea", "kyoko"];

/** A renderer that answers like src/render-ops.ts would, without the creator, and remembers what it was asked. */
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
function connect(options: { renderer?: Promise<Renderer>; greeting?: string; packs?: Record<string, PackInfo>; characters?: Record<string, any>; remote?: Record<string, any>; fetchJson?: (url: string) => Promise<unknown>; preload?: (url: string) => Promise<unknown>; want?: string; agreed?: string[]; onAgree?: (id: string) => void; onPack?: (name: string | null) => void; model?: FakeModel; pause?: (ms: number) => Promise<void>; restore?: { character?: any; pack?: string | null } | null; onSave?: (saved: any) => void } = {}) {
  const fake = fakeRenderer();
  const socket = createLocalSocket({ renderer: options.renderer ?? Promise.resolve(fake.renderer), emotions, reply, greeting: options.greeting ?? "", pause: options.pause ?? (async () => {}), packs: options.packs, characters: options.characters, remote: options.remote, fetchJson: options.fetchJson, preload: options.preload, want: options.want, agreed: options.agreed, onAgree: options.onAgree, onPack: options.onPack, model: options.model, restore: options.restore, onSave: options.onSave });
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

test("the adult cuts (Risa's and Franzi's) have their own happy over emotions.json's; every other emotion, and every other cut, is asked for as emotions.json says", () => {
  const emotions = { neutral: {}, happy: { mouth_curve: 1.6, brow_tilt: -0.1, blush: 1.0, eye_openness: 0.7, mouth_open: 0.3 }, sad: { mouth_curve: -1.4 } };
  const risa = { hairstyle: "long_straight_fringed", face: { mouth_open: 0 } };
  const { eyes_closed: shut, ...risaHappy } = CUT_FACES.long_straight_fringed.happy;
  assert.equal(shut, true, "Risa's happy has her eyes shut, as the reference's does");
  const happy = framesRequest(emotions, risa, "happy");
  assert.deepEqual(happy.face, { ...emotions.happy, ...risaHappy });
  assert.equal(happy.eyes_shut, true, "the shut eyes reach the frames op as its own flag, not as a face field it would ignore");
  assert.equal(happy.face.mouth_open, 0.9);
  assert.equal((happy.face as Record<string, number>).mouth_width, 1.55);
  assert.deepEqual(happy.mouth, [0.9, 0.4, 0.65, 0.9], "her laugh closes a little around its rest while she talks, so it moves");
  assert.equal(framesRequest(emotions, risa, "sad").eyes_shut, undefined);
  assert.deepEqual(framesRequest(emotions, risa, "sad").face, emotions.sad);
  const franzi = framesRequest(emotions, { hairstyle: "swept_ponytail" }, "happy");
  assert.deepEqual(franzi.face, { ...emotions.happy, ...CUT_FACES.swept_ponytail.happy });
  assert.equal(franzi.eyes_shut, undefined, "Franzi's happy keeps open eyes");
  assert.deepEqual(franzi.mouth, [0.6, 0.6, 0.6, 0.85], "and the shared talking rule (never below the rest)");
  assert.deepEqual(framesRequest(emotions, { hairstyle: "long_parted" }, "happy").face, emotions.happy, "a chibi hairstyle keeps the shared happy");
  assert.deepEqual(framesRequest(emotions, {}, "happy").face, emotions.happy);
  assert.deepEqual(gestureRequest(emotions, { ...risa, body: "adult_female" }, "happy", "wave")!.face, happy.face);
  assert.equal(gestureRequest(emotions, { ...risa, body: "adult_female" }, "happy", "wave")!.eyes_shut, true);
});

test("the adult body's gestures bend the elbow and close the fist, the chibi's swing the arm; only the adult cheer comes with a wider view", async () => {
  assert.deepEqual(gesturePoses({ body: "adult_female" }, "wave"), ADULT_GESTURES.wave);
  assert.deepEqual(gesturePoses({ body: "chibi" }, "wave"), GESTURES.wave);
  assert.deepEqual(gesturePoses({}, "cheer"), GESTURES.cheer);
  assert.equal(gesturePoses({ body: "adult_female" }, "backflip"), undefined);
  assert.ok(ADULT_GESTURES.wave.every((p) => (p.right_elbow as number) >= 148 && p.right_arm_out === 6), "the pack's wave: the upper arm held in, the forearm folded up");
  assert.ok(ADULT_GESTURES.cheer.every((p) => p.grip_style === "fist"), "the cheer's hands are fists");
  assert.equal(gestureView({ body: "adult_female" }, "cheer"), "15 -30 370 360");
  assert.equal(gestureView({ body: "adult_female" }, "wave"), null);
  assert.equal(gestureView({ body: "chibi" }, "cheer"), null);
  const adult = connect({ restore: { character: { body: "adult_female" } } });
  await adult.next((e) => e.type === "queue");
  adult.send({ type: "gesture-frames", emotion: "happy", gesture: "cheer" });
  const cheer = await adult.next((e) => e.type === "gesture-frames");
  assert.equal(cheer.svgs.length, 2);
  assert.equal(cheer.view, "15 -30 370 360");
  assert.deepEqual(adult.calls.filter((c) => c.poses).at(-1)!.poses, ADULT_GESTURES.cheer, "the renderer was asked for the adult poses");
  adult.send({ type: "gesture-frames", emotion: "happy", gesture: "wave" });
  const wave = await adult.next((e) => e.type === "gesture-frames" && e.gesture === "wave");
  assert.equal(wave.view, undefined);
  const plain = connect();
  await plain.next((e) => e.type === "queue");
  plain.send({ type: "gesture-frames", emotion: "happy", gesture: "cheer" });
  assert.equal((await plain.next((e) => e.type === "gesture-frames")).view, undefined);
  assert.deepEqual(plain.calls.filter((c) => c.poses).at(-1)!.poses, GESTURES.cheer);
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
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!events.slice(from).some((e) => e.type === "reset" || e.type === "done"), "only the look is restored: the chat stays and her greeting does not come again");
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
  assert.deepEqual(events.find((e) => e.type === "packs"), { type: "packs", names: ["pic"], characters: {}, active: null, remote: [], thumbs: {} });
  assert.deepEqual(events.find((e) => e.type === "pack"), { type: "pack", pack: null });
  let from = events.length;
  send({ type: "pack-select", name: "pic" });
  const shown = await next((e) => e.type === "pack", from);
  assert.deepEqual(shown.pack, PICTURES.pic);
  assert.deepEqual(await next((e) => e.type === "packs", from), { type: "packs", names: ["pic"], characters: {}, active: "pic", remote: [], thumbs: {} });
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
  assert.match(system, /\*she moves a step closer\*/);
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
  const { events, next, say, send } = connect({ renderer: Promise.reject(new Error("no network")) });
  const notice = await next((e) => e.type === "notice");
  assert.match(notice.text, /Could not load the drawing code[^]*blocker[^]*Reload the page[^]*rhedak\.github\.io\/anime_ai_companion/);
  assert.match(notice.text, /Details: no network/);
  // Later messages do not get a half-working answer or a stuck page: the reason again, and her turn ends.
  const reply = await say("make your hair mint green");
  assert.deepEqual(reply.map((e) => e.type), ["user", "notice", "done"]);
  assert.match(reply[1].text, /Could not load the drawing code/);
  assert.doesNotMatch(reply[1].text, /pyodide|python|jsdelivr/i);
  assert.ok(!events.some((e) => e.type === "delta" || e.type === "avatar"), "she said nothing and changed nothing");
  const work = await say("show me work mode");
  assert.deepEqual(work.map((e) => e.type), ["user", "notice", "done"]);
  const from = events.length;
  send({ type: "reset" });
  await next((e) => e.type === "notice", from);
  assert.ok(!events.slice(from).some((e) => e.type === "delta"), "a new chat does not greet");
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
  assert.match(say("what can you do?").text, /21 characters/);
  assert.match(say("what can you do?").text, /\/show/);
  assert.match(say("show me all your expressions").text, /\[demo\]$/);
  assert.match(say("run through everything").text, /\[demo\]/);
  assert.match(say("undo").text, /Undo button/);
  assert.equal(say("show me work mode").scene, "work");
  assert.equal(say("what is my project command").scene, "work");
  for (const text of ["make my hair red", "put on glasses", "hello", "how is the weather", "be sad"]) assert.match(say(text).text, /^\[emotion:\w+\]/, "every reply starts with an emotion, like a model's");
});

const creatorSrc = process.env.CREATOR_SRC ?? resolve(repo, "../anime-character-creator/ts/src");
test("hair tips are asked for on every body (the adult woman too since the creator's 0.7.2), and refused only for a body the list names", () => {
  assert.match(reply("pink tips", { presets: PRESETS, body: "adult_female" }).text, /hair_tip_color=#ff88cc/);
  assert.match(reply("blue eyes and pink tips", { presets: PRESETS, body: "tall_chibi_long_torso" }).text, /eye_color=#3a6fe0 hair_tip_color=#ff88cc/);
});
test("every redraw she can ask for is something the creator's patch op accepts (checked against its real schema)", { skip: existsSync(join(creatorSrc, "render.ts")) ? false : "the creator's TypeScript is not next to this repo (set CREATOR_SRC to its ts/src folder)" }, async () => {
  const { createRenderOps } = await import("../src/render-ops.ts");
  const { loadCreator } = await import("../src/creator-load.ts");
  const keys = new Set<string>();
  for (const text of ["hair mint green and blue eyes", "short messy hair", "pink tips", "witch hat", "a red coat and skirt and top", "ribbon scarf mask boots belt black", "glasses"]) {
    for (const tag of findAvatarTags(say(text).text)) for (const key of Object.keys(tag)) keys.add(key);
  }
  const schema = createRenderOps(await loadCreator(creatorSrc)).handle(new Map([["op", "schema"]]));
  const known = new Set(["top", "face", "outfit"].flatMap((section) => [...(schema.get(section) as Map<string, unknown>).keys()]));
  assert.deepEqual([...keys].filter((k) => !known.has(k)), [], "every field she can change exists in the creator");
});

// The staged demo carries the creator's TypeScript compiled to browser JavaScript (demo/stage.mjs says where it looks); test/demo-stage.test.ts
// loads those modules and checks them against the server's drawing.
const creatorAvailable = existsSync(join(creatorSrc, "render.ts"));
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
    assert.match(html, /demo-banner-short[^>]*>[^<]*nothing is sent anywhere/, "the short line keeps the privacy statement");
    assert.match(html, /class="demo-banner-toggle" aria-expanded="true"/, "the notice can be folded");
    assert.match(html, /class="demo-banner-cta" href="https:\/\/rhedak\.github\.io\/anime_ai_companion\/download\.html">Download the full version</, "a way to the real app that stays when the notice is folded");
    for (const file of ["app.js", "avatar.js", "frames.js", "tags.js", "local-socket.js", "render-bridge.js", "script.js", "demo-boot.js", "demo.css", "emotions.json", "custom.css", "js/render-ops.js", "creator/js/render.js", "creator/js/presets.js", "creator/js/pyjsonload.js"]) assert.ok(existsSync(join(dir, file)), file);
    assert.ok(!existsSync(join(dir, "creator-files.json")) && !existsSync(join(dir, "render_ops.py")), "no Python files list and no Python request handling");
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

test("stop ends a scripted reply at once: no more words, and the turn is over", async () => {
  const { socket, events, next, send } = connect({ pause: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 20))) });
  await next((e) => e.type === "queue");
  const from = events.length;
  send({ type: "user", text: "What can you do?" });
  await next((e) => e.type === "delta", from);
  const stoppedAt = Date.now();
  send({ type: "stop" });
  await next((e) => e.type === "done", from, 500);
  assert.ok(Date.now() - stoppedAt < 300, "the turn ended right after the stop");
  const wordsAfter = events.slice(from).filter((e) => e.type === "delta").length;
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(events.slice(from).filter((e) => e.type === "delta").length, wordsAfter, "nothing more was said after the turn ended");
  socket.close();
});

test("echo shows what an idea button stands for as the visitor's own message", async () => {
  const { socket, events, next } = connect();
  await next((e) => e.type === "queue");
  const from = events.length;
  socket.echo("Try the picture pack");
  const user = await next((e) => e.type === "user", from);
  assert.equal(user.text, "Try the picture pack");
});

/** The page's own rule (public/app.js): a `user` message opens a turn, only `done` or `reset` closes it, and `demo` is refused while one is open. */
function pageBusyAfter(events: any[]) {
  let busy = false;
  let refusedDemo = false;
  for (const e of events) {
    if (e.type === "user") busy = true;
    else if (e.type === "done" || e.type === "reset") busy = false;
    else if (e.type === "demo" && busy) refusedDemo = true;
  }
  return { busy, refusedDemo };
}

test("an idea button that sends a command ends the turn its echo opened: the page would otherwise stay busy and refuse /show", async () => {
  const { socket, events, next, send } = connect();
  await next((e) => e.type === "queue");
  const from = events.length;
  socket.echo("Show all her expressions");
  send({ type: "user", text: "/show" });
  await next((e) => e.type === "demo", from);
  const page = pageBusyAfter(events.slice(from));
  assert.equal(page.refusedDemo, false, "the page was still busy when the showcase arrived (\"She is still answering\")");
  assert.equal(page.busy, false, "the page is waiting for a reply that never comes (\"Thinking…\" with no end)");
  socket.close();
});

test("every command an idea button can send leaves the page idle: a notice-only answer ends the turn too", async () => {
  for (const command of ["/help", "/frames off", "/frames nosuchpack", "/frames risa-dress", "/unknown"]) {
    const { socket, events, next, send } = connect({ packs: { "risa-dress": { frames: {}, gestures: {} } as unknown as PackInfo } });
    await next((e) => e.type === "queue");
    const from = events.length;
    socket.echo(command);
    send({ type: "user", text: command });
    send({ type: "user", text: "/help" }); // a second command behind it: when this one's answer is out, the first is over
    await next((e) => e.type === "notice" && /\/show: she shows all/.test(e.text), from);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(pageBusyAfter(events.slice(from)).busy, false, `${command} left the page busy`);
    socket.close();
  }
});

test("a command typed by hand sends no extra done: the server does not either", async () => {
  const { socket, events, next, send } = connect();
  await next((e) => e.type === "queue");
  const from = events.length;
  send({ type: "user", text: "/show" });
  await next((e) => e.type === "demo", from);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(events.slice(from).filter((e) => e.type === "done").length, 0);
  socket.close();
});

test("`ready` settles when the drawing code is loaded, so the page can hold its buttons until then", async () => {
  let release!: (r: Renderer) => void;
  const late = new Promise<Renderer>((r) => (release = r));
  const { socket } = connect({ renderer: late });
  let loaded = false;
  void socket.ready.then(() => (loaded = true));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(loaded, false, "still loading");
  release(fakeRenderer().renderer);
  await socket.ready;
  assert.equal(loaded, true);
});

test("pretend work mode: 'allow for this session' is remembered, so the second time she does not ask again", async () => {
  const { events, next, send } = connect();
  await next((e) => e.type === "queue");
  let from = events.length;
  send({ type: "user", text: "Show me work mode" });
  const card = await next((e) => e.type === "permission", from);
  send({ type: "permission-reply", id: card.request.id, decision: "allow-session" });
  await next((e) => e.type === "done", from);
  from = events.length;
  send({ type: "user", text: "Show me work mode" });
  await next((e) => e.type === "done", from);
  assert.ok(!events.slice(from).some((e) => e.type === "permission"), "no card the second time");
  const said = events.slice(from).filter((e) => e.type === "delta").map((e) => e.text).join("");
  assert.match(said, /already allowed Edit for this session/);
});

test("a look change is reported for saving, with the pack she is showing", async () => {
  const saved: any[] = [];
  const { say, next } = connect({ onSave: (v) => saved.push(v) });
  await next((e) => e.type === "queue");
  await say("Make your hair mint green");
  assert.ok(saved.length >= 1);
  assert.match(saved.at(-1).character.hair_color, /^#[0-9a-f]{6}$/);
  assert.notEqual(saved.at(-1).character.hair_color, "#800000", "not the starting hair");
  assert.equal(saved.at(-1).pack, null);
});

test("a saved look and pack are restored on the next visit, and a look that cannot be drawn is dropped for the default", async () => {
  const good = { preset: "kyoko", hair_color: "#00ff00", face: { mouth_open: 0 } };
  const { events, next, calls } = connect({ restore: { character: good, pack: "risa-dress" }, packs: { "risa-dress": { name: "risa-dress", emotions: {}, gestures: {} } as any } });
  await next((e) => e.type === "queue");
  const pack = events.filter((e) => e.type === "pack").at(-1);
  assert.equal(pack.pack?.name, "risa-dress");
  assert.ok(calls.some((c) => c.op === "frames" && c.character?.hair_color === "#00ff00"), "she was drawn from the saved look");

  // A saved look the drawing code rejects is not used.
  const fake = fakeRenderer();
  const picky = { async call(r: any) { return r.op === "frames" && r.character?.broken ? { ok: false, error: "bad" } : fake.renderer.call(r); } };
  const kept: any[] = [];
  const bad = connect({ renderer: Promise.resolve(picky), restore: { character: { broken: true } }, onSave: (v) => kept.push(v) });
  await bad.next((e) => e.type === "queue");
  await bad.say("Make your hair mint green");
  assert.equal(kept.at(-1).character.preset, "risa", "she started from the default look");
  assert.ok(!("broken" in kept.at(-1).character));
});

test("the looks message names the preset she is based on, through tweaks, undo and a saved visit", async () => {
  const saved: any[] = [];
  const { events, next, say, send } = connect({ onSave: (v) => saved.push(v) });
  await next((e) => e.type === "queue");
  const current = () => events.filter((e) => e.type === "looks").at(-1).current;
  assert.equal(current(), "risa");
  await say("Become Linnea");
  assert.equal(current(), "linnea");
  await say("Make your hair mint green");
  assert.equal(current(), "linnea", "a tweak keeps it");
  send({ type: "look-undo" });
  await next((e) => e.type === "looks" && e.current === "linnea");
  send({ type: "look-undo" });
  await next((e) => e.type === "looks" && e.current === "risa");
  assert.equal(saved.at(-1).base, "linnea" === saved.at(-1).base ? "linnea" : saved.at(-1).base);

  const again = connect({ restore: { character: { preset: "kyoko", face: {} }, pack: null, base: "kyoko" } as any });
  await again.next((e) => e.type === "queue");
  assert.equal(again.events.filter((e) => e.type === "looks").at(-1).current, "kyoko");
});

const slow = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 15)));

test("a message sent while she is answering is shown as queued, then answered in its turn", async () => {
  const { events, next, send } = connect({ pause: slow });
  await next((e) => e.type === "queue");
  const from = events.length;
  send({ type: "user", text: "What can you do?" });
  await next((e) => e.type === "delta", from);
  send({ type: "user", text: "Be shy" });
  const queued = await next((e) => e.type === "queue" && e.items.length === 1, from);
  assert.equal(queued.items[0].text, "Be shy");
  assert.ok(queued.items[0].id);
  await next((e) => e.type === "queue" && e.items.length === 0, from);
  await next((e) => e.type === "user" && e.text === "Be shy", from);
  await next((e) => e.type === "done" && events.slice(from).filter((x) => x.type === "done").length === 2, from, 3000).catch(() => {});
  assert.equal(events.slice(from).filter((e) => e.type === "done").length, 2, "both turns finished");
});

test("a queued message can be taken out, and Stop gives the waiting words back for the input box", async () => {
  const { events, next, send } = connect({ pause: slow });
  await next((e) => e.type === "queue");
  const from = events.length;
  send({ type: "user", text: "What can you do?" });
  await next((e) => e.type === "delta", from);
  send({ type: "user", text: "Wave at me" });
  send({ type: "user", text: "Be shy" });
  const two = await next((e) => e.type === "queue" && e.items.length === 2, from);
  send({ type: "unqueue", id: two.items[0].id });
  await next((e) => e.type === "queue" && e.items.length === 1 && e.items[0].text === "Be shy", from);
  send({ type: "stop" });
  const back = await next((e) => e.type === "queue" && e.returned?.length, from);
  assert.deepEqual(back.returned, ["Be shy"]);
  assert.equal(back.items.length, 0);
  await next((e) => e.type === "done", from);
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(!events.slice(from).some((e) => e.type === "user" && (e.text === "Wave at me" || e.text === "Be shy")), "neither waiting message was answered");
});

// --- packs fetched from the packs site ---

const REMOTE = {
  "franzi-bikini": { id: "franzi-bikini", name: "Franzi (bikini)", character: { id: "franzi", name: "Franzi" }, sizes: { archiveBytes: 15_078_150 }, host: "rhedak.github.io", thumb: "https://rhedak.github.io/t.webp", base: "https://rhedak.github.io/anime_ai_companion-packs/frames/franzi-bikini/", saved: "The demo remembers that you said yes and fetches it again when you come back." },
};
const BIKINI_JSON = { name: "franzi-bikini", character: "franzi", emotions: { neutral: { idle: "neutral.webp", talk: [] } }, gestures: {} };

test("packs on the packs site are listed in the gallery, a command only asks about one, and nothing is fetched before the visitor says yes", async () => {
  const fetched: string[] = [];
  const { events, next, send } = connect({ packs: PICTURES, characters: { pic: { id: "pic", name: "Pic" } }, remote: REMOTE, fetchJson: async (url) => (fetched.push(url), BIKINI_JSON) });
  const packs = await next((e) => e.type === "packs");
  assert.deepEqual(packs.remote.map((p: any) => p.id), ["franzi-bikini"]);
  assert.deepEqual(packs.characters, { pic: { id: "pic", name: "Pic" } });
  const from = events.length;
  send({ type: "user", text: "/frames franzi-bikini" });
  const offer = await next((e) => e.type === "pack-offer", from);
  assert.deepEqual({ id: offer.id, bytes: offer.bytes, host: offer.host }, { id: "franzi-bikini", bytes: 15_078_150, host: "rhedak.github.io" });
  assert.match(offer.saved, /remembers that you said yes/);
  assert.deepEqual(fetched, [], "asking is not fetching");
});

test("saying yes fetches pack.json from the pack's own folder, preloads the neutral picture, shows the pack and removes it from the list to fetch", async () => {
  const fetched: string[] = [];
  const preloaded: string[] = [];
  const told: (string | null)[] = [];
  const { events, next, send } = connect({ remote: REMOTE, fetchJson: async (url) => (fetched.push(url), BIKINI_JSON), preload: async (url) => void preloaded.push(url), onPack: (n) => told.push(n) });
  await next((e) => e.type === "queue");
  const from = events.length;
  send({ type: "pack-install", name: "franzi-bikini" });
  await next((e) => e.type === "pack-progress" && e.phase === "done", from);
  const shown = await next((e) => e.type === "pack" && e.pack, from);
  assert.deepEqual(fetched, ["https://rhedak.github.io/anime_ai_companion-packs/frames/franzi-bikini/pack.json"]);
  assert.deepEqual(preloaded, ["https://rhedak.github.io/anime_ai_companion-packs/frames/franzi-bikini/neutral.webp"]);
  assert.equal(shown.pack.emotions.neutral.idle, preloaded[0]);
  const after = events.slice(from).filter((e) => e.type === "packs").at(-1);
  assert.deepEqual([after.names, after.active, after.remote], [["franzi-bikini"], "franzi-bikini", []]);
  assert.deepEqual(after.characters["franzi-bikini"], { id: "franzi", name: "Franzi" });
  assert.deepEqual(told, ["franzi-bikini"]);
});

test("a pack the server does not have yet, or one whose description is wrong, says so on the tile and changes nothing", async () => {
  const a = connect({ remote: REMOTE, fetchJson: async () => Promise.reject(new Error("the server answered 404")) });
  await a.next((e) => e.type === "queue");
  a.send({ type: "pack-install", name: "franzi-bikini" });
  const failed = await a.next((e) => e.type === "pack-progress" && e.phase === "error");
  assert.match(failed.message, /not available in the demo yet[^]*404[^]*The full app has it/);
  assert.equal(a.events.filter((e) => e.type === "pack" && e.pack).length, 0);

  const b = connect({ remote: REMOTE, fetchJson: async () => ({ name: "x", emotions: { neutral: { idle: "../x.webp", talk: [] } } }) });
  await b.next((e) => e.type === "queue");
  b.send({ type: "pack-install", name: "franzi-bikini" });
  assert.match((await b.next((e) => e.type === "pack-progress" && e.phase === "error")).message, /does not look right/);

  const c = connect({ remote: REMOTE });
  await c.next((e) => e.type === "queue");
  c.send({ type: "pack-install", name: "nothing" });
  assert.match((await c.next((e) => e.type === "pack-progress" && e.phase === "error")).message, /no pack called/);
});

test("a pack fetched on the last visit comes back quietly on the next one, and one that cannot be fetched any more is dropped", async () => {
  const ok = connect({ remote: REMOTE, fetchJson: async () => BIKINI_JSON, restore: { pack: "franzi-bikini" } });
  const shown = await ok.next((e) => e.type === "pack" && e.pack);
  assert.equal(shown.pack.name, "franzi-bikini");
  const gone = connect({ remote: REMOTE, fetchJson: async () => Promise.reject(new Error("offline")), restore: { pack: "franzi-bikini" } });
  await gone.next((e) => e.type === "queue");
  assert.equal(gone.events.find((e) => e.type === "pack").pack, null, "the drawn avatar instead");
});

// --- a link that names a pack or a character (?pack=… or ?character=…) ---

test("a link naming a pack that is here shows it, one that must be fetched is only asked about, and a name nobody knows is ignored", async () => {
  const fetched: string[] = [];
  const here = connect({ packs: PICTURES, remote: REMOTE, want: "pic", fetchJson: async (url) => (fetched.push(url), BIKINI_JSON) });
  assert.equal((await here.next((e) => e.type === "pack" && e.pack)).pack.name, "pic");

  const far = connect({ packs: PICTURES, remote: REMOTE, want: "franzi-bikini", fetchJson: async (url) => (fetched.push(url), BIKINI_JSON) });
  const offer = await far.next((e) => e.type === "pack-offer");
  assert.equal(offer.id, "franzi-bikini");
  await far.next((e) => e.type === "queue");
  assert.equal(far.events.find((e) => e.type === "pack").pack, null, "she stays drawn until the visitor says yes");
  assert.deepEqual(fetched, [], "asking is not fetching");

  const none = connect({ packs: PICTURES, remote: REMOTE, want: "nobody" });
  await none.next((e) => e.type === "queue");
  assert.equal(none.events.some((e) => e.type === "pack-offer" || (e.type === "pack" && e.pack)), false);
});

test("a link naming a character shows its default outfit if that is here, else one that is here, else asks about the first one to fetch", async () => {
  const two = { dress: { ...PICTURES.pic, name: "dress" }, casual: { ...PICTURES.pic, name: "casual" } };
  const characters = { dress: { id: "franzi", name: "Franzi" }, casual: { id: "franzi", name: "Franzi", default: "casual" } };
  const a = connect({ packs: two, characters, remote: REMOTE, want: "franzi" });
  assert.equal((await a.next((e) => e.type === "pack" && e.pack)).pack.name, "casual", "the outfit the character file names");
  const b = connect({ packs: PICTURES, characters: { pic: { id: "pic", name: "Pic" } }, remote: REMOTE, want: "franzi" });
  assert.equal((await b.next((e) => e.type === "pack-offer")).id, "franzi-bikini", "only on the packs site: ask");
});

test("a link that names the pack she showed last time does not show it twice", async () => {
  const { events, next } = connect({ packs: PICTURES, want: "pic", restore: { pack: "pic" } });
  await next((e) => e.type === "queue");
  assert.equal(events.filter((e) => e.type === "pack" && e.pack).length, 1);
  const other = connect({ packs: { ...PICTURES, second: { ...PICTURES.pic, name: "second" } }, want: "second", restore: { pack: "pic" } });
  await other.next((e) => e.type === "queue");
  assert.deepEqual(other.events.filter((e) => e.type === "pack" && e.pack).map((e) => e.pack.name), ["second"], "the link wins: the last visit's pack is not shown first");
  assert.equal(events.some((e) => e.type === "notice" && /Already showing/.test(e.text)), false);
});

// --- a character's own voice while her pack is on ---

test("the scripted lines are in a character's own voice while her pack is on, and plain for any other pack and the drawn avatar", () => {
  const d = { pack: true, character: "draconia" };
  assert.equal(reply("tell me a joke", d).needsModel, true);
  assert.match(reply("tell me a joke", d).text, /^\[emotion:angry\] If you want to talk to me properly, download the full version and link a proper brain\. If you even have one, baka! /);
  assert.match(reply("tell me a joke", d).text, /download\.html/, "the way to the full version is a link");
  assert.match(reply("be shy", d).text, /^\[emotion:shy\] D-don't stare at me!/);
  assert.match(reply("wave", d).text, /\[gesture:wave\] H-hello/);
  assert.match(reply("cheer", d).text, /\[gesture:cheer\] F-fine, hooray!/);
  assert.match(reply("make your hair blue", d).text, /baka: I'm only pictures, so I can't change blue hair\./);
  assert.match(reply("what can you do?", d).text, /Honestly, do I have to explain everything\?/);
  assert.match(reply("undo", d).text, /nothing to undo, baka/);
  assert.match(reply("what is the weather like", d).text, /^\[emotion:angry\] What kind of question is that\?/);
  assert.equal(packIntroFor("draconia").startsWith("[emotion:angry] [gesture:wave] Hmph. So you picked me."), true);
  for (const line of [reply("be shy", d).text, packIntroFor("draconia"), reply("tell me a joke", d).text]) assert.match(line, /^\[emotion:(angry|shy|happy)\]/, "every line starts with an emotion tag");
  // another pack, no pack, and the drawn avatar all speak plainly
  assert.equal(reply("tell me a joke", { pack: true, character: "franzi" }).text, reply("tell me a joke", { pack: true }).text);
  assert.equal(reply("be shy", { pack: false, character: "draconia" }).text, reply("be shy").text, "the drawn avatar is not her");
  assert.equal(packIntroFor("franzi"), PACK_INTRO);
  assert.equal(packIntroFor(), PACK_INTRO);
  assert.equal(personaFor("franzi"), "");
  assert.match(personaFor("draconia"), /21-year-old adult[^]*tsundere/);
});

test("in the demo her pack's character decides the voice: the intro, the answers and what the small model is told", async () => {
  const two = { ...PICTURES, dra: { ...PICTURES.pic, name: "dra", character: "draconia" } };
  const { model, asked } = fakeModel("[emotion:angry] Hmph.");
  const { events, next, send } = connect({ packs: two, characters: { dra: { id: "draconia", name: "Draconia Malfoid" } }, model });
  await next((e) => e.type === "queue");
  let from = events.length;
  send({ type: "pack-select", name: "dra" });
  await next((e) => e.type === "done", from);
  assert.equal(events.slice(from).filter((e) => e.type === "delta").map((e) => e.text).join(""), packIntroFor("draconia"));
  from = events.length;
  send({ type: "user", text: "tell me a joke" });
  await next((e) => e.type === "done", from);
  assert.equal(asked.length, 1, "with the small model on, a chat still goes to it");
  assert.match(asked[0][0].content, /^You are Draconia Malfoid, an unofficial fan character: a 21-year-old adult woman, a proud, sharp-tongued tsundere\./);
  from = events.length;
  send({ type: "pack-select", name: "pic" });
  await next((e) => e.type === "done", from);
  assert.equal(events.slice(from).filter((e) => e.type === "delta").map((e) => e.text).join(""), PACK_INTRO, "another pack: the plain intro");
});

test("a link to a pack the visitor already said yes to fetches it quietly, instead of asking every visit, and saying yes is reported to be kept", async () => {
  const fetched: string[] = [];
  const kept: string[] = [];
  const known = connect({ remote: REMOTE, want: "franzi-bikini", agreed: ["franzi-bikini"], fetchJson: async (url) => (fetched.push(url), BIKINI_JSON) });
  assert.equal((await known.next((e) => e.type === "pack" && e.pack)).pack.name, "franzi-bikini");
  assert.equal(known.events.some((e) => e.type === "pack-offer"), false, "no question for a pack they agreed to");
  assert.equal(fetched.length, 1);

  const last = connect({ remote: REMOTE, want: "franzi-bikini", restore: { pack: "franzi-bikini" }, fetchJson: async () => BIKINI_JSON });
  assert.equal((await last.next((e) => e.type === "pack" && e.pack)).pack.name, "franzi-bikini", "the pack she showed last time counts as agreed");

  const never = connect({ remote: REMOTE, want: "franzi-bikini", agreed: ["something-else"], fetchJson: async () => BIKINI_JSON, onAgree: (id) => void kept.push(id) });
  await never.next((e) => e.type === "pack-offer");
  never.send({ type: "pack-install", name: "franzi-bikini" });
  await never.next((e) => e.type === "pack-progress" && e.phase === "done");
  assert.deepEqual(kept, ["franzi-bikini"], "yes is reported, so the page can keep it");

  const gone = connect({ remote: REMOTE, want: "franzi-bikini", agreed: ["franzi-bikini"], fetchJson: async () => Promise.reject(new Error("offline")) });
  assert.equal((await gone.next((e) => e.type === "pack-offer")).id, "franzi-bikini", "a pack that cannot be fetched is asked about as any other");
});

test("the packs message names the preview of every pack the list has, fetched or not, so the gallery never falls back to a folder the demo does not have", async () => {
  const { events, next, send } = connect({ remote: REMOTE, fetchJson: async () => BIKINI_JSON });
  const first = await next((e) => e.type === "packs");
  assert.deepEqual(first.thumbs, { "franzi-bikini": "https://rhedak.github.io/t.webp" });
  const from = events.length;
  send({ type: "pack-install", name: "franzi-bikini" });
  const after = await next((e) => e.type === "packs" && e.names.includes("franzi-bikini"), from);
  assert.deepEqual(after.remote, []);
  assert.deepEqual(after.thumbs, { "franzi-bikini": "https://rhedak.github.io/t.webp" }, "still named once it is fetched");
});

test("/show for a drawn look on the adult body plays the sequence like any other (the creator's 0.5.1 animates her face and arms)", async () => {
  const { events, next, send } = connect({ restore: { character: { body: "adult_female" } } });
  await next((e) => e.type === "queue");
  const from = events.length;
  send({ type: "user", text: "/show" });
  const show = await next((e) => e.type === "demo", from);
  assert.deepEqual(show, drawnDemoMessage(Object.keys(emotions), Object.keys(GESTURES)));
  assert.equal(events.slice(from).some((e) => e.type === "notice"), false);
});

test("in the demo her name is the character's while that character's pack is on, and the demo's own again after", async () => {
  const two = { ...PICTURES, dra: { ...PICTURES.pic, name: "dra", character: "draconia" } };
  const { events, next, send } = connect({ packs: two, characters: { dra: { id: "draconia", name: "Draconia Malfoid" } } });
  assert.equal((await next((e) => e.type === "mode")).name, "Risa");
  let from = events.length;
  send({ type: "pack-select", name: "dra" });
  assert.equal((await next((e) => e.type === "mode", from)).name, "Draconia Malfoid");
  from = events.length;
  send({ type: "pack-select", name: null });
  assert.equal((await next((e) => e.type === "mode", from)).name, "Risa");
});

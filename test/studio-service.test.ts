import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readPack } from "../src/frame-pack.ts";
import { createStudioService } from "../src/studio-service.ts";
import { decode, encodePng, makeRaster } from "../src/studio/raster.ts";
import { startFakeBackend } from "./helpers/image-backend.ts";

/** A figure on a clear picture, like a pack's neutral. */
async function neutral(): Promise<Buffer> {
  const r = makeRaster(188, 214, [0, 0, 0, 0]);
  for (let y = 30; y < 200; y++) for (let x = 60; x < 130; x++) r.data.set([200, 40, 50, 255], (y * 188 + x) * 4);
  return encodePng(r);
}

async function setup(options: { backendUrl?: string | null } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "studio-service-"));
  const framesDir = join(dataDir, "frames");
  const fake = await startFakeBackend();
  const settings = { studioBackend: options.backendUrl === undefined ? fake.url : options.backendUrl };
  const sent: Record<string, any>[] = [];
  const said: string[] = [];
  const notes: string[] = [];
  const service = createStudioService({
    dataDir,
    framesDir,
    settings,
    saveSettings: async () => {},
    broadcast: (m) => sent.push(m as Record<string, any>),
    remoteRefusal: () => "only on the computer",
    sources: async () => ["risa-dress"],
    readSource: async (name) => (name === "risa-dress" ? { neutral: await neutral(), talk: [], character: "risa" } : null),
    refreshPacks: async () => {},
    pushNote: (t) => notes.push(t),
  });
  const waitFor = async (type: string, count = 1) => {
    for (let i = 0; i < 400; i++) {
      if (sent.filter((m) => m.type === type).length >= count) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`no ${type} (${count}); got ${sent.map((m) => m.type).join(",")}`);
  };
  const cleanup = async () => {
    service.close();
    await fake.stop();
    await rm(dataDir, { recursive: true, force: true });
  };
  return { dataDir, framesDir, fake, settings, sent, said, notes, service, waitFor, cleanup, say: (t: string) => said.push(t) };
}

test("the studio is off until /studio on, needs a backend that answers, and is refused from a phone", async () => {
  const t = await setup({ backendUrl: null });
  try {
    await t.service.command("on", t.say, false, () => {});
    assert.match(t.said.at(-1) ?? "", /No image backend is set/);
    await t.service.command("backend http://example.com", t.say, false, () => {});
    assert.match(t.said.at(-1) ?? "", /plain http on this computer/);
    await t.service.command("backend http://127.0.0.1:9", t.say, false, () => {});
    await t.service.command("on", t.say, false, () => {});
    assert.match(t.said.at(-1) ?? "", /did not answer/);
    assert.equal(t.service.enabled(), false);
    await t.service.command("backend " + t.fake.url, t.say, false, () => {});
    await t.service.command("on", t.say, true, () => {});
    assert.equal(t.said.at(-1), "only on the computer");
    assert.equal(t.service.enabled(), false);
    // A page message while it is off is refused too.
    const answers: Record<string, any>[] = [];
    await t.service.message({ type: "studio-start", source: "risa-dress", name: "risa-winter", outfit: "a coat" }, (m) => answers.push(m as any), false);
    assert.equal(answers[0].type, "studio-error");
    assert.equal(t.fake.requests.filter((r) => r.path === "/edit").length, 0, "nothing was drawn");
  } finally {
    await t.cleanup();
  }
});

test("a redraw: the question, four pictures, one picked, the whole pack drawn and checked, a picture drawn again, and the pack installed", async () => {
  const t = await setup();
  try {
    const opened: unknown[] = [];
    await t.service.command("on", t.say, false, (m) => opened.push(m));
    assert.match(t.said.at(-1) ?? "", /on, drawing with fake backend, model fake-1 \(MIT\)\. It makes draft packs.*responsible/s);
    assert.deepEqual(opened, [{ type: "studio-open" }]);
    const me: Record<string, any>[] = [];
    const send = (m: unknown) => me.push(m as Record<string, any>);

    await t.service.message({ type: "studio-start", source: "risa-dress", name: "risa-winter", outfit: "a dark green [emotion:sad] winter coat" }, send, false);
    const card = me.find((m) => m.type === "studio-confirm");
    assert.ok(card, "the question comes first");
    assert.match(card.note, /responsible/);
    assert.match(card.note, /risa-winter/);
    assert.equal(card.outfit, "a dark green winter coat", "our own tags are stripped");
    assert.equal(t.fake.requests.filter((r) => r.path === "/edit").length, 0, "nothing is drawn before the yes");

    await t.service.message({ type: "studio-confirm", id: card.id }, send, false);
    await t.waitFor("studio-candidates-done");
    const candidates = t.sent.filter((m) => m.type === "studio-candidate");
    assert.equal(candidates.length, 4);
    assert.ok(candidates.every((c) => String(c.thumb).startsWith("data:image/webp;base64,")));
    const waiting = await t.service.stateMessage();
    assert.equal(waiting.running, null, "the worker is done while she waits for the pick");
    assert.deepEqual([waiting.job?.picking, waiting.candidates.length], [true, 4], "a reloaded page can show the pictures again");
    assert.match(waiting.job?.text ?? "", /Pick the one you like/);

    await t.service.message({ type: "studio-pick", id: card.id, seed: 3 }, send, false);
    await t.waitFor("studio-review");
    const review = t.sent.find((m) => m.type === "studio-review")!;
    assert.equal(review.tiles.length, 11, "seven emotions and four poses to look at");
    assert.ok(review.tiles.every((x: any) => String(x.thumb).startsWith("data:image/webp;base64,")));
    const drawn = t.fake.requests.filter((r) => r.path === "/edit").length;
    assert.ok(drawn >= 4 + 38, `the base pictures and the 38 others were asked for (${drawn})`);
    const out = join(t.dataDir, "studio", card.id, "out");
    assert.equal((await readdir(out)).length, 39, "every picture of a pack");

    // A face edit keeps the base everywhere but the face: the band the fake draws across her middle must not be in `happy`, but is in a pose.
    const [neutralPic, happy, wave] = await Promise.all(["neutral", "happy", "wave-1"].map((n) => decode(join(out, `${n}.webp`))));
    // Below the face (the rows past 40% of her height) a face frame is the neutral picture; a pose has its own.
    const differing = (x: typeof neutralPic, y: typeof neutralPic) => {
      let n = 0;
      for (let i = Math.floor(0.4 * x.h) * x.w; i < x.w * x.h; i++) for (let c = 0; c < 4; c++) if (x.data[i * 4 + c] !== y.data[i * 4 + c]) (n++, (c = 4));
      return n;
    };
    assert.equal(differing(happy, neutralPic), 0, "outside the face, the happy picture is the neutral one");
    assert.ok(differing(wave, neutralPic) > 0, "a pose is a whole-picture edit");
    const mouthArea = (pic: typeof neutralPic) => Array.from(pic.data.subarray((Math.floor(pic.h * 0.23) * pic.w + Math.floor(pic.w * 0.47)) * 4, (Math.floor(pic.h * 0.23) * pic.w + Math.floor(pic.w * 0.47)) * 4 + 4));
    assert.notDeepEqual(mouthArea(happy), mouthArea(neutralPic), "inside the face, the edit is kept");

    // One picture drawn again takes new seeds and the pack is assembled again.
    const before = t.fake.requests.filter((r) => r.path === "/edit").length;
    await t.service.message({ type: "studio-regen", id: card.id, names: ["happy"] }, send, false);
    await t.waitFor("studio-review", 2);
    const redone = t.fake.requests.filter((r) => r.path === "/edit").slice(before);
    assert.ok(redone.length >= 5, "happy and its blink and three mouths were asked for again");
    assert.ok(redone.every((r) => /expression to a warm happy smile|only her eyes|only her mouth/.test(String(r.body.prompt))), "nothing else was");
    assert.ok(redone.every((r) => !/sad|angry|raise/.test(String(r.body.prompt))), "not the sad or angry pictures, not the poses");

    await t.service.message({ type: "studio-accept", id: card.id }, send, false);
    await t.waitFor("studio-installed");
    assert.equal(t.sent.find((m) => m.type === "studio-installed")?.name, "risa-winter");
    const folder = join(t.framesDir, "risa-winter");
    const files = (await readdir(folder)).sort();
    assert.equal(files.length, 39 + 3);
    assert.ok(["NOTICE.md", "credit.txt", "look.txt", "neutral.webp", "thinking-talk3.webp", "wave-2.webp", "cheer-1.webp"].every((f) => files.includes(f)));
    const look = await readFile(join(folder, "look.txt"), "utf8");
    assert.match(look, /^character: risa\n/);
    assert.match(await readFile(join(folder, "NOTICE.md"), "utf8"), /fake-1.*MIT.*responsible/s);
    const pic = await decode(join(folder, "neutral.webp"));
    assert.deepEqual([pic.w, pic.h], [940, 1070]);
    // The pack reads as a pack: every emotion has its blink and three mouths, and the gestures are there.
    const emotions = ["neutral", "happy", "sad", "angry", "surprised", "shy", "thinking"];
    const read = await readPack(t.framesDir, "risa-winter", emotions);
    assert.ok(read.ok, read.ok ? "" : read.reason);
    if (read.ok) {
      for (const e of emotions) assert.ok(read.pack.emotions[e]?.blink && read.pack.emotions[e].talk.length === 3, `${e}: rest, blink and three mouths`);
      assert.deepEqual(Object.keys(read.pack.gestures).sort(), ["cheer", "wave"]);
      assert.equal(read.pack.characterId, "risa");
    }
    assert.ok(t.notes.some((n) => /risa-winter/.test(n)));
    // The job's own files stay in data/studio for a later resume.
    assert.ok((await readdir(join(t.dataDir, "studio", card.id))).includes("job.json"));

    // The same name is not drawn over.
    const again: Record<string, any>[] = [];
    await t.service.message({ type: "studio-start", source: "risa-dress", name: "risa-winter", outfit: "a coat" }, (m) => again.push(m as any), false);
    assert.match(again[0].message, /already a pack called risa-winter/);
  } finally {
    await t.cleanup();
  }
});

test("stopping a job and a backend that fails are told to the page and leave nothing installed", async () => {
  const t = await setup();
  try {
    await t.service.command("on", t.say, false, () => {});
    const me: Record<string, any>[] = [];
    const send = (m: unknown) => me.push(m as Record<string, any>);
    await t.service.message({ type: "studio-start", source: "nobody", name: "x-new", outfit: "a coat" }, send, false);
    assert.match(me.at(-1)?.message, /Pick one of your packs/);
    await t.service.message({ type: "studio-start", source: "risa-dress", name: "../evil", outfit: "a coat" }, send, false);
    assert.match(me.at(-1)?.message, /name can have letters/);
    await t.service.message({ type: "studio-start", source: "risa-dress", name: "x-new", outfit: "a" }, send, false);
    assert.match(me.at(-1)?.message, /few words/);

    await t.service.message({ type: "studio-start", source: "risa-dress", name: "x-new", outfit: "a coat" }, send, false);
    const card = me.find((m) => m.type === "studio-confirm");
    await t.service.message({ type: "studio-confirm", id: card?.id }, send, false);
    await t.service.message({ type: "studio-cancel" }, send, false);
    assert.ok(t.sent.some((m) => m.type === "studio-cancelled"));
    assert.equal((await t.service.stateMessage()).running, null);
    await t.service.message({ type: "studio-pick", id: card?.id, seed: 1 }, send, false);
    assert.match(me.at(-1)?.message, /not available/);
    assert.deepEqual(await readdir(t.framesDir).catch(() => []), []);

    await t.service.command("off", t.say, false, () => {});
    assert.equal(t.service.enabled(), false);
  } finally {
    await t.cleanup();
  }
});

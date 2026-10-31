import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { readPack } from "../src/frame-pack.ts";
import { readEdits } from "../src/pack-edits.ts";
import { createStudioService } from "../src/studio-service.ts";
import { decode, encodePng, makeRaster } from "../src/studio/raster.ts";
import { startFakeBackend, type FakeBackend } from "./helpers/image-backend.ts";
import { removeDir } from "./helpers/platform.ts";
import { writeStandIn } from "./helpers/standin.ts";

/** A figure on a clear picture, like a pack's neutral. */
async function neutral(): Promise<Buffer> {
  const r = makeRaster(188, 214, [0, 0, 0, 0]);
  for (let y = 30; y < 200; y++) for (let x = 60; x < 130; x++) r.data.set([200, 40, 50, 255], (y * 188 + x) * 4);
  return encodePng(r);
}

/** The neutral with her mouth open: a pale patch where the typical mouth is (the pack has no blink to learn from, so the studio uses typical proportions). */
async function mouthOpen(): Promise<Buffer> {
  const r = await decode(await neutral());
  for (let y = 50; y < 56; y++) for (let x = 85; x < 100; x++) r.data.set([250, 250, 250, 255], (y * r.w + x) * 4);
  return encodePng(r);
}

async function setup(options: { backendUrl?: string | null; again?: { dataDir: string; fake: FakeBackend }; delayMs?: number; xai?: boolean; budget?: number; noWeights?: boolean; brain?: string; chromeOn?: boolean; mouth?: boolean; env?: NodeJS.ProcessEnv; hubDir?: string } = {}) {
  // `again`: a second server on the same data folder and the same backend, as after a restart.
  const dataDir = options.again?.dataDir ?? (await mkdtemp(join(tmpdir(), "studio-service-")));
  const framesDir = join(dataDir, "frames");
  // An installed pack to draw one picture of again: its pictures and its text files, as on disk.
  const packFolder = join(dataDir, "source-pack");
  await mkdir(packFolder, { recursive: true });
  await writeFile(join(packFolder, "neutral.webp"), await neutral());
  await writeFile(join(packFolder, "NOTICE.md"), "the terms of the source pack\n");
  await writeFile(join(packFolder, "credit.txt"), "risa-dress: a test pack\n");
  await writeFile(join(packFolder, ".pack-install.json"), "{\"sha256\":\"x\"}\n");
  const fake = options.again?.fake ?? (await startFakeBackend({ delayMs: options.delayMs, xai: options.xai ? {} : undefined, noWeights: options.noWeights }));
  const settings: { studioBackend: string | null; studioBudgetUsd?: number; studioPython?: string | null; studioServer?: string | null } = { studioBackend: options.backendUrl === undefined ? fake.url : options.backendUrl, studioBudgetUsd: options.budget };
  const sent: Record<string, any>[] = [];
  const said: string[] = [];
  const notes: string[] = [];
  const mode = { value: "chat" as "chat" | "work" };
  const active = { value: null as string | null };
  const drawn = { value: null as string | null };
  const service = createStudioService({
    mode: () => mode.value,
    activeSource: () => active.value,
    drawnSource: () => drawn.value,
    dataDir,
    framesDir,
    settings,
    saveSettings: async () => {},
    broadcast: (m) => sent.push(m as Record<string, any>),
    remoteRefusal: () => "only on the computer",
    sources: async () => ["risa-dress"],
    characters: async (names) => Object.fromEntries(names.filter((n) => n.startsWith("risa-")).map((n) => [n, { id: "risa", name: "Risa" }])),
    readSource: async (name) => (name === "risa-dress" ? { neutral: await neutral(), talk: options.mouth ? [await mouthOpen()] : [], character: "risa" } : null),
    refreshPacks: async () => {},
    pushNote: (t) => notes.push(t),
    brain: () => options.brain ?? "claude",
    chromeOn: () => options.chromeOn ?? true,
    env: options.env ?? {},
    // As the app finds a pack: the user's own copy in data/frames first, else the one that comes with the app (the folder above, outside data/frames).
    packFolder: async (name) => (name !== "risa-dress" ? null : (await stat(join(framesDir, name)).then(() => true, () => false)) ? join(framesDir, name) : packFolder),
    hubDir: options.hubDir ?? join(dataDir, "no-hub"),
  });
  const waitFor = async (type: string, count = 1) => {
    // Up to three minutes: a whole pack is drawn in the test, and a full run is slow.
    for (let i = 0; i < Number(process.env.STUDIO_TEST_WAIT_LOOPS ?? 7200); i++) {
      if (sent.filter((m) => m.type === type).length >= count) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`no ${type} (${count}); got ${sent.map((m) => m.type).join(",")}${sent.filter((m) => m.type === "studio-error").map((m) => ` [error: ${m.message}]`).join("")}`);
  };
  const cleanup = async () => {
    service.close();
    if (options.again) return; // the first server owns the backend and the folder
    await fake.stop();
    removeDir(dataDir);
  };
  return { dataDir, framesDir, fake, settings, sent, said, notes, service, waitFor, cleanup, mode, active, drawn, say: (t: string) => said.push(t) };
}

test("the studio is off until /studio on, needs a backend that answers, and is refused from a phone", async () => {
  const t = await setup({ backendUrl: null });
  try {
    await t.service.command("on", t.say, false, () => {});
    assert.match(t.said.at(-1) ?? "", /No image maker is chosen yet/);
    await t.service.command("backend http://example.com", t.say, false, () => {});
    assert.match(t.said.at(-1) ?? "", /plain http on this computer/);
    await t.service.command("backend http://127.0.0.1:9", t.say, false, () => {});
    await t.service.command("on", t.say, false, () => {});
    assert.match(t.said.at(-1) ?? "", /did not answer/);
    assert.equal(t.service.enabled(), true, "it opens anyway, so the Image maker list can choose another maker");
    await t.service.command("off", t.say, false, () => {});
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

    // The pointer over a small picture asks for the full-size one: of this job, by a name it can have, and nothing else.
    const asked: Record<string, any>[] = [];
    const ask = (id: string, name: string) => t.service.message({ type: "studio-full", id, name }, (m: unknown) => asked.push(m as Record<string, any>), false);
    await ask(card.id, "seed-3");
    await ask(card.id, "../../job");
    await ask(card.id, "seed-99");
    await ask("job-other", "seed-3");
    assert.equal(asked.length, 1, "only the picture that exists, of the job that is open");
    assert.equal(asked[0].name, "seed-3");
    assert.ok(String(asked[0].image).startsWith("data:image/webp;base64,"));
    const bigger = await decode(Buffer.from(String(asked[0].image).split(",")[1], "base64"));
    assert.ok(bigger.w > 240, `full size, not the thumbnail (${bigger.w} wide)`);

    await t.service.message({ type: "studio-pick", id: card.id, seed: 3 }, send, false);
    await t.waitFor("studio-review");
    const review = t.sent.find((m) => m.type === "studio-review")!;
    // The pictures of the review reach the page one by one while the rest is drawn: in plan order, each before the review itself.
    const previewNames = t.sent.filter((m) => m.type === "studio-preview").map((m) => m.name);
    const firsts = [...new Set(previewNames)];
    assert.deepEqual(firsts.slice(0, 11), ["neutral", "happy", "sad", "angry", "surprised", "shy", "thinking", "wave-1", "wave-2", "cheer-1", "cheer-2"]);
    assert.ok(t.sent.findIndex((m) => m.type === "studio-preview" && m.name === "cheer-2") < t.sent.findIndex((m) => m.type === "studio-review"));
    assert.ok(t.sent.filter((m) => m.type === "studio-preview").every((m) => String(m.thumb).startsWith("data:image/webp;base64,")));
    asked.length = 0;
    await ask(card.id, "happy");
    assert.equal(asked.length, 1, "a review picture can be enlarged too");
    assert.ok((await decode(Buffer.from(String(asked[0].image).split(",")[1], "base64"))).w > 180);

    assert.ok(review.tiles.length >= 11 && review.tiles.length <= 19, "seven emotions and four poses to look at, and at most eight flagged blinks or mouths");
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

    // She is told about the studio once, in chat, with the packs she can draw from; and told what the checks found.
    assert.match(t.service.note() ?? "", /pack studio is on.*Packs you can draw from: risa-dress/s);
    assert.equal(t.service.note(), null, "once per conversation");
    assert.ok(t.notes.some((n) => /finished drawing "risa-winter".*(Checks that still failed|Every picture passed)/s.test(n)), "the report reaches her");

    // Her proposals fill the form and nothing more; a bad name, a work-mode reply and a studio that is off are ignored.
    const proposals = () => t.sent.filter((m) => m.type === "studio-proposal");
    const apply = t.service.makeApplier();
    apply('Here: [studio redraw="happy, nonsense, wave-1"] done');
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual([proposals().length, proposals()[0]?.redraw, proposals()[0]?.job], [1, ["happy", "wave-1"], card.id], "only pictures the pack has, and only while a review is open");
    apply('Here: [studio redraw="happy, nonsense, wave-1"] done');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(proposals().length, 1, "the same tag is not applied twice by the same reply");
    t.mode.value = "work";
    t.service.makeApplier()('[studio redraw="sad"]');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(proposals().length, 1, "work mode: a file she reads could talk her into it");
    t.mode.value = "chat";
    t.service.makeApplier()('[studio redraw="cheer, thinking-talk3"]');
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(proposals().at(-1)?.redraw, ["cheer-1", "cheer-2", "thinking-talk3"], "a pose's own name means all its pictures, exact names stay");
    t.service.forgetTold();
    assert.match(t.service.note() ?? "", /pack studio is on/, "a new conversation is told again");

    // A form that fails does not drop the review that is open.
    await t.service.message({ type: "studio-start", source: "risa-dress", name: "risa-other", outfit: "x" }, send, false);
    assert.match(me.at(-1)?.message ?? "", /Describe the outfit/);
    assert.ok((await t.service.stateMessage()).review, "the review is still there");

    // One picture drawn again takes new seeds and the pack is assembled again.
    const before = t.fake.requests.filter((r) => r.path === "/edit").length;
    await t.service.message({ type: "studio-regen", id: card.id, names: ["happy"] }, send, false);
    await t.waitFor("studio-review", 2);
    const redone = t.fake.requests.filter((r) => r.path === "/edit").slice(before);
    assert.ok(redone.length >= 5, "happy and its blink and three mouths were asked for again");
    assert.ok(redone.every((r) => /expression to a warm happy smile|only her eyes|only her mouth/.test(String(r.body.prompt))), "nothing else was");
    assert.ok(redone.every((r) => !/sad|angry|raise/.test(String(r.body.prompt))), "not the sad or angry pictures, not the poses");

    // The same seed: the picture drawn again is asked with the seed it had, so its composition stays.
    const recordedSeed = JSON.parse(await readFile(join(t.dataDir, "studio", card.id, "frames.json"), "utf8")).happy.seed;
    const askedBefore = t.fake.requests.filter((r) => r.path === "/edit").length;
    await t.service.message({ type: "studio-regen", id: card.id, names: ["happy"], sameSeed: true }, send, false);
    await t.waitFor("studio-review", 3);
    const same = t.fake.requests.filter((r) => r.path === "/edit").slice(askedBefore);
    const sameHappy = same.find((r) => /warm happy smile/.test(String(r.body.prompt)));
    assert.ok(sameHappy, "happy was asked for again");
    assert.equal(sameHappy?.body.seed, recordedSeed, "with the seed it had");

    await t.service.message({ type: "studio-accept", id: card.id }, send, false);
    await t.waitFor("studio-installed");
    assert.equal(t.sent.find((m) => m.type === "studio-installed")?.name, "risa-winter");
    const folder = join(t.framesDir, "risa-winter");
    const files = (await readdir(folder)).sort();
    assert.equal(files.length, 39 + 4);
    assert.ok(["NOTICE.md", "PROCESS.md", "credit.txt", "look.txt", "neutral.webp", "thinking-talk3.webp", "wave-2.webp", "cheer-1.webp"].every((f) => files.includes(f)));
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

test("a job that was left (waiting for a pick, or for the review) can be carried on after a restart", async () => {
  const first = await setup();
  try {
    await first.service.command("on", first.say, false, () => {});
    const me: Record<string, any>[] = [];
    const send = (m: unknown) => me.push(m as Record<string, any>);
    await first.service.message({ type: "studio-start", source: "risa-dress", name: "risa-snow", outfit: "a white winter coat" }, send, false);
    const card = me.find((m) => m.type === "studio-confirm");
    await first.service.message({ type: "studio-confirm", id: card?.id }, send, false);
    await first.waitFor("studio-candidates-done");
    first.service.close(); // the server goes away

    const second = await setup({ again: first });
    try {
      await second.service.command("on", second.say, false, () => {});
      let state = await second.service.stateMessage();
      assert.deepEqual(state.resumable, [{ id: card?.id, name: "risa-snow", outfit: "a white winter coat", stage: "pick" }]);
      await second.service.message({ type: "studio-resume", id: card?.id }, send, false);
      state = await second.service.stateMessage();
      assert.deepEqual([state.job?.picking, state.candidates.length], [true, 4], "the four pictures are there again");
      await second.service.message({ type: "studio-pick", id: card?.id, seed: 2 }, send, false);
      await second.waitFor("studio-review");

      // And once the pack is drawn, a third start finds it ready to review, and rebuilds the review from the pictures on disk.
      second.service.close();
      const third = await setup({ again: first });
      try {
        await third.service.command("on", third.say, false, () => {});
        assert.equal((await third.service.stateMessage()).resumable[0]?.stage, "review");
        const before = first.fake.requests.length;
        await third.service.message({ type: "studio-resume", id: card?.id }, send, false);
        await third.waitFor("studio-review");
        assert.equal(first.fake.requests.length, before, "nothing is drawn again for a review");
        const shown = third.sent.find((m) => m.type === "studio-review")?.tiles.length;
        assert.ok(shown >= 11 && shown <= 19);
        await third.service.message({ type: "studio-accept", id: card?.id }, send, false);
        await third.waitFor("studio-installed");
        assert.equal((await readdir(join(first.framesDir, "risa-snow"))).length, 43);
        assert.deepEqual((await third.service.stateMessage()).resumable, [], "an installed job is not offered again");
      } finally {
        await third.cleanup();
      }
    } finally {
      await second.cleanup();
    }
  } finally {
    await first.cleanup();
  }
});

test("a paid backend: the warning comes before anything is drawn, what the base pictures cost is shown before the pick, and the limit stops the job", async () => {
  const saved = { key: process.env.XAI_API_KEY, base: process.env.COMPANION_XAI_BASE };
  process.env.XAI_API_KEY = "xai-secret-key-1234567890";
  const me: Record<string, any>[] = [];
  const send = (m: unknown) => me.push(m as Record<string, any>);
  const t = await setup({ backendUrl: "xai", xai: true, budget: 5 });
  const poor = await setup({ backendUrl: "xai", xai: true, budget: 0.05 });
  try {
    process.env.COMPANION_XAI_BASE = t.fake.url;
    await t.service.command("on", t.say, false, () => {});
    assert.match(t.said.at(-1) ?? "", /THIS IS PAID.*\$5\.00 per pack.*your responsibility/s);
    await t.service.message({ type: "studio-start", source: "risa-dress", name: "risa-paid", outfit: "a red scarf" }, send, false);
    const card = me.find((m) => m.type === "studio-confirm");
    assert.match(card?.note, /THIS IS PAID.*never saves it/s);
    assert.deepEqual(card?.paid?.limit, 5);
    assert.equal(t.fake.requests.length, 0, "nothing is sent before the yes");
    await t.service.message({ type: "studio-confirm", id: card?.id }, send, false);
    await t.waitFor("studio-candidates-done");
    const done = t.sent.find((m) => m.type === "studio-candidates-done");
    assert.match(done?.text, /The 4 pictures cost \$0\.08\. Picking one draws about \d+ more.*up to \$/);
    assert.ok(t.sent.filter((m) => m.type === "studio-spend").length >= 4);
    assert.deepEqual((await t.service.stateMessage()).spend, { usd: 0.08, limit: 5 });
    assert.equal(JSON.stringify(t.sent).includes("secret"), false, "the key is nowhere in what the page is sent");

    // A pack whose limit is nearly nothing stops after the third picture.
    process.env.COMPANION_XAI_BASE = poor.fake.url;
    await poor.service.command("on", poor.say, false, () => {});
    const them: Record<string, any>[] = [];
    await poor.service.message({ type: "studio-start", source: "risa-dress", name: "risa-poor", outfit: "a red scarf" }, (m) => them.push(m as any), false);
    await poor.service.message({ type: "studio-confirm", id: them.find((m) => m.type === "studio-confirm")?.id }, (m) => them.push(m as any), false);
    await poor.waitFor("studio-error");
    assert.match(poor.sent.find((m) => m.type === "studio-error")?.message, /spending limit for this pack \(\$0\.05\)/);
    assert.equal(poor.sent.find((m) => m.type === "studio-error")?.retry, "resume", "a job that stopped can be tried again from the page");
    assert.equal(poor.fake.requests.length, 3, "the fourth picture was never asked for");
  } finally {
    if (saved.key === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = saved.key;
    if (saved.base === undefined) delete process.env.COMPANION_XAI_BASE;
    else process.env.COMPANION_XAI_BASE = saved.base;
    await t.cleanup();
    await poor.cleanup();
  }
});

test("the browser backend: the card says what it uses, a picture is drawn through the (stand-in) Chrome agent, and the job goes on like any other", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-browser-"));
  const downloads = join(root, "Downloads");
  await mkdir(downloads);
  const bin = join(root, "bin");
  writeStandIn(
    bin,
    "claude",
    `
const fs = require("fs"), path = require("path");
let task = "";
process.stdin.on("data", (c) => (task += c));
process.stdin.on("end", () => {
  const file = /Upload this file[^:]*: (\\S+)/.exec(task)[1];
  const id = "1437a575-d926-4ec1-a880-" + String(Date.now() % 1e12).padStart(12, "0");
  fs.writeFileSync(path.join(${JSON.stringify(downloads)}, "grok-image-" + id + ".jpg"), fs.readFileSync(file));
  console.log("DONE " + id);
});
`,
  );
  const saved = { path: process.env.PATH, downloads: process.env.COMPANION_BROWSER_DOWNLOADS };
  process.env.PATH = `${bin}${delimiter}${process.env.PATH}`;
  process.env.COMPANION_BROWSER_DOWNLOADS = downloads;
  const t = await setup({ backendUrl: "grok-web" });
  try {
    await t.service.command("on", t.say, false, () => {});
    assert.match(t.said.at(-1) ?? "", /THIS DRIVES YOUR CHROME.*Stay at the computer.*terms.*approve once for the whole pack/s);
    const me: Record<string, any>[] = [];
    const send = (m: unknown) => me.push(m as Record<string, any>);
    await t.service.message({ type: "studio-start", source: "risa-dress", name: "risa-web", outfit: "a red scarf", pictures: 1 }, send, false);
    const card = me.find((m) => m.type === "studio-confirm");
    assert.deepEqual([card?.browser?.site, card?.paid], ["grok.com/imagine", null]);
    assert.match(card?.note, /THIS DRIVES YOUR CHROME/);
    await t.service.message({ type: "studio-confirm", id: card?.id }, send, false);
    await t.waitFor("studio-candidates-done");
    assert.equal(t.sent.filter((m) => m.type === "studio-candidate").length, 1);
    assert.equal(t.fake.requests.length, 0, "the loopback backend was not used");
    assert.deepEqual(await readdir(downloads), [], "the download was picked up");
    assert.deepEqual((await t.service.stateMessage()).spend, null, "nothing is billed");
  } finally {
    process.env.PATH = saved.path;
    if (saved.downloads === undefined) delete process.env.COMPANION_BROWSER_DOWNLOADS;
    else process.env.COMPANION_BROWSER_DOWNLOADS = saved.downloads;
    await t.cleanup();
    await rm(root, { recursive: true, force: true });
  }
});

test("the image makers say whether each can be used now, and why not", async () => {
  const t = await setup({ brain: "ollama", chromeOn: false, env: { OPENAI_API_KEY: "sk-test-value" } });
  try {
    await t.service.command("on", t.say, false, () => {});
    const state = await t.service.stateMessage();
    const by = (value: string) => state.backends.find((b: any) => b.value === value) as any;
    assert.equal(by(t.fake.url).available, true, "a model that answers its /health is usable");
    assert.equal(by("openai").available, true, "a key in the environment is enough");
    assert.equal(by("xai").available, false);
    assert.match(by("xai").reason, /XAI_API_KEY/);
    assert.doesNotMatch(JSON.stringify(state), /sk-test-value/, "the key's value is never sent to the page");
    assert.deepEqual(by("xai").keyNames, ["XAI_API_KEY"], "each paid maker names the variable its key comes from");
    assert.deepEqual(by("gemini").keyNames, ["GEMINI_API_KEY", "GOOGLE_API_KEY"]);
    assert.equal(by("xai").cost, "per-picture");
    assert.equal(by("grok-web").cost, "allowance");
    assert.equal(by(t.fake.url).cost, "free");
    assert.equal(by("grok-web").available, false, "a browser maker needs Claude as the brain");
    assert.match(by("grok-web").reason, /Claude as the brain/);
    assert.equal(state.handover, true, "handover needs nothing from this computer");
    const other = await setup({ brain: "claude", chromeOn: false, backendUrl: "http://127.0.0.1:9", env: {} });
    try {
      await other.service.command("on", other.say, false, () => {});
      const again = await other.service.stateMessage();
      assert.match((again.backends.find((b: any) => b.value === "grok-web") as any).reason, /\/chrome/);
      assert.equal((again.backends[0] as any).available, false, "a model that does not answer is not usable");
      assert.match((again.backends[0] as any).reason, /no model answers/);
    } finally {
      await other.cleanup();
    }
  } finally {
    await t.cleanup();
  }
});

test("the page's image maker list: the choices say what they cost, a choice is saved, and nothing odd gets in", async () => {
  const t = await setup();
  try {
    await t.service.command("on", t.say, false, () => {});
    const state = await t.service.stateMessage();
    assert.deepEqual(state.backends.map((b: any) => b.kind), ["local", "paid", "paid", "paid", "browser", "browser", "browser", "assisted"]);
    assert.equal(state.backends[0].value, t.fake.url, "the saved local address is the first choice");
    assert.equal(state.backend, t.fake.url);
    const me: Record<string, any>[] = [];
    const send = (m: unknown) => me.push(m as Record<string, any>);
    await t.service.message({ type: "studio-backend", value: "chatgpt-web" }, send, false);
    assert.equal(t.settings.studioBackend, "chatgpt-web");
    assert.equal((await t.service.stateMessage()).backend, "chatgpt-web");
    assert.equal((await t.service.stateMessage()).backends[0].value, t.fake.url, "the local address stays in the list after a web service is chosen");
    await t.service.message({ type: "studio-backend", value: t.fake.url }, send, false);
    assert.equal(t.settings.studioBackend, t.fake.url);
    for (const bad of ["http://example.com", "xai; rm -rf", 5, "", "grok-web "]) {
      await t.service.message({ type: "studio-backend", value: bad }, send, false);
      assert.match(me.at(-1)?.message ?? "", /not one of the image makers/);
    }
    assert.equal(t.settings.studioBackend, t.fake.url, "nothing odd was saved");
    const phone: Record<string, any>[] = [];
    await t.service.message({ type: "studio-backend", value: "xai" }, (m) => phone.push(m as any), true);
    assert.equal(t.settings.studioBackend, t.fake.url, "a phone cannot choose");
  } finally {
    await t.cleanup();
  }
});

test("the number of first pictures can be one to four, and a value outside that means four", async () => {
  const t = await setup();
  try {
    await t.service.command("on", t.say, false, () => {});
    const me: Record<string, any>[] = [];
    const send = (m: unknown) => me.push(m as Record<string, any>);
    await t.service.message({ type: "studio-start", source: "risa-dress", name: "risa-one", outfit: "a red scarf", pictures: 1 }, send, false);
    const card = me.find((m) => m.type === "studio-confirm");
    assert.equal(card?.pictures, 1);
    await t.service.message({ type: "studio-confirm", id: card?.id }, send, false);
    await t.waitFor("studio-candidates-done");
    assert.equal(t.sent.filter((m) => m.type === "studio-candidate").length, 1);
    assert.equal(t.fake.requests.filter((r) => r.path === "/edit").length, 1);
    await t.service.message({ type: "studio-cancel" }, send, false);
    me.length = 0;
    await t.service.message({ type: "studio-start", source: "risa-dress", name: "risa-many", outfit: "a red scarf", pictures: 9 }, send, false);
    assert.equal(me.find((m) => m.type === "studio-confirm")?.pictures, 4);
  } finally {
    await t.cleanup();
  }
});

test("a job that was left can be deleted, but not while another is open, and not one that is not listed", async () => {
  const first = await setup();
  try {
    await first.service.command("on", first.say, false, () => {});
    const me: Record<string, any>[] = [];
    const send = (m: unknown) => me.push(m as Record<string, any>);
    await first.service.message({ type: "studio-start", source: "risa-dress", name: "risa-gone", outfit: "a red scarf" }, send, false);
    const card = me.find((m) => m.type === "studio-confirm");
    await first.service.message({ type: "studio-confirm", id: card?.id }, send, false);
    await first.waitFor("studio-candidates-done");
    first.service.close();

    const second = await setup({ again: first });
    try {
      await second.service.command("on", second.say, false, () => {});
      await second.service.message({ type: "studio-discard", id: "job-00000000" }, send, false);
      assert.match(me.at(-1)?.message, /not there/);
      await second.service.message({ type: "studio-discard", id: "../../etc" }, send, false);
      assert.match(me.at(-1)?.message, /not there/, "only ids of listed jobs are taken");
      await second.service.message({ type: "studio-discard", id: card?.id }, send, false);
      assert.deepEqual((await second.service.stateMessage()).resumable, []);
      assert.deepEqual((await readdir(join(second.dataDir, "studio")).catch(() => [])).filter((n) => n === card?.id), []);
    } finally {
      await second.cleanup();
    }
  } finally {
    await first.cleanup();
  }
});

test("her proposal for the form is checked against this computer, and nothing starts", async () => {
  const t = await setup();
  try {
    await t.service.command("on", t.say, false, () => {});
    const requests = t.fake.requests.length;
    t.service.makeApplier()('Okay! [studio outfit="a red scarf and a long coat" name="risa-scarf" source="risa-dress" look="You wear a red scarf."]');
    await new Promise((r) => setTimeout(r, 50));
    const first = t.sent.filter((m) => m.type === "studio-proposal").at(-1);
    assert.deepEqual([first?.outfit, first?.name, first?.source, first?.look, first?.redraw], ["a red scarf and a long coat", "risa-scarf", "risa-dress", "You wear a red scarf.", undefined]);
    assert.equal((await t.service.stateMessage()).proposal?.name, "risa-scarf", "a page that reloads shows it again");
    t.service.makeApplier()('[studio outfit="a hat" name="../evil" source="nobody"]');
    await new Promise((r) => setTimeout(r, 50));
    const second = t.sent.filter((m) => m.type === "studio-proposal").at(-1);
    assert.deepEqual([second?.outfit, second?.name, second?.source], ["a hat", undefined, undefined], "a name that is not usable and a pack that is not there are left out");
    assert.equal(t.fake.requests.length, requests, "nothing was drawn");
    // Her proposal names a pack that is not there: the form starts from the pack she is wearing instead.
    t.active.value = "risa-dress";
    t.service.makeApplier()('[studio outfit="a knitted sweater" source="risa-casual-new"]');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(t.sent.filter((m) => m.type === "studio-proposal").at(-1)?.source, "risa-dress");

    // With the studio off, her words wait: the user is asked, nothing opens, and turning it on shows them in the form.
    await t.service.command("off", t.say, false, () => {});
    assert.equal((await t.service.stateMessage()).proposal, null, "turning it off drops what was waiting");
    t.sent.length = 0;
    t.service.makeApplier()('[studio outfit="a long wool coat" name="risa-coat"]');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(t.sent.filter((m) => m.type === "studio-proposal").length, 0, "off: the page is not opened");
    const asked = t.sent.find((m) => m.type === "studio-ask");
    assert.deepEqual([asked?.outfit, asked?.name], ["a long wool coat", "risa-coat"], "the user is asked whether to turn it on, with her words");
    assert.match(t.service.note() ?? "", /exists but is turned off.*asks? the user whether to turn it on/s, "off: she still knows it exists and how to propose");
    assert.equal(t.service.note(), null, "once per state");
    // The yes to the question turns it on: from this computer only, and only when the backend answers.
    const phone: Record<string, any>[] = [];
    await t.service.message({ type: "studio-on" }, (m: unknown) => phone.push(m as Record<string, any>), true);
    assert.equal(t.service.enabled(), false, "a phone cannot say yes");
    assert.equal(phone[0].text, "only on the computer");
    const yes: Record<string, any>[] = [];
    await t.service.message({ type: "studio-on" }, (m: unknown) => yes.push(m as Record<string, any>), false);
    assert.equal(t.service.enabled(), true);
    assert.ok(yes.some((m) => m.type === "studio-open"), "the panel opens");
    const shown = await t.service.stateMessage();
    assert.deepEqual([shown.proposal?.outfit, shown.proposal?.name, shown.proposal?.source, shown.active], ["a long wool coat", "risa-coat", "risa-dress", "risa-dress"], "the form can be filled from the state");
  } finally {
    await t.cleanup();
  }
});

test("the yes to the question needs a backend that answers, and says why when it does not", async () => {
  const t = await setup({ backendUrl: null });
  try {
    const answers: Record<string, any>[] = [];
    await t.service.message({ type: "studio-on" }, (m: unknown) => answers.push(m as Record<string, any>), false);
    assert.equal(t.service.enabled(), true, "the studio opens so that the list can choose a maker");
    assert.match(String(answers.find((m) => m.type === "notice")?.text), /No image maker is chosen yet/);
    assert.ok(answers.some((m) => m.type === "studio-open"));
  } finally {
    await t.cleanup();
  }
});

test("a job stopped part way shows what is already drawn when it is carried on, and stopping is allowed at any moment", async () => {
  const first = await setup({ delayMs: 120 });
  try {
    await first.service.command("on", first.say, false, () => {});
    const me: Record<string, any>[] = [];
    const send = (m: unknown) => me.push(m as Record<string, any>);
    await first.service.message({ type: "studio-start", source: "risa-dress", name: "risa-half", outfit: "a long scarf" }, send, false);
    const card = me.find((m) => m.type === "studio-confirm");
    await first.service.message({ type: "studio-confirm", id: card?.id }, send, false);
    await first.waitFor("studio-candidates-done");
    await first.service.message({ type: "studio-pick", id: card?.id, seed: 1 }, send, false);
    await first.waitFor("studio-preview", 3); // neutral, happy, sad: the pictures of the review come first
    await first.service.message({ type: "studio-cancel" }, send, false);

    const second = await setup({ again: first });
    try {
      await second.service.command("on", second.say, false, () => {});
      assert.equal((await second.service.stateMessage()).resumable[0]?.stage, "build");
      await second.service.message({ type: "studio-resume", id: card?.id }, send, false);
      await second.waitFor("studio-preview", 3);
      const names = second.sent.filter((m) => m.type === "studio-preview").map((m) => m.name);
      assert.deepEqual(names.slice(0, 3), ["neutral", "happy", "sad"], "what exists is shown again at once, in order");
      assert.equal((await second.service.stateMessage()).previews.length >= 3, true, "and a page that reloads gets them from the state");
      await second.service.message({ type: "studio-cancel" }, send, false);
    } finally {
      await second.cleanup();
    }
  } finally {
    await first.cleanup();
  }
});

test("a model on this computer is always in the image maker list, and when it is not there the studio says how to set one up", async () => {
  const t = await setup({ backendUrl: "xai" });
  try {
    const state = await t.service.stateMessage();
    assert.equal(state.backends[0].kind, "local");
    assert.equal(state.backends[0].value, "http://127.0.0.1:7861", "with no address saved it is the reference server's");
    await t.service.command("backend http://127.0.0.1:9", t.say, false, () => {});
    assert.equal((await t.service.stateMessage()).backends[0].value, "http://127.0.0.1:9", "a saved address replaces the default");
    await t.service.command("on", t.say, false, () => {});
    const help = t.said.at(-1) ?? "";
    assert.match(help, /did not answer/);
    assert.match(help, /you need an image model running/);
    assert.match(help, /rhedak\.github\.io\/anime_ai_companion\/local-model\.html/);
    assert.equal(t.service.enabled(), true);
    assert.ok(t.sent.some((m) => m.type === "studio-state" && m.on === true), "and the page is told it is open");
    assert.deepEqual((await t.service.stateMessage()).characters, { "risa-dress": { id: "risa", name: "Risa" } }, "and which character each pack is an outfit of, for the picker");
  } finally {
    await t.cleanup();
  }
});

test("a local server that has no model downloaded gets the same instructions instead of a failed picture", async () => {
  const t = await setup({ noWeights: true });
  try {
    await t.service.command("on", t.say, false, () => {});
    const help = t.said.at(-1) ?? "";
    assert.match(help, /no model downloaded yet/);
    assert.match(help, /local-model\.html/);
    assert.equal(t.service.enabled(), true);
  } finally {
    await t.cleanup();
  }
});

test("/studio handover gives a prompt for any AI agent, with the studio off, and links the guide", async () => {
  const t = await setup({ backendUrl: null });
  try {
    t.active.value = "risa-dress";
    const replies: Record<string, any>[] = [];
    await t.service.command("handover a dark green winter coat over a white sweater", t.say, false, (m) => replies.push(m as Record<string, any>));
    const handover = replies.find((m) => m.type === "studio-handover");
    assert.ok(handover?.inChat, "the prompt goes to the page as its own message, which has the Copy button");
    const said = `${t.said.at(-1) ?? ""}\n${handover?.prompt ?? ""}`;
    assert.match(said, /I use a local anime companion app/);
    assert.match(said, /a dark green winter coat over a white sweater/);
    assert.match(said, /risa-dress/);
    assert.match(said, /agent-guide\.html/);
    assert.match(said, /\/frames dark-green-winter\./);
    assert.equal(t.service.enabled(), false);
    await t.service.command("handover", t.say, true, () => {});
    assert.match(t.said.at(-1) ?? "", /only on the computer/, "a phone gets no handover");
  } finally {
    await t.cleanup();
  }
});

test("with no image maker the studio opens anyway, the list can choose one, and nothing is drawn before a maker works", async () => {
  const t = await setup({ backendUrl: null });
  try {
    const opened: Record<string, any>[] = [];
    await t.service.command("on", t.say, false, (m) => opened.push(m as Record<string, any>));
    assert.ok(opened.some((m) => m.type === "studio-open"));
    assert.match(t.said.at(-1) ?? "", /open anyway: choose another image maker/);
    const me: Record<string, any>[] = [];
    const send = (m: unknown) => me.push(m as Record<string, any>);
    await t.service.message({ type: "studio-start", source: "risa-dress", name: "risa-none", outfit: "a long scarf" }, send, false);
    assert.match(me.at(-1)?.message ?? "", /No image maker is chosen yet/, "drawing still checks the maker first");
    assert.equal(me.some((m) => m.type === "studio-confirm"), false);
    await t.service.command("backend " + t.fake.url, t.say, false, () => {});
    await t.service.message({ type: "studio-start", source: "risa-dress", name: "risa-none", outfit: "a long scarf" }, send, false);
    assert.ok(me.some((m) => m.type === "studio-confirm"), "with a working maker the card comes");
  } finally {
    await t.cleanup();
  }
});

test("/studio handover says what to attach when she is the drawn avatar and there is no pack picture", async () => {
  const t = await setup({ backendUrl: null });
  try {
    t.active.value = null;
    const replies: Record<string, any>[] = [];
    await t.service.command("handover a blue raincoat", t.say, false, (m) => replies.push(m as Record<string, any>));
    const said = t.said.at(-1) ?? "";
    assert.match(said, /She is the drawn avatar now, so there is no picture of her to attach/);
    assert.match(said, /risa-dress/, "the packs she could start from are named");
    assert.match(String(replies.find((m) => m.type === "studio-handover")?.prompt), /a blue raincoat/);
    t.active.value = "risa-dress";
    await t.service.command("handover", t.say, false, () => {});
    assert.doesNotMatch(t.said.at(-1) ?? "", /drawn avatar now/);
  } finally {
    await t.cleanup();
  }
});

test("while she is drawn the form starts from her own character's pack, and a pack she wears wins", async () => {
  const t = await setup();
  try {
    await t.service.command("on", t.say, false, () => {});
    assert.equal((await t.service.stateMessage()).active, null);
    t.drawn.value = "risa-dress";
    assert.equal((await t.service.stateMessage()).active, "risa-dress");
    t.active.value = "franzi-dress";
    assert.equal((await t.service.stateMessage()).active, "franzi-dress");
  } finally {
    await t.cleanup();
  }
});

test("one picture of an installed pack is drawn again: the yes writes a new pack with the rest kept, the no writes nothing", async () => {
  const t = await setup();
  const me: Record<string, any>[] = [];
  const send = (m: unknown) => me.push(m as Record<string, any>);
  try {
    await t.service.command("on", t.say, false, () => {});
    const calls = t.fake.requests.length;
    await t.service.message({ type: "studio-frame-edit", source: "risa-dress", frame: "neutral", prompt: "a red scarf around her neck", name: "risa-red" }, send, false);
    await t.waitFor("studio-frame-review");
    assert.equal(t.fake.requests.length, calls + 1, "the picture was drawn once");
    assert.match(String(t.fake.requests.at(-1)!.body.prompt), /pure (magenta|bright green|cyan) \(#[0-9a-f]{6}\) background/, "the prompt names the colour the picture was put on");
    const review = t.sent.find((m) => m.type === "studio-frame-review")!;
    assert.equal(review.frame, "neutral");
    assert.match(review.old, /^data:image\/webp;base64,/);
    assert.match(review.new, /^data:image\/webp;base64,/);
    assert.equal((await t.service.stateMessage()).frameReview?.id, review.id, "a reload shows the same picture");

    await t.service.message({ type: "studio-frame-accept", id: review.id }, send, false);
    await t.waitFor("studio-frame-installed");
    const folder = join(t.framesDir, "risa-red");
    const files = (await readdir(folder)).sort();
    assert.deepEqual(files, ["EDIT.md", "NOTICE.md", "credit.txt", "neutral.webp"], "the text files are kept, and the install marker is not copied");
    assert.equal((await readFile(join(folder, "NOTICE.md"), "utf8")), "the terms of the source pack\n");
    assert.ok((await readFile(join(folder, "neutral.webp"))).subarray(0, 4).toString() === "RIFF", "the picture is WebP");
    assert.match(await readFile(join(folder, "EDIT.md"), "utf8"), /a red scarf around her neck/);
    assert.equal((await t.service.stateMessage()).frameReview, null, "the review is closed");
    assert.equal(await readFile(join(t.dataDir, "source-pack", "NOTICE.md"), "utf8"), "the terms of the source pack\n", "the source pack is not touched");

    await t.service.message({ type: "studio-frame-edit", source: "risa-dress", frame: "neutral", prompt: "a blue hat", name: "risa-blue" }, send, false);
    await t.waitFor("studio-frame-review", 2);
    const second = t.sent.filter((m) => m.type === "studio-frame-review")[1];
    await t.service.message({ type: "studio-frame-reject", id: second.id }, send, false);
    assert.equal((await t.service.stateMessage()).frameReview, null);
    assert.equal(await stat(join(t.framesDir, "risa-blue")).then(() => true, () => false), false, "a dropped picture writes nothing");
  } finally {
    await t.cleanup();
  }
});

test("one picture drawn again with no new name changes the pack itself: the original is kept, can be put back, and a pack that ships is copied first", async () => {
  const t = await setup();
  const me: Record<string, any>[] = [];
  const send = (m: unknown) => me.push(m as Record<string, any>);
  try {
    await t.service.command("on", t.say, false, () => {});
    const shipped = await readFile(join(t.dataDir, "source-pack", "neutral.webp"));
    await t.service.message({ type: "studio-frame-edit", source: "risa-dress", frame: "neutral", prompt: "a red scarf around her neck", name: "" }, send, false);
    assert.equal(me.find((m) => m.type === "studio-error")?.message, undefined, "nothing refused it");
    await t.waitFor("studio-frame-review");
    const review = t.sent.find((m) => m.type === "studio-frame-review")!;
    assert.equal(review.name, "", "no new name: the review says it changes the pack itself");
    assert.equal(review.shipped, true, "and that this pack comes with the app");
    await t.service.message({ type: "studio-frame-accept", id: review.id }, send, false);
    await t.waitFor("studio-frame-installed");
    const own = join(t.framesDir, "risa-dress");
    assert.deepEqual((await readdir(own)).sort(), [".local-edits.json", ".original", ".pack-install.json", "NOTICE.md", "credit.txt", "neutral.webp"], "a copy of the whole pack is in the user's folder");
    assert.notDeepEqual(await readFile(join(own, "neutral.webp")), shipped, "with the new picture");
    assert.deepEqual(await readFile(join(own, ".original", "neutral.webp")), shipped, "and the old one kept");
    assert.deepEqual(await readFile(join(t.dataDir, "source-pack", "neutral.webp")), shipped, "the pack that ships is not touched");
    assert.deepEqual((await t.service.stateMessage()).edited, { "risa-dress": ["neutral"] }, "the page is told which pictures were changed");

    // Again: the user's own copy is changed in place, and the first original stays the original.
    const once = await readFile(join(own, "neutral.webp"));
    await t.service.message({ type: "studio-frame-edit", source: "risa-dress", frame: "neutral", prompt: "a blue hat", name: "" }, send, false);
    await t.waitFor("studio-frame-review", 2);
    const second = t.sent.filter((m) => m.type === "studio-frame-review")[1];
    assert.equal(second.shipped, false, "now it is the user's own folder");
    await t.service.message({ type: "studio-frame-accept", id: second.id }, send, false);
    await t.waitFor("studio-frame-installed", 2);
    assert.deepEqual(await readFile(join(own, ".original", "neutral.webp")), shipped);
    assert.ok(!(await readFile(join(own, "neutral.webp"))).equals(once), "the second picture replaced the first");

    await t.service.message({ type: "studio-frame-restore", source: "risa-dress", frame: "neutral" }, send, false);
    assert.deepEqual(await readFile(join(own, "neutral.webp")), shipped, "the original is back");
    assert.equal(await stat(join(own, ".local-edits.json")).then(() => true, () => false), false, "with nothing left to remember");
    assert.deepEqual((await t.service.stateMessage()).edited, {});
  } finally {
    await t.cleanup();
  }
});

test("drawing one picture again refuses what it cannot do, and says why", async () => {
  const t = await setup();
  const savedKey = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "xai-test-key-1234567890"; // a paid maker needs a key to be offered; the CI has none
  const me: Record<string, any>[] = [];
  const send = (m: unknown) => me.push(m as Record<string, any>);
  try {
    await t.service.command("on", t.say, false, () => {});
    await t.service.message({ type: "studio-frame-edit", source: "risa-dress", frame: "nope", prompt: "a hat", name: "x-1" }, send, false);
    assert.match(me.at(-1)?.message ?? "", /has no picture called nope/);
    await t.service.message({ type: "studio-frame-edit", source: "risa-dress", frame: "neutral", prompt: "a", name: "x-2" }, send, false);
    assert.match(me.at(-1)?.message ?? "", /Say what to change/);
    await t.service.message({ type: "studio-frame-edit", source: "not-a-pack", frame: "neutral", prompt: "a hat", name: "x-3" }, send, false);
    assert.match(me.at(-1)?.message ?? "", /Pick one of your packs/);
    await t.service.message({ type: "studio-frame-edit", source: "risa-dress", frame: "neutral", prompt: "a hat", name: "../escape" }, send, false);
    assert.match(me.at(-1)?.message ?? "", /can have letters/);
    await t.service.message({ type: "studio-backend", value: "xai" }, send, false);
    await t.service.message({ type: "studio-frame-edit", source: "risa-dress", frame: "neutral", prompt: "a hat", name: "x-4" }, send, false);
    // A paid maker is no longer refused: it is asked about first (the paid test below draws it).
    assert.ok(t.sent.some((m) => m.type === "studio-frame-ask" && /THIS IS PAID/.test(m.note)));
    await t.service.message({ type: "studio-frame-ask-cancel" }, send, false);
    assert.equal((await t.service.stateMessage()).frameAsk, null, "Not now closes the question");
  } finally {
    if (savedKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = savedKey;
    await t.cleanup();
  }
});

test("a local model that does not answer says what is on this computer", async () => {
  const hub = await mkdtemp(join(tmpdir(), "hub-reason-"));
  const t = await setup({ backendUrl: "http://127.0.0.1:9", hubDir: hub });
  try {
    await mkdir(join(hub, "models--Qwen--Qwen-Image-2.1-Turbo", "snapshots", "abc123"), { recursive: true });
    await t.service.command("on", t.say, false, () => {});
    const local = (await t.service.stateMessage()).backends[0] as any;
    assert.equal(local.available, false);
    assert.match(local.reason, /on this computer: Qwen-Image-2\.1-Turbo/);
  } finally {
    await t.cleanup();
    removeDir(hub);
  }
});

test("a pack is exported to a folder and a folder imported as a pack, from this computer only", async () => {
  const t = await setup();
  const me: Record<string, any>[] = [];
  const send = (m: unknown) => me.push(m as Record<string, any>);
  try {
    await t.service.command("on", t.say, false, () => {});
    const out = join(t.dataDir, "out");
    await mkdir(out);
    await t.service.message({ type: "studio-export", source: "risa-dress", folder: out }, send, false);
    assert.match(me.at(-1)!.message, /was copied to/);
    assert.deepEqual((await readdir(join(out, "risa-dress"))).sort(), ["NOTICE.md", "credit.txt", "neutral.webp"], "the install marker is not exported");
    assert.equal(await readFile(join(out, "risa-dress", "NOTICE.md"), "utf8"), "the terms of the source pack\n");
    await t.service.message({ type: "studio-export", source: "risa-dress", folder: out }, send, false);
    assert.equal(me.at(-1)!.type, "studio-error", "an exported folder is not replaced");
    await t.service.message({ type: "studio-export", source: "nope", folder: out }, send, false);
    assert.equal(me.at(-1)!.type, "studio-error");

    await t.service.message({ type: "studio-import", folder: join(out, "risa-dress"), name: "risa-back" }, send, false);
    assert.match(me.at(-1)!.message, /was imported/);
    assert.ok((await readdir(join(t.framesDir, "risa-back"))).includes("neutral.webp"));
    await t.service.message({ type: "studio-import", folder: join(out, "risa-dress"), name: "risa-back" }, send, false);
    assert.equal(me.at(-1)!.type, "studio-error", "an installed pack is not replaced");

    const before = me.length;
    await t.service.message({ type: "studio-export", source: "risa-dress", folder: out }, send, true);
    assert.equal(me.at(-1)!.type, "notice", "a phone is refused");
    assert.equal(me.length, before + 1);
  } finally {
    await t.cleanup();
  }
});

test("/studio python and /studio server save whole paths and the not-answering reason shows the start command", async () => {
  const t = await setup({ backendUrl: "http://127.0.0.1:9", env: {} });
  try {
    await t.service.command("on", t.say, false, () => {});
    const python = join(t.dataDir, "venv-python");
    const server = join(t.dataDir, "my server.py");
    await writeFile(python, "");
    await writeFile(server, "");
    t.said.length = 0;
    await t.service.command("python relative/python", t.say, false, () => {});
    assert.match(t.said.at(-1)!, /whole path/);
    await t.service.command(`python ${join(t.dataDir, "missing")}`, t.say, false, () => {});
    assert.match(t.said.at(-1)!, /not a file/);
    await t.service.command(`python ${python}`, t.say, false, () => {});
    assert.equal(t.settings.studioPython, python);
    await t.service.command(`server ${server}`, t.say, false, () => {});
    assert.match(t.said.at(-1)!, new RegExp(`"${server.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" --port 9`), "a path with a space is quoted, and the port is the address's");
    const reason = ((await t.service.stateMessage()).backends[0] as any).reason as string;
    assert.match(reason, /start it with: .*--port 9/);
    await t.service.command("python none", t.say, false, () => {});
    assert.equal(t.settings.studioPython, null);
    assert.doesNotMatch(((await t.service.stateMessage()).backends[0] as any).reason, /start it with/);
  } finally {
    await t.cleanup();
  }
});

async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

test("the user's own image server is started from the panel only after a card, shows what it prints, and is stopped", async () => {
  const port = await freePort();
  const t = await setup({ backendUrl: `http://127.0.0.1:${port}`, env: { XAI_API_KEY: "sk-secret-value", HF_HUB_CACHE: "/nowhere" } });
  const me: Record<string, any>[] = [];
  const send = (m: unknown) => me.push(m as Record<string, any>);
  try {
    await t.service.command("on", t.say, false, () => {});
    // A stand-in server: node is the "python", the script answers /health on --port and prints its arguments and whether it was given a key.
    const script = join(t.dataDir, "fake server.js");
    await writeFile(
      script,
      `const a = process.argv.slice(2); const port = Number(a[a.indexOf("--port") + 1]);
       console.log("args " + a.join(" ")); console.log("key " + (process.env.XAI_API_KEY ? "leaked" : "none"));
       require("node:http").createServer((q, r) => { r.setHeader("content-type", "application/json"); r.end(JSON.stringify({ ok: true, name: "stand-in", model: "x", edit: true, generate: true })); }).listen(port, "127.0.0.1");`,
    );
    await t.service.message({ type: "studio-local-start" }, send, false);
    assert.match(me.at(-1)!.message, /Python and the server script/, "nothing starts without both paths");
    await t.service.message({ type: "studio-local-config", python: process.execPath, server: script }, send, false);
    assert.equal(t.settings.studioServer, script);
    await t.service.message({ type: "studio-local-start", python: process.execPath, server: join(t.dataDir, "nope.js"), device: "cpu" }, send, false);
    assert.match(me.at(-1)!.message, /not a file/, "paths that come with the start are checked first");
    await t.service.message({ type: "studio-local-start", python: process.execPath, server: script, device: "tpu" }, send, false);
    assert.match(me.at(-1)!.message, /mps, cuda or cpu/);
    await t.service.message({ type: "studio-local-start", device: "cpu" }, send, false);
    let state = (await t.service.stateMessage()).local as any;
    assert.equal(state.status, "stopped", "the card comes first: nothing runs yet");
    assert.equal(state.ask.port, port);
    assert.match(state.ask.command, new RegExp(`--port ${port} --device cpu`));
    await t.service.message({ type: "studio-local-confirm", id: "not-the-id" }, send, false);
    assert.equal(((await t.service.stateMessage()).local as any).status, "stopped", "a wrong id starts nothing");

    await t.service.message({ type: "studio-local-confirm", id: state.ask.id }, send, false);
    state = (await t.service.stateMessage()).local as any;
    assert.equal(state.status, "running");
    assert.equal(state.ask, null);
    assert.ok(state.log.includes(`args --port ${port} --device cpu`), "what it printed is shown");
    assert.ok(state.log.includes("key none"), "a key in the app's environment is not passed on");
    const maker = ((await t.service.stateMessage()).backends[0] as any);
    assert.equal(maker.available, true, "the maker is ready once the server answers");

    await t.service.message({ type: "studio-local-start", device: "cpu" }, send, false);
    assert.match(me.at(-1)!.message, /already running/);
    await t.service.message({ type: "studio-local-stop" }, send, false);
    assert.equal(((await t.service.stateMessage()).local as any).status, "stopped");
    const gone = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) }).then(() => false, () => true);
    assert.equal(gone, true, "stopping ends the process");

    const before = me.length;
    await t.service.message({ type: "studio-local-start", device: "cpu" }, send, true);
    assert.equal(me.at(-1)!.type, "notice", "a phone is refused");
    assert.equal(me.length, before + 1);
  } finally {
    await t.cleanup();
  }
});

test("a server that exits at once is reported as failed with what it printed, and one that already answers is not started over", async () => {
  const port = await freePort();
  const t = await setup({ backendUrl: `http://127.0.0.1:${port}`, env: {} });
  const me: Record<string, any>[] = [];
  const send = (m: unknown) => me.push(m as Record<string, any>);
  try {
    await t.service.command("on", t.say, false, () => {});
    const script = join(t.dataDir, "broken.js");
    await writeFile(script, `console.error("ModuleNotFoundError: No module named 'diffusers'"); process.exit(1);`);
    await t.service.message({ type: "studio-local-config", python: process.execPath, server: script }, send, false);
    await t.service.message({ type: "studio-local-start", device: "cpu" }, send, false);
    const ask = ((await t.service.stateMessage()).local as any).ask;
    await t.service.message({ type: "studio-local-confirm", id: ask.id }, send, false);
    assert.match(me.at(-1)!.message, /exited with code 1/);
    const state = (await t.service.stateMessage()).local as any;
    assert.equal(state.status, "failed");
    assert.ok(state.log.some((l: string) => /No module named 'diffusers'/.test(l)), "the reason is in the log");

    // Something already answers there (the test's own fake backend): nothing is started.
    const other = await setup({ env: {} });
    try {
      await other.service.command("on", other.say, false, () => {});
      await other.service.message({ type: "studio-local-config", python: process.execPath, server: script }, send, false);
      await other.service.message({ type: "studio-local-start", device: "cpu" }, send, false);
      assert.match(me.at(-1)!.message, /already answers/);
      assert.equal(((await other.service.stateMessage()).local as any).ask, null);
    } finally {
      await other.cleanup();
    }
  } finally {
    await t.cleanup();
  }
});

test("one picture with a paid service is asked about first, drawn only on the yes, and costs what the service says", async () => {
  const t = await setup({ backendUrl: "xai", xai: true, budget: 5 });
  const me: Record<string, any>[] = [];
  const send = (m: unknown) => me.push(m as Record<string, any>);
  const previous = process.env.COMPANION_XAI_BASE;
  const savedKey = process.env.XAI_API_KEY;
  try {
    process.env.COMPANION_XAI_BASE = t.fake.url;
    process.env.XAI_API_KEY = "xai-test-key-1234567890"; // the CI has no key
    await t.service.command("on", t.say, false, () => {});
    const calls = t.fake.requests.length;
    await t.service.message({ type: "studio-frame-edit", source: "risa-dress", frame: "neutral", prompt: "a red scarf around her neck", name: "risa-paid-red" }, send, false);
    const ask = t.sent.find((m) => m.type === "studio-frame-ask");
    assert.ok(ask, `a question first (got ${me.map((m) => m.message).join("; ")})`);
    assert.match(ask.note, /THIS IS PAID.*ONE picture|ONE picture.*THIS IS PAID/s);
    assert.doesNotMatch(ask.note, /Making 1 pictures/);
    assert.equal(t.fake.requests.length, calls, "nothing is sent before the yes");
    assert.equal((await t.service.stateMessage()).frameAsk?.id, ask.id, "a reload shows the same question");
    await t.service.message({ type: "studio-frame-edit", source: "risa-dress", frame: "neutral", prompt: "again", name: "other" }, send, false);
    assert.match(me.at(-1)!.message, /Finish or stop/, "one question at a time");

    await t.service.message({ type: "studio-frame-go", id: ask.id }, send, false);
    await t.waitFor("studio-frame-review");
    assert.equal(t.fake.requests.length, calls + 1, "drawn once, after the yes");
    assert.equal((await t.service.stateMessage()).frameAsk, null);
    await t.service.message({ type: "studio-frame-go", id: ask.id }, send, false);
    assert.match(me.at(-1)!.message, /no longer open/, "the yes works once");
  } finally {
    if (previous === undefined) delete process.env.COMPANION_XAI_BASE;
    else process.env.COMPANION_XAI_BASE = previous;
    if (savedKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = savedKey;
    await t.cleanup();
  }
});

test("choosing the image maker with /studio backend tells an open panel", async () => {
  const t = await setup();
  try {
    await t.service.command("on", t.say, false, () => {});
    const before = t.sent.filter((m) => m.type === "studio-state").length;
    await t.service.command("backend gemini-web", t.say, false, () => {});
    await t.waitFor("studio-state", before + 1);
    assert.equal(t.sent.filter((m) => m.type === "studio-state").at(-1)!.backend, "gemini-web");
  } finally {
    await t.cleanup();
  }
});

test("by hand: one picture waits for the user, a bad file is asked for again, a good one is checked like any other, and stopping ends the wait", async () => {
  const t = await setup({ backendUrl: "assisted" });
  const me: Record<string, any>[] = [];
  const send = (m: unknown) => me.push(m as Record<string, any>);
  try {
    await t.service.command("on", t.say, false, () => {});
    assert.equal((await t.service.stateMessage()).backends.find((b: any) => b.value === "assisted")?.available, true, "always listed as ready");
    // The message is answered when the picture is done, and the picture waits for the user: the page's other messages go on meanwhile.
    const first = t.service.message({ type: "studio-frame-edit", source: "risa-dress", frame: "neutral", prompt: "a red scarf around her neck", name: "risa-by-hand" }, send, false);
    first.catch(() => {});
    assert.equal(t.sent.find((m) => m.type === "studio-frame-ask"), undefined, "nothing is sent or paid for, so there is no card");
    await t.waitFor("studio-assist");
    const ask = t.sent.find((m) => m.type === "studio-assist")!;
    assert.match(ask.prompt, /red scarf around her neck/);
    assert.match(ask.prompt, /magenta|green|cyan/, "the prompt names the background colour");
    assert.match(ask.input, /^data:image\/png;base64,/);
    assert.equal((await t.service.stateMessage()).assist?.n, ask.n, "a reload shows the same request");

    // Something that is not a picture: said at once, still waiting.
    await t.service.message({ type: "studio-assist-result", id: ask.id, n: ask.n, image: `data:text/plain;base64,${Buffer.from("hello").toString("base64")}` }, send, false);
    const again = t.sent.filter((m) => m.type === "studio-assist").at(-1)!;
    assert.match(again.error, /not a PNG, JPEG, WebP/);
    // A request for another picture is ignored.
    await t.service.message({ type: "studio-assist-result", id: "someone-else", n: ask.n, image: "x" }, send, false);
    assert.equal(t.sent.filter((m) => m.type === "studio-frame-review").length, 0);

    // A picture, as a drop gives it (a JPEG of another size): cut out, checked and shown for keeping.
    const given = await (await import("sharp")).default({ create: { width: 300, height: 340, channels: 3, background: { r: 255, g: 0, b: 255 } } }).composite([{ input: await (await import("sharp")).default({ create: { width: 80, height: 200, channels: 3, background: { r: 200, g: 40, b: 50 } } }).png().toBuffer(), left: 100, top: 60 }]).jpeg().toBuffer();
    await t.service.message({ type: "studio-assist-result", id: ask.id, n: ask.n, image: `data:image/jpeg;base64,${given.toString("base64")}` }, send, false);
    await t.waitFor("studio-assist-done");
    await first;
    await t.waitFor("studio-frame-review");
    assert.equal((await t.service.stateMessage()).assist, null);
    assert.ok((await readdir(join(t.dataDir, "studio"))).every((n) => !n.endsWith("-draw")), "the working folder is gone");
    await t.service.message({ type: "studio-frame-reject", id: t.sent.find((m) => m.type === "studio-frame-review")!.id }, send, false);

    // Stopping while it waits ends it.
    const asks = t.sent.filter((m) => m.type === "studio-assist").length; // the bad file above was announced again: count from here
    const second = t.service.message({ type: "studio-frame-edit", source: "risa-dress", frame: "neutral", prompt: "a blue hat", name: "risa-by-hand-2" }, send, false);
    await t.waitFor("studio-assist", asks + 1);
    await t.service.message({ type: "studio-cancel" }, send, false);
    await second;
    await t.waitFor("studio-frame-cancelled");
    assert.equal((await t.service.stateMessage()).assist, null);
    assert.equal((await t.service.stateMessage()).frameBusy, false);
  } finally {
    await t.cleanup();
  }
});

test("by hand: a pack's card says what it asks of the user, and the first picture waits for them through the worker", async () => {
  const t = await setup({ backendUrl: "assisted" });
  const me: Record<string, any>[] = [];
  const send = (m: unknown) => me.push(m as Record<string, any>);
  try {
    await t.service.command("on", t.say, false, () => {});
    await t.service.message({ type: "studio-start", source: "risa-dress", name: "risa-hand-pack", outfit: "a green coat", pictures: 1 }, send, false);
    const card = me.find((m) => m.type === "studio-confirm");
    assert.ok(card, `a card (got ${me.map((m) => m.message ?? m.type).join("; ")})`);
    assert.equal(card.assisted?.assisted ?? card.assisted, true);
    assert.match(card.note, /BY HAND/);
    assert.match(card.note, /sends nothing anywhere/);
    assert.doesNotMatch(card.note, /THIS IS PAID|DRIVES YOUR CHROME/);
    await t.service.message({ type: "studio-confirm", id: card.id }, send, false);
    await t.waitFor("studio-assist");
    const ask = t.sent.find((m) => m.type === "studio-assist")!;
    assert.equal(ask.id, card.id, "the request belongs to the job");
    assert.match(ask.prompt, /green coat/);
    // Give it a picture: the first (and only) candidate appears, and the page is told it was received.
    const png = await encodePng(makeRaster(896, 1024, [255, 0, 255, 255]));
    await t.service.message({ type: "studio-assist-result", id: ask.id, n: ask.n, image: `data:image/png;base64,${png.toString("base64")}` }, send, false);
    await t.waitFor("studio-assist-done");
    await t.waitFor("studio-candidate");
    await t.waitFor("studio-candidates-done");
    // The next stage asks for the next picture; stopping the job clears the request.
    const asks = t.sent.filter((m) => m.type === "studio-assist").length;
    await t.service.message({ type: "studio-pick", id: card.id, seed: 1 }, send, false);
    await t.waitFor("studio-assist", asks + 1);
    await t.service.message({ type: "studio-cancel" }, send, false);
    await t.waitFor("studio-cancelled");
    assert.equal((await t.service.stateMessage()).assist, null);
  } finally {
    await t.cleanup();
  }
});

test("an activity is made one picture at a time in a working folder, from any picture, and goes into the pack only on the user's yes", async () => {
  const t = await setup({ mouth: true });
  const me: Record<string, any>[] = [];
  const send = (m: unknown) => me.push(m as Record<string, any>);
  const last = (type: string) => [...t.sent].reverse().find((m) => m.type === type)!;
  const add = async (from: string, prompt: string) => {
    const count = t.sent.filter((m) => m.type === "studio-frame-review").length;
    await t.service.message({ type: "studio-activity-draw", id: draft, from, prompt }, send, false);
    await t.waitFor("studio-frame-review", count + 1);
    const review = last("studio-frame-review");
    assert.equal(review.activity, draft, "the review says the picture is for the activity");
    await t.service.message({ type: "studio-frame-accept", id: review.id }, send, false);
    await t.waitFor("studio-activity-added", count + 1);
  };
  let draft = "";
  try {
    await t.service.command("on", t.say, false, () => {});
    await t.service.message({ type: "studio-activity-new", source: "risa-dress", name: "Tea-Time!" }, send, false);
    assert.match(me.at(-1)?.message ?? "", /one word/, "a name that is not a word is refused");
    await t.service.message({ type: "studio-activity-new", source: "risa-dress", name: "tea time" }, send, false);
    draft = last("studio-activity").id;
    assert.equal(last("studio-activity").name, "tea_time", "spaces become _");
    assert.equal((await t.service.stateMessage()).activities.length, 1, "the unfinished activity is offered on the next visit");

    await add("pack:neutral", "holding a cup in both hands");
    await add(`draft:${last("studio-activity").frames[0].file}`, "lifts the cup a little higher");
    await add(`draft:${last("studio-activity").frames[0].file}`, "back to the first");
    assert.deepEqual(last("studio-activity").frames.map((f: any) => [f.n, f.from]), [[1, "neutral"], [2, "#1"], [3, "#1"]], "each picture knows what it was drawn from");
    assert.equal(await stat(join(t.framesDir, "risa-dress")).then(() => true, () => false), false, "nothing is written to the pack yet");

    // Take the middle one out: the ones after it move up.
    await t.service.message({ type: "studio-activity-remove", id: draft, file: last("studio-activity").frames[1].file }, send, false);
    assert.equal(last("studio-activity").frames.length, 2);
    await add(`draft:${last("studio-activity").frames[1].file}`, "a sip");
    const frames = last("studio-activity").frames;
    assert.equal(frames.length, 3);

    // A new service on the same folder still has it: stopping in the middle loses nothing.
    await t.service.message({ type: "studio-activity-rename", id: draft, name: "tea_time" }, send, false);
    assert.equal(last("studio-activity").name, "tea_time");
    await t.service.message({ type: "studio-activity-open", id: draft }, send, false);
    assert.equal(last("studio-activity").frames.length, 3);

    // Talking versions by script, from the pack's own mouth; a save with some of them missing is refused.
    await t.service.message({ type: "studio-activity-talk", id: draft, how: "script" }, send, false);
    assert.ok(last("studio-activity").frames.every((f: any) => f.talk), "every picture has a talking version");
    await t.service.message({ type: "studio-activity-talk", id: draft, how: "model" }, send, false);
    assert.match(me.at(-1)?.message ?? "", /have one already|already/, "nothing left to make");

    await t.service.message({ type: "studio-activity-save", id: draft }, send, false);
    await t.waitFor("studio-activity-saved");
    const own = join(t.framesDir, "risa-dress");
    const files = (await readdir(own)).filter((n) => n.startsWith("activity-")).sort();
    assert.deepEqual(files, ["activity-tea_time-1.webp", "activity-tea_time-2.webp", "activity-tea_time-3.webp", "activity-tea_time-talk-1.webp", "activity-tea_time-talk-2.webp", "activity-tea_time-talk-3.webp"]);
    assert.ok((await readdir(own)).includes("neutral.webp"), "the pack was copied whole first (it comes with the app)");
    assert.deepEqual((await t.service.stateMessage()).activities, [], "the draft is gone");
    assert.deepEqual((await t.service.stateMessage()).edited, {}, "pictures that were added are not offered back as originals");
    assert.equal(t.notes.length, 1);
    assert.equal(Object.keys((await readEdits(own))).length, 6, "every added picture is noted, so an update of the pack can name them");
    assert.ok((await t.service.stateMessage()).frames["risa-dress"].includes("activity-tea_time-talk-3"), "and the pack's pictures list has them");

    // Another activity of the same name is refused; the picture strip of a pack that has it is not touched.
    await t.service.message({ type: "studio-activity-new", source: "risa-dress", name: "tea_time" }, send, false);
    assert.match(me.at(-1)?.message ?? "", /has an activity called tea_time/);
  } finally {
    await t.cleanup();
  }
});

test("an activity refuses what it cannot do: a loop of one, a made-up source, talking by model without a local model, a phone", async () => {
  const t = await setup();
  const me: Record<string, any>[] = [];
  const send = (m: unknown) => me.push(m as Record<string, any>);
  try {
    await t.service.command("on", t.say, false, () => {});
    await t.service.message({ type: "studio-activity-new", source: "risa-dress", name: "walk" }, send, false);
    const draft = [...t.sent].reverse().find((m) => m.type === "studio-activity")!.id;
    await t.service.message({ type: "studio-activity-draw", id: draft, from: "pack:../x", prompt: "a step" }, send, false);
    assert.match(me.at(-1)?.message ?? "", /Pick the picture/);
    await t.service.message({ type: "studio-activity-draw", id: draft, from: "pack:neutral", prompt: "a" }, send, false);
    assert.match(me.at(-1)?.message ?? "", /Say what should change/);
    await t.service.message({ type: "studio-activity-save", id: draft }, send, false);
    assert.match(me.at(-1)?.message ?? "", /at least two/);
    await t.service.message({ type: "studio-activity-talk", id: draft, how: "script" }, send, false);
    assert.match(me.at(-1)?.message ?? "", /first/, "no pictures, no talking versions");
    await t.service.message({ type: "studio-activity-delete", id: "../../x" }, send, false);
    const before = me.length;
    await t.service.message({ type: "studio-activity-new", source: "risa-dress", name: "run" }, send, true);
    assert.equal(me.at(-1)!.type, "notice", "a phone is refused");
    assert.equal(me.length, before + 1);
    await t.service.message({ type: "studio-activity-delete", id: draft }, send, false);
    assert.deepEqual((await t.service.stateMessage()).activities, []);
  } finally {
    await t.cleanup();
  }
});

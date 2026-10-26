import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { readPack } from "../src/frame-pack.ts";
import { createStudioService } from "../src/studio-service.ts";
import { decode, encodePng, makeRaster } from "../src/studio/raster.ts";
import { startFakeBackend, type FakeBackend } from "./helpers/image-backend.ts";
import { writeStandIn } from "./helpers/standin.ts";

/** A figure on a clear picture, like a pack's neutral. */
async function neutral(): Promise<Buffer> {
  const r = makeRaster(188, 214, [0, 0, 0, 0]);
  for (let y = 30; y < 200; y++) for (let x = 60; x < 130; x++) r.data.set([200, 40, 50, 255], (y * 188 + x) * 4);
  return encodePng(r);
}

async function setup(options: { backendUrl?: string | null; again?: { dataDir: string; fake: FakeBackend }; delayMs?: number; xai?: boolean; budget?: number; noWeights?: boolean } = {}) {
  // `again`: a second server on the same data folder and the same backend, as after a restart.
  const dataDir = options.again?.dataDir ?? (await mkdtemp(join(tmpdir(), "studio-service-")));
  const framesDir = join(dataDir, "frames");
  const fake = options.again?.fake ?? (await startFakeBackend({ delayMs: options.delayMs, xai: options.xai ? {} : undefined, noWeights: options.noWeights }));
  const settings = { studioBackend: options.backendUrl === undefined ? fake.url : options.backendUrl, studioBudgetUsd: options.budget };
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
    readSource: async (name) => (name === "risa-dress" ? { neutral: await neutral(), talk: [], character: "risa" } : null),
    refreshPacks: async () => {},
    pushNote: (t) => notes.push(t),
  });
  const waitFor = async (type: string, count = 1) => {
    for (let i = 0; i < 3600; i++) {
      if (sent.filter((m) => m.type === type).length >= count) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`no ${type} (${count}); got ${sent.map((m) => m.type).join(",")}${sent.filter((m) => m.type === "studio-error").map((m) => ` [error: ${m.message}]`).join("")}`);
  };
  const cleanup = async () => {
    service.close();
    if (options.again) return; // the first server owns the backend and the folder
    await fake.stop();
    await rm(dataDir, { recursive: true, force: true });
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
        assert.equal((await readdir(join(first.framesDir, "risa-snow"))).length, 42);
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

test("the page's image maker list: the choices say what they cost, a choice is saved, and nothing odd gets in", async () => {
  const t = await setup();
  try {
    await t.service.command("on", t.say, false, () => {});
    const state = await t.service.stateMessage();
    assert.deepEqual(state.backends.map((b: any) => b.kind), ["local", "paid", "paid", "paid", "browser", "browser", "browser"]);
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

import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
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
    readSource: async (name) => (name === "risa-dress" ? { neutral: await neutral(), character: "risa" } : null),
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

test("a redraw: the question first, four pictures, one picked, a pack installed that readers of data/frames understand", async () => {
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
    assert.equal((await t.service.stateMessage()).running, null, "the worker is done while she waits for the pick");

    await t.service.message({ type: "studio-pick", id: card.id, seed: 3 }, send, false);
    await t.waitFor("studio-installed");
    assert.equal(t.sent.find((m) => m.type === "studio-installed")?.name, "risa-winter");
    const folder = join(t.framesDir, "risa-winter");
    assert.deepEqual((await readdir(folder)).sort(), ["NOTICE.md", "credit.txt", "look.txt", "neutral.webp"]);
    const look = await readFile(join(folder, "look.txt"), "utf8");
    assert.match(look, /^character: risa\n/);
    assert.match(await readFile(join(folder, "NOTICE.md"), "utf8"), /fake-1.*MIT.*responsible/s);
    const pic = await decode(join(folder, "neutral.webp"));
    assert.deepEqual([pic.w, pic.h], [940, 1070]);
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

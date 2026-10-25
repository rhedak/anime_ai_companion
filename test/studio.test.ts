import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BackendError, checkBackendUrl, httpBackend, makeBackend, XAI, xaiBackend } from "../src/studio/backend.ts";
import { checkLowerBody } from "../src/studio/checks.ts";
import { pasteBack } from "../src/studio/paste.ts";
import { cutout, keyBackground, KEYS, pickKey, toRaster } from "../src/studio/cutout.ts";
import { cleanText, parseJob } from "../src/studio/job.ts";
import { findStudioTags, usableName } from "../src/studio/tags.ts";
import { decode, encodePng, flatten, label, makeRaster, openSquare, resize, type Raster } from "../src/studio/raster.ts";
import { runBase, type StudioEvent } from "../src/studio/runner.ts";
import { startFakeBackend } from "./helpers/image-backend.ts";
import { chromeBackend, readAnswer } from "../src/studio/chrome-backend.ts";
import { writeStandIn } from "./helpers/standin.ts";

/** A red disc with a soft 3 pixel edge and a hole in it, on a transparent picture: a figure whose alpha we know. */
function figure(size = 96): Raster {
  const r = makeRaster(size, size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      let a = Math.min(1, Math.max(0, (34 - d) / 3 + 0.5)); // soft edge around radius 34
      if (Math.hypot(x - c - 12, y - c) < 6) a = 0; // an enclosed gap, like the space between two strands
      r.data.set([180, 30, 40, Math.round(a * 255)], (y * size + x) * 4);
    }
  }
  return r;
}

test("the key colour is the one the figure comes least close to", () => {
  const { key, shares } = pickKey(figure());
  assert.equal(shares[key], 0);
  const pinkFigure = makeRaster(8, 8, [250, 20, 240, 255]);
  assert.notEqual(pickKey(pinkFigure).key, "magenta");
});

test("every pixel close to the key colour is background, enclosed gaps too, and a half-blended edge pixel is not", () => {
  const pic = flatten(figure(), KEYS.magenta);
  const bg = keyBackground(pic, "magenta");
  const at = (x: number, y: number) => bg[y * pic.w + x];
  assert.equal(at(2, 2), 1, "the corner");
  assert.equal(at(48 + 12, 48), 1, "the gap inside the figure");
  assert.equal(at(48, 48), 0, "the figure itself");
  const half = makeRaster(2, 1);
  half.data.set([217, 15, 147, 255], 0); // half red hair, half magenta
  half.data.set([255, 0, 255, 255], 4);
  assert.deepEqual([...keyBackground(half, "magenta")], [0, 1], "the blend goes to the matting");
});

test("the cut-out finds the soft edge: alpha is close to what it was before the figure was laid on the key colour", () => {
  const src = figure();
  const out = cutout(flatten(src, KEYS.magenta), { key: "magenta" });
  let err = 0, band = 0;
  for (let i = 0; i < src.w * src.h; i++) {
    const a0 = src.data[i * 4 + 3] / 255;
    if ((a0 > 0 && a0 < 1) || (out.alpha[i] > 0 && out.alpha[i] < 1)) {
      band++;
      err += Math.abs(a0 - out.alpha[i]);
    }
  }
  assert.ok(band > 100, "there is an edge to measure");
  assert.ok(err / band < 0.2, `mean alpha error in the edge band is ${(err / band).toFixed(3)}`);
  const raster = toRaster(src.w, src.h, out);
  // No trace of the key in a solid pixel, and none in the colour of the edge.
  for (let i = 0; i < src.w * src.h; i++) {
    if (raster.data[i * 4 + 3] === 0) continue;
    assert.ok(raster.data[i * 4 + 1] < 120, "the edge colour is the figure's, not magenta");
  }
});

test("a mask opening drops what is thinner than the element and keeps what is wider", () => {
  const w = 20, h = 20;
  const mask = new Uint8Array(w * h);
  for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) mask[y * w + x] = 1; // a 10 px square
  for (let x = 0; x < 20; x++) mask[2 * w + x] = 1; // a 1 px line
  const open = openSquare(mask, w, h, 1);
  assert.equal(open[2 * w + 10], 0, "the line is gone");
  assert.equal(open[10 * w + 10], 1, "the square stays");
  assert.equal(label(open, w, h).count, 1);
});

test("job text is cleaned and a job is checked field by field", () => {
  assert.equal(cleanText("a [emotion:happy] coat <b>red</b>\n\twith `hood`", 100), "a coat b red /b with hood");
  const base = {
    id: "job-abc123", kind: "redraw", name: "risa-winter", source: "risa-dress", character: "risa", outfit: "a dark green winter coat", look: "You wear a green coat.",
    key: "magenta", width: 896, height: 1024, backend: { url: "http://127.0.0.1:1", name: "fake" }, seeds: [1, 2, 3, 4],
  };
  assert.ok(parseJob(base).ok);
  for (const [field, value] of [["name", "../x"], ["source", ""], ["outfit", "x"], ["key", "red"], ["width", 900], ["seeds", []], ["id", "A"]] as const) {
    assert.equal(parseJob({ ...base, [field]: value }).ok, false, `${field} = ${String(value)} is refused`);
  }
});

test("the image backend client talks to a loopback server and refuses any other address", async () => {
  assert.equal(checkBackendUrl("http://example.com:8000"), null);
  assert.equal(checkBackendUrl("https://127.0.0.1:8000"), null, "plain http on this computer only");
  assert.equal(checkBackendUrl("http://127.0.0.1:8000/"), "http://127.0.0.1:8000");
  assert.throws(() => httpBackend("http://example.com"), BackendError);
  const fake = await startFakeBackend();
  try {
    const backend = httpBackend(fake.url);
    assert.deepEqual(await backend.info(), { name: "fake backend", model: "fake-1", revision: "abc", licence: "MIT", edit: true, generate: true });
    const png = await backend.generate({ prompt: "x", seed: 3, width: 64, height: 80 });
    const pic = await decode(png);
    assert.deepEqual([pic.w, pic.h], [64, 80]);
  } finally {
    await fake.stop();
  }
  const broken = await startFakeBackend({ failEdit: "out of memory" });
  try {
    await assert.rejects(httpBackend(broken.url).edit({ image: await encodePng(makeRaster(16, 16, [1, 2, 3, 255])), prompt: "x", seed: 1, width: 16, height: 16 }), /out of memory/);
  } finally {
    await broken.stop();
  }
  await assert.rejects(httpBackend("http://127.0.0.1:9").info(), /did not answer/);
});

test("the base step puts the source on the key colour, asks for one picture a seed and writes them with a thumbnail", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studio-"));
  const fake = await startFakeBackend();
  try {
    const source = makeRaster(94, 107, [0, 0, 0, 0]);
    for (let y = 20; y < 90; y++) for (let x = 30; x < 64; x++) source.data.set([200, 40, 50, 255], (y * 94 + x) * 4);
    const parsed = parseJob({
      id: "job-abc123", kind: "redraw", name: "risa-winter", source: "risa-dress", character: "risa", outfit: "a dark green winter coat", look: "You wear a coat.",
      key: "magenta", width: 256, height: 288, backend: { url: fake.url, name: "fake" }, seeds: [1, 2],
    });
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    const events: StudioEvent[] = [];
    await runBase(parsed.job, { dir, backend: httpBackend(fake.url), emit: (e) => events.push(e), source: await encodePng(source) });
    assert.deepEqual(events.filter((e) => e.type === "candidate").map((e) => (e.type === "candidate" ? [e.seed, e.done, e.total] : null)), [[1, 1, 2], [2, 2, 2]]);
    assert.equal(events.at(-1)?.type, "base-done");
    const edits = fake.requests.filter((r) => r.path === "/edit");
    assert.equal(edits.length, 2);
    assert.match(String(edits[0].body.prompt), /^change her outfit to a dark green winter coat;/);
    assert.match(String(edits[0].body.prompt), /magenta/);
    // The reference the model saw has the key colour where the source was clear.
    const reference = await decode(await readFile(join(dir, "source.png")));
    assert.deepEqual([...reference.data.slice(0, 4)], [255, 0, 255, 255]);
    const seed1 = await decode(await readFile(join(dir, "base/seed-1.png")));
    assert.deepEqual([seed1.w, seed1.h], [256, 288]);
    const thumb = await decode(await readFile(join(dir, "base/seed-1.thumb.webp")));
    assert.equal(thumb.w, 240);
  } finally {
    await fake.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("resizing keeps the colour of an edge (the alpha is premultiplied)", async () => {
  const r = makeRaster(8, 8, [0, 0, 0, 0]);
  for (let y = 0; y < 8; y++) for (let x = 4; x < 8; x++) r.data.set([200, 20, 20, 255], (y * 8 + x) * 4);
  const big = await resize(r, 32, 32);
  for (let i = 0; i < 32 * 32; i++) {
    if (big.data[i * 4 + 3] > 200) assert.ok(big.data[i * 4] > 150, "no grey fringe from the clear pixels beside it");
  }
});

test("a broken pose (two copies of her stacked) fails the lower-body check, a close one does not", () => {
  const w = 40, h = 100;
  // A torso (rows 20 to 59, wide) and legs (rows 60 to 99, narrow); `shift` moves the whole figure down.
  const body = (shift: number, lessWide = 0) => {
    const a = new Float32Array(w * h);
    for (let y = 20; y < h; y++) {
      const [x0, x1] = y < 60 ? [10, 30] : [15 + lessWide, 25 - lessWide];
      const yy = y + shift;
      if (yy < h) for (let x = x0; x < x1; x++) a[yy * w + x] = 1;
    }
    return a;
  };
  assert.deepEqual(checkLowerBody(body(0), body(0), w, h), []);
  assert.deepEqual(checkLowerBody(body(0), body(1), w, h), [], "a pixel of shift is the same picture");
  assert.match(checkLowerBody(body(0), body(30), w, h).join(" "), /does not line up/);
  assert.match(checkLowerBody(body(0), body(0, 3), w, h).join(" "), /smaller/);
  assert.deepEqual(checkLowerBody(body(0), body(0, 1), w, h), [], "a pose that is a little smaller (raised arms redraw her) is the same picture");
});

test("a face edit never replaces the plain background of the base, so the model repainting the backdrop leaves no rectangle", () => {
  const base = makeRaster(20, 20, [255, 0, 255, 255]);
  for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) base.data.set([200, 40, 50, 255], (y * 20 + x) * 4);
  const edited = makeRaster(20, 20, [240, 30, 220, 255]); // a different pink everywhere, and a changed figure
  for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) edited.data.set([10, 200, 10, 255], (y * 20 + x) * 4);
  const keep = keyBackground(base, "magenta");
  const out = pasteBack(base, edited, [2, 2, 18, 18], 2, keep);
  assert.deepEqual([...out.data.slice((3 * 20 + 3) * 4, (3 * 20 + 3) * 4 + 3)], [255, 0, 255], "the backdrop is the base's");
  assert.ok(out.data[(10 * 20 + 10) * 4 + 1] > 150, "the figure takes the edit");
});

test("a studio tag is read into its fields, cleaned, and only complete tags count", () => {
  const reply = 'Sure! [emotion:happy] [studio outfit="a dark green winter coat <b>over</b> a sweater" name="risa-winter" look=\'You wear a green coat.\' source="risa-dress"] Here you go.';
  assert.deepEqual(findStudioTags(reply), [{ outfit: "a dark green winter coat b over /b a sweater", name: "risa-winter", look: "You wear a green coat.", source: "risa-dress" }]);
  assert.deepEqual(findStudioTags('[studio redraw="Happy, shy-blink; ../x, sad"]'), [{ redraw: ["happy", "shy-blink", "sad"] }]);
  assert.deepEqual(findStudioTags('[studio outfit="a coat'), [], "a tag still being written is not read");
  assert.deepEqual(findStudioTags('[studio outfit="a coat [with] a hood"]'), [], "a bracket inside a value ends the tag: nothing is read rather than half of it");
  assert.deepEqual(findStudioTags('[studio ignored="x"]'), [], "a tag with nothing we know is nothing");
  assert.equal(findStudioTags(`[studio outfit="${"w ".repeat(500)}"]`)[0].outfit?.length, 400, "the outfit is capped");
  assert.ok(usableName("risa-winter") && !usableName("../x") && !usableName(".hidden") && !usableName(undefined));
});

test("the paid backend: the key from the environment, a data-URI picture, the cost counted against a limit, and nothing leaks the key", async () => {
  const fake = await startFakeBackend({ xai: {} });
  const saved = { key: process.env.XAI_API_KEY, base: process.env.COMPANION_XAI_BASE };
  try {
    process.env.COMPANION_XAI_BASE = fake.url;
    process.env.XAI_API_KEY = "";
    const spends: number[] = [];
    const req = { image: Buffer.from(await encodePng(makeRaster(64, 64, [255, 0, 255, 255]))), prompt: "a coat", seed: 1, width: 64, height: 64 };
    const none = makeBackend(XAI, { limitUsd: 1, spentUsd: 0 });
    await assert.rejects(none.info(), /XAI_API_KEY is not set/);
    await assert.rejects(none.edit(req), /XAI_API_KEY is not set/);
    assert.equal(fake.requests.length, 0, "nothing is sent without a key");

    process.env.XAI_API_KEY = "xai-secret-key-1234567890";
    const paid = makeBackend(XAI, { limitUsd: 0.05, spentUsd: 0, onSpend: (usd) => spends.push(usd) });
    const info = await paid.info();
    assert.deepEqual([info.paid?.host, info.edit], [new URL(fake.url).host, true]);
    const picture = await paid.edit(req);
    assert.ok((await decode(picture)).w > 0);
    const sent = fake.requests.at(-1);
    assert.equal(sent?.path, "/images/edits");
    assert.equal(sent?.authorization, "Bearer xai-secret-key-1234567890");
    assert.deepEqual([sent?.body.model, sent?.body.response_format, sent?.body.resolution], ["grok-imagine-image-2.0", "b64_json", "1k"]);
    await paid.edit(req);
    assert.deepEqual(spends.map((n) => Math.round(n * 100) / 100), [0.02, 0.04]);
    await paid.edit(req); // 0.06: the call that starts below the limit is made, the next is refused
    await assert.rejects(paid.edit(req), /spending limit for this pack \(\$0\.05\) is reached/);
    assert.equal(fake.requests.length, 3);
    // A job that is carried on counts what it already cost.
    await assert.rejects(makeBackend(XAI, { limitUsd: 1, spentUsd: 1 }).edit(req), /spending limit/);
  } finally {
    process.env.XAI_API_KEY = saved.key ?? "";
    if (saved.key === undefined) delete process.env.XAI_API_KEY;
    if (saved.base === undefined) delete process.env.COMPANION_XAI_BASE;
    else process.env.COMPANION_XAI_BASE = saved.base;
    await fake.stop();
  }
});

test("the paid backend: a busy service is asked again, an error never shows the key, and an answer without a cost stops further calls", async () => {
  const saved = { key: process.env.XAI_API_KEY, base: process.env.COMPANION_XAI_BASE };
  process.env.XAI_API_KEY = "xai-secret-key-1234567890";
  const req = { image: Buffer.from(await encodePng(makeRaster(64, 64, [255, 0, 255, 255]))), prompt: "a coat", seed: 1, width: 64, height: 64 };
  const opts = { limitUsd: 5, spentUsd: 0 };
  try {
    const busy = await startFakeBackend({ xai: { busyFirst: 2 } });
    try {
      process.env.COMPANION_XAI_BASE = busy.url;
      const slept: number[] = [];
      const b = xaiBackend({ ...opts, sleep: async (ms) => void slept.push(ms) });
      assert.ok((await decode(await b.edit(req))).w > 0, "answered on the third try");
      assert.equal(slept.length, 2);
    } finally {
      await busy.stop();
    }
    const broken = await startFakeBackend({ xai: { failWith: { status: 400, message: "bad key xai-secret-key-1234567890 and a refusal" } } });
    try {
      process.env.COMPANION_XAI_BASE = broken.url;
      const error = await makeBackend(XAI, opts).edit(req).then(() => null, (e: Error) => e);
      assert.match(error?.message ?? "", /xAI Grok Imagine answered 400: bad key … and a refusal/);
      assert.ok(!String(error?.message).includes("secret"), "the key is taken out of the message");
    } finally {
      await broken.stop();
    }
    const blind = await startFakeBackend({ xai: { costTicks: null } });
    try {
      process.env.COMPANION_XAI_BASE = blind.url;
      const b = makeBackend(XAI, opts);
      await b.edit(req);
      await assert.rejects(b.edit(req), /did not say what the last picture cost/);
      assert.equal(blind.requests.length, 1);
    } finally {
      await blind.stop();
    }
  } finally {
    if (saved.key === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = saved.key;
    if (saved.base === undefined) delete process.env.COMPANION_XAI_BASE;
    else process.env.COMPANION_XAI_BASE = saved.base;
  }
});

test("the Gemini backend: the key (GEMINI_API_KEY or GOOGLE_API_KEY), an inline_data picture, a cost worked out from the token counts, and honest stops", async () => {
  const saved = { gem: process.env.GEMINI_API_KEY, goog: process.env.GOOGLE_API_KEY, base: process.env.COMPANION_GEMINI_BASE, model: process.env.COMPANION_GEMINI_MODEL };
  const restore = (name: string, v: string | undefined) => (v === undefined ? delete process.env[name] : (process.env[name] = v));
  const req = { image: Buffer.from(await encodePng(makeRaster(64, 64, [255, 0, 255, 255]))), prompt: "a coat", seed: 1, width: 64, height: 64 };
  const fake = await startFakeBackend({ gemini: {} });
  try {
    process.env.COMPANION_GEMINI_BASE = fake.url;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.COMPANION_GEMINI_MODEL;
    await assert.rejects(makeBackend("gemini", { limitUsd: 1, spentUsd: 0 }).info(), /GEMINI_API_KEY is not set/);
    process.env.GOOGLE_API_KEY = "goog-secret-key-1234567890";
    const spends: number[] = [];
    const b = makeBackend("gemini", { limitUsd: 0.1, spentUsd: 0, onSpend: (n) => spends.push(n) });
    const info = await b.info();
    assert.deepEqual([info.paid?.keyName, info.model], ["GEMINI_API_KEY", "gemini-3.1-flash-image"]);
    assert.ok((await decode(await b.edit(req))).w > 0);
    const sent = fake.requests.at(-1) as any;
    assert.equal(sent.path, "/models/gemini-3.1-flash-image:generateContent");
    assert.equal(sent.googKey, "goog-secret-key-1234567890");
    assert.equal(sent.authorization, undefined);
    assert.deepEqual(Object.keys(sent.body.contents[0].parts[0]), ["inline_data"]);
    assert.equal(sent.body.contents[0].parts[1].text, "a coat");
    assert.deepEqual([sent.body.generationConfig.responseModalities, sent.body.generationConfig.imageConfig.imageSize], [["IMAGE"], "1K"]);
    // 1300 input tokens at $0.50 and 1120 image tokens at $60 per million: 6.8 cents.
    assert.ok(Math.abs(spends[0] - 0.06785) < 1e-9, `got ${spends[0]}`);
    await b.edit(req); // 0.1358 is past 0.10: the next call is refused
    await assert.rejects(b.edit(req), /spending limit/);

    process.env.COMPANION_GEMINI_MODEL = "some-new-model";
    const blind = makeBackend("gemini", { limitUsd: 5, spentUsd: 0 });
    await blind.edit(req);
    await assert.rejects(blind.edit(req), /did not say what the last picture cost/);
  } finally {
    await fake.stop();
  }
  const refusing = await startFakeBackend({ gemini: { noPicture: "IMAGE_SAFETY" } });
  try {
    process.env.COMPANION_GEMINI_BASE = refusing.url;
    delete process.env.COMPANION_GEMINI_MODEL;
    await assert.rejects(makeBackend("gemini", { limitUsd: 5, spentUsd: 0 }).edit(req), /Google Gemini sent no picture.*IMAGE_SAFETY/);
  } finally {
    await refusing.stop();
    restore("GEMINI_API_KEY", saved.gem);
    restore("GOOGLE_API_KEY", saved.goog);
    restore("COMPANION_GEMINI_BASE", saved.base);
    restore("COMPANION_GEMINI_MODEL", saved.model);
  }
});

test("the OpenAI backend: a form with the picture at its own size, the key in a bearer header, and a cost worked out from the token counts", async () => {
  const saved = { key: process.env.OPENAI_API_KEY, base: process.env.COMPANION_OPENAI_BASE, model: process.env.COMPANION_OPENAI_MODEL };
  const restore = (name: string, v: string | undefined) => (v === undefined ? delete process.env[name] : (process.env[name] = v));
  const req = { image: Buffer.from(await encodePng(makeRaster(64, 80, [255, 0, 255, 255]))), prompt: "a coat", seed: 1, width: 64, height: 80 };
  const fake = await startFakeBackend({ openai: {} });
  try {
    process.env.COMPANION_OPENAI_BASE = fake.url;
    delete process.env.COMPANION_OPENAI_MODEL;
    delete process.env.OPENAI_API_KEY;
    await assert.rejects(makeBackend("openai", { limitUsd: 1, spentUsd: 0 }).info(), /OPENAI_API_KEY is not set/);
    process.env.OPENAI_API_KEY = "sk-secret-key-1234567890";
    const spends: number[] = [];
    const b = makeBackend("openai", { limitUsd: 5, spentUsd: 0, onSpend: (n) => spends.push(n) });
    assert.equal((await b.info()).model, "gpt-image-2.5-sunburst");
    const picture = await decode(await b.edit(req));
    assert.deepEqual([picture.w, picture.h], [64, 80], "asked for the size of the picture sent");
    const sent = fake.requests.at(-1) as any;
    assert.equal(sent.path, "/images/edits");
    assert.equal(sent.authorization, "Bearer sk-secret-key-1234567890");
    assert.deepEqual([sent.body.model, sent.body.size, sent.body.quality, sent.body.prompt], ["gpt-image-2.5-sunburst", "64x80", "high", "a coat"]);
    // 100 text tokens at $5, 300 image tokens at $8 and 4000 output tokens at $30 per million.
    assert.ok(Math.abs(spends[0] - 0.1229) < 1e-9, `got ${spends[0]}`);
  } finally {
    await fake.stop();
  }
  const blind = await startFakeBackend({ openai: { noUsage: true } });
  try {
    process.env.COMPANION_OPENAI_BASE = blind.url;
    const b = makeBackend("openai", { limitUsd: 5, spentUsd: 0 });
    await b.edit(req);
    await assert.rejects(b.edit(req), /did not say what the last picture cost/);
  } finally {
    await blind.stop();
    restore("OPENAI_API_KEY", saved.key);
    restore("COMPANION_OPENAI_BASE", saved.base);
    restore("COMPANION_OPENAI_MODEL", saved.model);
  }
});

/** A stand-in `claude` for the browser backend: reads the task on stdin, "downloads" the picture it was told to upload, and answers like the real agent. */
function chromeStandIn(dir: string, downloads: string, mode: "ok" | "login" | "nodownload" | "hang" | "gemini" = "ok"): string {
  return writeStandIn(
    dir,
    "claude",
    `
const fs = require("fs");
const path = require("path");
let task = "";
process.stdin.on("data", (c) => (task += c));
process.stdin.on("end", () => {
  fs.appendFileSync(${JSON.stringify(join(dir, "calls.log"))}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), task }) + "\\n");
  const mode = ${JSON.stringify(mode)};
  if (mode === "hang") return setTimeout(() => {}, 60000);
  if (mode === "login") return console.log("I opened the page.\\nFAILED: the page asked me to sign in");
  const file = /upload this file[^:]*: (\\S+)/i.exec(task)[1];
  const id = "1437a575-d926-4ec1-a880-" + String(Date.now() % 1e12).padStart(12, "0");
  if (mode === "gemini") {
    fs.writeFileSync(path.join(${JSON.stringify(downloads)}, "Gemini_Generated_Image_abc123.jpeg"), fs.readFileSync(file));
    return console.log("DONE");
  }
  if (mode === "ok") fs.writeFileSync(path.join(${JSON.stringify(downloads)}, "grok-image-" + id + ".jpg"), fs.readFileSync(file));
  console.log("All done.\\nDONE " + id);
});
`,
  );
}

test("the browser backend: one fixed task for a cut-down claude, the picture it downloaded picked up, and honest failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-chrome-"));
  const downloads = join(root, "Downloads");
  await mkdir(downloads);
  const job = join(root, "job");
  const req = { image: Buffer.from(await encodePng(makeRaster(64, 80, [255, 0, 255, 255]))), prompt: "change her outfit to a red scarf", seed: 1, width: 64, height: 80 };
  try {
    const program = chromeStandIn(join(root, "bin"), downloads);
    await writeFile(join(downloads, "grok-image-old.jpg"), "an earlier download that is not ours");
    const b = chromeBackend({ dir: job, downloads, program, timeoutMs: 20_000 });
    const info = await b.info();
    assert.deepEqual([info.browser?.site, info.edit, info.generate, info.paid], ["grok.com/imagine", true, false, undefined]);
    const picture = await decode(await b.edit(req));
    assert.deepEqual([picture.w, picture.h], [64, 80]);
    const call = JSON.parse((await readFile(join(root, "bin", "calls.log"), "utf8")).trim().split("\n")[0]);
    const flag = (name: string) => call.args[call.args.indexOf(name) + 1];
    assert.deepEqual([flag("--tools"), flag("--allowedTools"), flag("--setting-sources"), call.args.includes("--chrome"), call.args.includes("--strict-mcp-config")], ["Read", `mcp__claude-in-chrome__*,Read(${join(job, "web")}/**)`, "", true, true], "no tool but Read of the one folder and the extension's, nothing from the user's settings");
    assert.equal(call.cwd.replace(/^\/private/, ""), join(job, "web").replace(/^\/private/, ""));
    assert.match(call.task, /https:\/\/grok\.com\/imagine/);
    assert.match(call.task, /<<<PROMPT\nchange her outfit to a red scarf\nPROMPT>>>/);
    assert.deepEqual((await readdir(downloads)).sort(), ["grok-image-old.jpg"], "our download was taken out of the user's folder, theirs was left");
    assert.ok((await readdir(join(job, "web"))).some((n) => n.startsWith("out-1")), "a copy stays in the job");

    const login = chromeBackend({ dir: job, downloads, program: chromeStandIn(join(root, "bin2"), downloads, "login"), timeoutMs: 20_000 });
    await assert.rejects(login.edit(req), /Grok Imagine in your Chrome: the page asked me to sign in/);
    const none = chromeBackend({ dir: job, downloads, program: chromeStandIn(join(root, "bin3"), downloads, "nodownload"), timeoutMs: 20_000 });
    await assert.rejects(none.edit(req), /no download appeared/);

    const slow = chromeBackend({ dir: job, downloads, program: chromeStandIn(join(root, "bin4"), downloads, "hang"), timeoutMs: 1500 });
    await assert.rejects(slow.edit(req), /took longer than/);
    const abort = new AbortController();
    const stopped = chromeBackend({ dir: job, downloads, program: chromeStandIn(join(root, "bin5"), downloads, "hang"), timeoutMs: 20_000 }).edit(req, abort.signal);
    setTimeout(() => abort.abort(), 500);
    await assert.rejects(stopped, /stopped/);

    const capped = chromeBackend({ dir: job, downloads, program, maxPictures: 1, timeoutMs: 20_000 });
    await capped.edit(req);
    await assert.rejects(capped.edit(req), /stops there/);
    assert.deepEqual(readAnswer("blah\nDONE 1437a575-d926-4ec1-a880-babbd529d65d"), { ok: true, postId: "1437a575-d926-4ec1-a880-babbd529d65d" });
    assert.equal(readAnswer("hmm").ok, false);
    await assert.rejects(chromeBackend({ dir: job, downloads, program: join(root, "missing") }).info(), /needs Claude Code/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the browser backend for Gemini: its own task and its own download name, with no post id to look for", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-chrome-gem-"));
  const downloads = join(root, "Downloads");
  await mkdir(downloads);
  const req = { image: Buffer.from(await encodePng(makeRaster(64, 80, [255, 0, 255, 255]))), prompt: "change her outfit to a red scarf", seed: 1, width: 64, height: 80 };
  try {
    const bin = join(root, "bin");
    const program = chromeStandIn(bin, downloads, "gemini");
    await writeFile(join(downloads, "Gemini_Generated_Image_old.jpeg"), "an earlier one");
    const b = chromeBackend({ dir: join(root, "job"), downloads, program, site: "gemini", timeoutMs: 20_000 });
    assert.equal((await b.info()).browser?.site, "gemini.google.com");
    assert.equal((await decode(await b.edit(req))).w, 64);
    const call = JSON.parse((await readFile(join(bin, "calls.log"), "utf8")).trim().split("\n")[0]);
    assert.match(call.task, /https:\/\/gemini\.google\.com\/app/);
    assert.match(call.task, /Create image/);
    assert.match(call.task, /<<<PROMPT\nchange her outfit to a red scarf\nPROMPT>>>/);
    assert.doesNotMatch(call.task, /grok\.com/);
    assert.deepEqual((await readdir(downloads)).sort(), ["Gemini_Generated_Image_old.jpeg"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the browser backend for ChatGPT: its own task, and a download named after whatever ChatGPT calls the picture", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-chrome-gpt-"));
  const downloads = join(root, "Downloads");
  await mkdir(downloads);
  const req = { image: Buffer.from(await encodePng(makeRaster(64, 80, [255, 0, 255, 255]))), prompt: "change her outfit to a red scarf", seed: 1, width: 64, height: 80 };
  try {
    const bin = join(root, "bin");
    writeStandIn(
      bin,
      "claude",
      `
const fs = require("fs"), path = require("path");
let task = "";
process.stdin.on("data", (c) => (task += c));
process.stdin.on("end", () => {
  fs.appendFileSync(${JSON.stringify(join(bin, "calls.log"))}, JSON.stringify({ task }) + "\\n");
  const file = /upload this file[^:]*: (\\S+)/i.exec(task)[1];
  fs.writeFileSync(path.join(${JSON.stringify(downloads)}, "Anime Girl in Winter Parka.png"), fs.readFileSync(file));
  console.log("DONE");
});
`,
    );
    await writeFile(join(downloads, "report.pdf"), "not a picture");
    const b = chromeBackend({ dir: join(root, "job"), downloads, program: join(bin, "claude"), site: "chatgpt", timeoutMs: 20_000 });
    assert.equal((await b.info()).browser?.site, "chatgpt.com");
    assert.equal((await decode(await b.edit(req))).w, 64);
    const call = JSON.parse((await readFile(join(bin, "calls.log"), "utf8")).trim().split("\n")[0]);
    assert.match(call.task, /https:\/\/chatgpt\.com\//);
    assert.match(call.task, /Create an image: /);
    assert.match(call.task, /<<<PROMPT\nchange her outfit to a red scarf\nPROMPT>>>/);
    assert.deepEqual((await readdir(downloads)).sort(), ["report.pdf"], "the picture was taken out of the folder, the user's other file was not");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

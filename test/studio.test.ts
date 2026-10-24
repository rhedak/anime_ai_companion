import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BackendError, checkBackendUrl, httpBackend } from "../src/studio/backend.ts";
import { checkLowerBody } from "../src/studio/checks.ts";
import { pasteBack } from "../src/studio/paste.ts";
import { cutout, keyBackground, KEYS, pickKey, toRaster } from "../src/studio/cutout.ts";
import { cleanText, parseJob } from "../src/studio/job.ts";
import { findStudioTags, usableName } from "../src/studio/tags.ts";
import { decode, encodePng, flatten, label, makeRaster, openSquare, resize, type Raster } from "../src/studio/raster.ts";
import { runBase, type StudioEvent } from "../src/studio/runner.ts";
import { startFakeBackend } from "./helpers/image-backend.ts";

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

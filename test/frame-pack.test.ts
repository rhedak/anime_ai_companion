import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { frameMime, gestureNote, isPackName, listPacks, packInfo, readPack, sizeOf } from "../src/frame-pack.ts";

const emotions = ["neutral", "happy", "sad", "thinking"];

/** The first bytes of a PNG: enough for the size, which is all the server reads. */
function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

async function withPack(files: Record<string, Buffer | string>, run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "frames-"));
  try {
    await mkdir(join(dir, "mine"));
    for (const [name, body] of Object.entries(files)) await writeFile(join(dir, "mine", name), body);
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("pictures are told apart by their names, and talk frames by number", async () => {
  const img = png(100, 120);
  await withPack(
    { "neutral.png": img, "neutral-blink.png": img, "neutral-talk2.png": img, "neutral-talk10.png": img, "neutral-talk1.png": img, "Happy.PNG": img, "happy-blink.webp": img },
    async (dir) => {
      const r = await readPack(dir, "mine", emotions);
      assert.ok(r.ok);
      assert.deepEqual(r.pack.emotions.neutral, { idle: "neutral.png", blink: "neutral-blink.png", talk: ["neutral-talk1.png", "neutral-talk2.png", "neutral-talk10.png"] });
      assert.deepEqual(r.pack.emotions.happy, { idle: "Happy.PNG", blink: "happy-blink.webp", talk: [] });
      assert.equal(r.pack.emotions.sad, undefined);
      assert.ok(r.pack.notes.some((n) => /No pictures for sad, thinking: she shows neutral/.test(n)));
    },
  );
});

test("pose pictures for a gesture are found by name and number, and unknown gestures are not used", async () => {
  const img = png(100, 120);
  await withPack({ "neutral.png": img, "wave-2.png": img, "wave-1.png": img, "wave-10.webp": img, "cheer-1.png": img, "dance-1.png": img, "wave.png": img }, async (dir) => {
    const r = await readPack(dir, "mine", emotions);
    assert.ok(r.ok);
    assert.deepEqual(r.pack.gestures, { wave: ["wave-1.png", "wave-2.png", "wave-10.webp"], cheer: ["cheer-1.png"] });
    assert.ok(r.pack.files.has("wave-2.png") && !r.pack.files.has("dance-1.png"), "only recognised pictures are ever served");
    assert.match(r.pack.notes.join("\n"), /Not used .*dance-1\.png, wave\.png/);
    const info = packInfo(r.pack);
    assert.match(info.gestures.wave[0], /^\/frames\/mine\/wave-1\.png\?v=\d+$/);
    assert.equal(gestureNote(r.pack), "Of the gestures, only cheer and wave show a picture; the others change nothing.");
  });
  await withPack({ "neutral.png": img }, async (dir) => {
    const r = await readPack(dir, "mine", emotions);
    assert.ok(r.ok);
    assert.deepEqual(r.pack.gestures, {});
    assert.equal(gestureNote(r.pack), "Gestures change nothing either.");
  });
});

test("a pack needs a neutral picture", async () => {
  await withPack({ "happy.png": png(10, 10) }, async (dir) => {
    const r = await readPack(dir, "mine", emotions);
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.reason : "", /neutral\.png/);
  });
  const dir = await mkdtemp(join(tmpdir(), "frames-"));
  try {
    const r = await readPack(dir, "missing", emotions);
    assert.equal(r.ok, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("files that are not understood are reported and never served", async () => {
  await withPack(
    { "neutral.png": png(10, 10), "neutral.svg": "<svg onload=alert(1)/>", "sleepy.png": png(10, 10), "notes.txt": "x", "happy-blink.png": png(10, 10), ".DS_Store": "x" },
    async (dir) => {
      const r = await readPack(dir, "mine", emotions);
      assert.ok(r.ok);
      assert.deepEqual([...r.pack.files.keys()].sort(), ["neutral.png"]); // happy-blink has no happy.png
      const notes = r.pack.notes.join("\n");
      assert.match(notes, /Not used .*neutral\.svg, notes\.txt, sleepy\.png/);
      assert.match(notes, /happy has no happy\.png/);
      assert.doesNotMatch(notes, /DS_Store/);
    },
  );
});

test("frames of a different size than neutral are called out", async () => {
  await withPack({ "neutral.png": png(100, 120), "neutral-blink.png": png(100, 130), "happy.png": png(100, 120) }, async (dir) => {
    const r = await readPack(dir, "mine", emotions);
    assert.ok(r.ok);
    assert.match(r.pack.notes.join("\n"), /different size than neutral\.png \(100×120\).*neutral-blink\.png \(100×130\)/);
  });
});

test("the page is told urls that change when a picture does", async () => {
  await withPack({ "neutral.png": png(10, 10), "neutral-talk1.png": png(10, 10) }, async (dir) => {
    const r = await readPack(dir, "mine", emotions);
    assert.ok(r.ok);
    const info = packInfo(r.pack);
    assert.match(info.emotions.neutral.idle, /^\/frames\/mine\/neutral\.png\?v=\d+$/);
    assert.equal(info.emotions.neutral.blink, undefined);
    assert.equal(info.emotions.neutral.talk.length, 1);
  });
});

test("pack names are plain folder names", async () => {
  for (const ok of ["linnea", "My pack 2", "a.b-c_d"]) assert.equal(isPackName(ok), true, ok);
  for (const bad of ["", ".", "..", "../x", "a/b", "a\\b", ".hidden", "x".repeat(41), "a..b", "<b>"]) assert.equal(isPackName(bad), false, bad);
  const dir = await mkdtemp(join(tmpdir(), "frames-"));
  try {
    await mkdir(join(dir, "b"));
    await mkdir(join(dir, "a"));
    await mkdir(join(dir, ".hidden"));
    await mkdir(join(dir, "thumbs"));
    await writeFile(join(dir, "thumbs", "a.webp"), "x");
    await writeFile(join(dir, "file.png"), "x");
    assert.deepEqual(await listPacks(dir), ["a", "b"]);
    await writeFile(join(dir, "thumbs", "neutral.png"), png(4, 4));
    assert.deepEqual(await listPacks(dir), ["a", "b", "thumbs"]);
    assert.deepEqual(await listPacks(join(dir, "nope")), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sizes are read from PNG, WebP and JPEG headers", () => {
  assert.deepEqual(sizeOf(png(580, 660)), { width: 580, height: 660 });
  const vp8x = Buffer.alloc(30);
  vp8x.write("RIFF", 0);
  vp8x.write("WEBP", 8);
  vp8x.write("VP8X", 12);
  vp8x.writeUIntLE(1023, 24, 3);
  vp8x.writeUIntLE(1535, 27, 3);
  assert.deepEqual(sizeOf(vp8x), { width: 1024, height: 1536 });
  const vp8l = Buffer.alloc(30);
  vp8l.write("RIFF", 0);
  vp8l.write("WEBP", 8);
  vp8l.write("VP8L", 12);
  vp8l.writeUInt32LE(499 | (599 << 14), 21);
  assert.deepEqual(sizeOf(vp8l), { width: 500, height: 600 });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x01, 0xf4, 0x03]);
  assert.deepEqual(sizeOf(jpeg), { width: 500, height: 600 });
  assert.equal(sizeOf(Buffer.from("not an image at all, just text")), null);
});

test("served types follow the extension", () => {
  assert.equal(frameMime("a.png"), "image/png");
  assert.equal(frameMime("a.WEBP"), "image/webp");
  assert.equal(frameMime("a.jpeg"), "image/jpeg");
});

test("a pack can carry its credit and its terms, and packs are found in the user's folder first", async () => {
  const img = png(10, 10);
  const mine = await mkdtemp(join(tmpdir(), "frames-"));
  const shipped = await mkdtemp(join(tmpdir(), "frames-"));
  try {
    for (const [dir, credit] of [[mine, "my own"], [shipped, "shipped"]]) {
      await mkdir(join(dir, "fan"));
      await writeFile(join(dir, "fan", "neutral.png"), img);
      await writeFile(join(dir, "fan", "credit.txt"), `${credit}\n\x07 line two`);
    }
    await mkdir(join(shipped, "only-shipped"));
    await writeFile(join(shipped, "only-shipped", "neutral.png"), img);
    await writeFile(join(shipped, "only-shipped", "NOTICE.md"), "terms");
    assert.deepEqual(await listPacks(mine, shipped), ["fan", "only-shipped"]);

    const fan = await readPack([mine, shipped], "fan", emotions);
    assert.ok(fan.ok);
    assert.equal(fan.pack.credit, "my own"); // the first line is the credit
    assert.equal(fan.pack.terms, "line two"); // the rest are the terms; control characters never reach the page
    assert.deepEqual([packInfo(fan.pack).credit, packInfo(fan.pack).terms], ["my own", "line two"]);
    assert.doesNotMatch(fan.pack.notes.join("\n"), /credit\.txt|NOTICE/);

    // a half-made folder of the user's own does not hide the finished pack that ships with the app
    await mkdir(join(mine, "only-shipped"));
    await writeFile(join(mine, "only-shipped", "base.png"), img);
    const shadowed = await readPack([mine, shipped], "only-shipped", emotions);
    assert.ok(shadowed.ok);
    assert.ok([...shadowed.pack.files.values()][0].path.startsWith(shipped), "its pictures come from the shipped folder");
    assert.deepEqual(await listPacks(mine, shipped), ["fan", "only-shipped"]);
    // when no folder works, the user's own folder's problem is the one reported
    await rm(join(shipped, "only-shipped"), { recursive: true });
    const broken = await readPack([mine, shipped], "only-shipped", emotions);
    assert.equal(broken.ok, false);
    assert.match(!broken.ok ? broken.reason : "", /needs a neutral\.png/);
    await mkdir(join(shipped, "only-shipped"));
    await writeFile(join(shipped, "only-shipped", "neutral.png"), img);
    await writeFile(join(shipped, "only-shipped", "NOTICE.md"), "terms");
    await rm(join(mine, "only-shipped"), { recursive: true });

    const only = await readPack([mine, shipped], "only-shipped", emotions);
    assert.ok(only.ok);
    assert.equal(only.pack.credit, undefined);
    assert.match(only.pack.notes.join("\n"), /terms of use: read NOTICE\.md in .*only-shipped/);
    assert.deepEqual([...only.pack.files.keys()], ["neutral.png"]); // the text files are never served

    await writeFile(join(shipped, "only-shipped", "credit.txt"), "x".repeat(301));
    const long = await readPack([mine, shipped], "only-shipped", emotions);
    assert.ok(long.ok);
    assert.equal(long.pack.credit, undefined);
    assert.match(long.pack.notes.join("\n"), /credit\.txt is longer than 300/);
  } finally {
    await rm(mine, { recursive: true, force: true });
    await rm(shipped, { recursive: true, force: true });
  }
});

test("the Miku pack that ships with the app is complete, and carries its credit and its terms", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const names = Object.keys(JSON.parse(await readFile(join(root, "emotions.json"), "utf8")));
  const r = await readPack(join(root, "packs"), "miku", names);
  assert.ok(r.ok);
  for (const emotion of names) {
    const e = r.pack.emotions[emotion];
    assert.ok(e?.blink && e.talk.length === 3, `${emotion}: rest, blink and three mouth openings`);
  }
  assert.equal(r.pack.files.size, names.length * 5 + Object.values(r.pack.gestures).flat().length);
  assert.match(r.pack.credit ?? "", /Crypton Future Media, INC\. www\.piapro\.net/);
  assert.ok((r.pack.credit ?? "").length <= 70, "short enough for one line on a phone");
  assert.match(r.pack.terms ?? "", /unofficial/i);
  assert.match(r.pack.terms ?? "", /non-commercial/i);
  assert.match(r.pack.terms ?? "", /Piapro Character License/);
  const notes = r.pack.notes.join("\n");
  assert.match(notes, /NOTICE\.md/);
  assert.doesNotMatch(notes, /different size|Not used|No pictures for/); // nothing odd about the set itself
  const notice = await readFile(join(root, "packs/miku/NOTICE.md"), "utf8");
  for (const needed of ["Piapro Character License", "Non-commercial only", "sublicens", "piapro.net/license/pcl"]) {
    assert.ok(notice.includes(needed), `NOTICE.md should mention "${needed}"`);
  }
});

test("the Risa (dress) pack that ships with the app is complete, with a wave and a cheer, and carries its credit", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const names = Object.keys(JSON.parse(await readFile(join(root, "emotions.json"), "utf8")));
  const r = await readPack(join(root, "packs"), "risa-dress", names);
  assert.ok(r.ok);
  for (const emotion of names) {
    const e = r.pack.emotions[emotion];
    assert.ok(e?.blink && e.talk.length === 3, `${emotion}: rest, blink and three mouth openings`);
  }
  assert.deepEqual(r.pack.gestures, { cheer: ["cheer-1.webp", "cheer-2.webp"], wave: ["wave-1.webp", "wave-2.webp"] });
  assert.equal(r.pack.files.size, names.length * 5 + 4);
  assert.match(r.pack.credit ?? "", /original character/);
  assert.match(r.pack.terms ?? "", /MIT/);
  const notes = r.pack.notes.join("\n");
  assert.doesNotMatch(notes, /different size|Not used|No pictures for/);
});

test("the Franzi (dirndl) pack that ships with the app is complete, with a wave and a cheer, and carries its credit", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const names = Object.keys(JSON.parse(await readFile(join(root, "emotions.json"), "utf8")));
  const r = await readPack(join(root, "packs"), "franzi-dress", names);
  assert.ok(r.ok);
  for (const emotion of names) {
    const e = r.pack.emotions[emotion];
    assert.ok(e?.blink && e.talk.length === 3, `${emotion}: rest, blink and three mouth openings`);
  }
  assert.deepEqual(r.pack.gestures, { cheer: ["cheer-1.webp", "cheer-2.webp"], wave: ["wave-1.webp", "wave-2.webp"] });
  assert.equal(r.pack.files.size, names.length * 5 + 4);
  assert.match(r.pack.credit ?? "", /original character/);
  assert.match(r.pack.terms ?? "", /Made with AI/);
  const notes = r.pack.notes.join("\n");
  assert.match(notes, /NOTICE\.md/);
  assert.doesNotMatch(notes, /different size|No pictures for/); // PROCESS.md is an extra note, so "Not used" is fine here
});

test("the Franzi (casual) pack that ships with the app is complete, with a wave and a cheer, and carries its credit", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const names = Object.keys(JSON.parse(await readFile(join(root, "emotions.json"), "utf8")));
  const r = await readPack(join(root, "packs"), "franzi-casual", names);
  assert.ok(r.ok);
  for (const emotion of names) {
    const e = r.pack.emotions[emotion];
    assert.ok(e?.blink && e.talk.length === 3, `${emotion}: rest, blink and three mouth openings`);
  }
  assert.deepEqual(r.pack.gestures, { cheer: ["cheer-1.webp", "cheer-2.webp"], wave: ["wave-1.webp", "wave-2.webp"] });
  assert.equal(r.pack.files.size, names.length * 5 + 4);
  assert.match(r.pack.credit ?? "", /original character/);
  assert.match(r.pack.terms ?? "", /Made with AI/);
  const notes = r.pack.notes.join("\n");
  assert.match(notes, /NOTICE\.md/);
  assert.doesNotMatch(notes, /different size|No pictures for/); // PROCESS.md is an extra note, so "Not used" is fine here
});

test("the Franzi (pajamas) pack that ships with the app is complete, with a wave and a cheer, and carries its credit", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const names = Object.keys(JSON.parse(await readFile(join(root, "emotions.json"), "utf8")));
  const r = await readPack(join(root, "packs"), "franzi-pajamas", names);
  assert.ok(r.ok);
  for (const emotion of names) {
    const e = r.pack.emotions[emotion];
    assert.ok(e?.blink && e.talk.length === 3, `${emotion}: rest, blink and three mouth openings`);
  }
  assert.deepEqual(r.pack.gestures, { cheer: ["cheer-1.webp", "cheer-2.webp"], wave: ["wave-1.webp", "wave-2.webp"] });
  assert.equal(r.pack.files.size, names.length * 5 + 4);
  assert.match(r.pack.credit ?? "", /original character/);
  assert.match(r.pack.terms ?? "", /Made with AI/);
  const notes = r.pack.notes.join("\n");
  assert.match(notes, /NOTICE\.md/);
  assert.doesNotMatch(notes, /different size|No pictures for/); // PROCESS.md is an extra note, so "Not used" is fine here
});

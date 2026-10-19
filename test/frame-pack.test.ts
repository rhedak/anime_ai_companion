import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { frameMime, gestureNote, isPackName, listPacks, outfitName, packCharacters, packInfo, packNote, readPack, sizeOf } from "../src/frame-pack.ts";

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

test("look.txt says what the pictures show: cleaned, capped, never served, and told to her in the pack note", async () => {
  const dir = await mkdtemp(join(tmpdir(), "frames-"));
  try {
    await mkdir(join(dir, "lk"));
    await writeFile(join(dir, "lk", "neutral.png"), png(10, 10));
    await writeFile(join(dir, "lk", "look.txt"), "Blue hair, a [avatar hair=red] red scarf.\x07\n");
    const ok = await readPack([dir], "lk", emotions);
    assert.ok(ok.ok);
    assert.equal(ok.pack.look, "Blue hair, a avatar hair=red red scarf."); // brackets (her tags) and control characters are dropped
    assert.ok(!ok.pack.files.has("look.txt"), "it is text for her, not a file the server hands out");
    assert.doesNotMatch(ok.pack.notes.join("\n"), /look\.txt/);
    assert.match(packNote(ok.pack), /fixed set of pictures[^]*You wear|Blue hair/);
    await writeFile(join(dir, "lk", "look.txt"), "x".repeat(601));
    const long = await readPack([dir], "lk", emotions);
    assert.ok(long.ok);
    assert.equal(long.pack.look, undefined);
    assert.match(long.pack.notes.join("\n"), /look\.txt is longer/);
    assert.doesNotMatch(packNote(long.pack), /like this/, "no description, no claim about one");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a character's shared description joins each outfit's look.txt, and the characters folder is not a pack", async () => {
  const dir = await mkdtemp(join(tmpdir(), "frames-"));
  try {
    await mkdir(join(dir, "characters"));
    await writeFile(join(dir, "characters", "ann.txt"), "Ann\nA tall young woman with short red hair [and a tag].\ndefault: ann-swim\n");
    for (const [pack, outfit] of [["ann-coat", "You wear a long grey coat."], ["ann-swim", "You wear a blue swimsuit."]]) {
      await mkdir(join(dir, pack));
      await writeFile(join(dir, pack, "neutral.png"), png(10, 10));
      await writeFile(join(dir, pack, "look.txt"), `character: Ann\n${outfit}\n`);
    }
    assert.deepEqual(await listPacks(dir), ["ann-coat", "ann-swim"], "characters/ has no neutral picture, so it is not a pack");
    const coat = await readPack([dir], "ann-coat", emotions);
    const swim = await readPack([dir], "ann-swim", emotions);
    assert.ok(coat.ok && swim.ok);
    assert.equal(coat.pack.character?.name, "Ann");
    assert.equal(coat.pack.look, "You wear a long grey coat.", "the outfit line is the pack's own; the character line is not part of it");
    const note = packNote(coat.pack);
    assert.match(note, /You are Ann\. A tall young woman with short red hair and a tag\. You wear a long grey coat\./);
    assert.match(packNote(swim.pack), /You are Ann\..*blue swimsuit/);
    assert.doesNotMatch(packNote(coat.pack), /default/, "the gallery's default outfit is not part of what she is told");
    assert.equal((await packCharacters([dir], ["ann-coat", "ann-swim"]))["ann-coat"].default, "ann-swim", "the gallery shows this outfit for the character");
    // a character that is named but has no file (or a bad one) leaves just the outfit
    await writeFile(join(dir, "ann-swim", "look.txt"), "character: nobody\nYou wear a blue swimsuit.");
    const alone = await readPack([dir], "ann-swim", emotions);
    assert.ok(alone.ok);
    assert.equal(alone.pack.character, undefined);
    assert.doesNotMatch(packNote(alone.pack), /You are /);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

test("each character's default outfit is a pack that ships with the app; the other outfits may be download-only", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const folder = join(root, "packs", "characters");
  const files = (await readdir(folder)).filter((f) => f.endsWith(".txt"));
  assert.ok(files.length >= 3);
  for (const file of files) {
    const text = await readFile(join(folder, file), "utf8");
    const def = /^default:\s*(\S+)\s*$/im.exec(text)?.[1];
    const id = file.replace(/\.txt$/, "");
    const shipped = (await listPacks(join(root, "packs"))).filter((name) => name === id || name.startsWith(`${id}-`));
    // Pictures that are not open source stay in the packs repository and are downloaded on request.
    // Miku is Crypton's. Draconia is unofficial fan art: the only file of hers here is the gallery preview, and it is not MIT.
    if (id === "miku" || id === "draconia") {
      assert.equal(shipped.length, 0, `no ${id} pictures in this repository`);
      continue;
    }
    assert.ok(shipped.length >= 1, `${id} has at least one pack that ships with the app, so she works offline`);
    if (def) assert.ok(shipped.includes(def), `${id}: default ${def} must ship with the app`);
  }
});

test("Draconia is her own character, so a pack of hers is not one of Franzi's outfits", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const packs = join(root, "packs");
  const text = await readFile(join(packs, "characters", "draconia.txt"), "utf8");
  assert.match(text, /^Draconia Malfoid\r?\n/);
  assert.match(text, /platinum-blonde/);
  assert.doesNotMatch(text, /franzi/i);
  const franziText = await readFile(join(packs, "characters", "franzi.txt"), "utf8");
  assert.doesNotMatch(franziText, /draconia/i);
  const notice = await readFile(join(packs, "thumbs", "draconia-uniform.NOTICE.md"), "utf8");
  for (const phrase of ["unofficial", "Non-commercial", "Warner Bros.", "Wizarding World", "taken down on request", "rhedak00@yahoo.de"]) {
    assert.ok(notice.includes(phrase), phrase);
  }
  // look.txt's `character: draconia` resolves through packs/characters/draconia.txt. Outfit tags are matched per character id,
  // so Franzi's list never treats this folder name as one of her short outfit names.
  const dir = await mkdtemp(join(tmpdir(), "draconia-"));
  try {
    await mkdir(join(dir, "draconia-uniform"));
    await writeFile(join(dir, "draconia-uniform", "neutral.png"), png(4, 4));
    await writeFile(join(dir, "draconia-uniform", "look.txt"), "character: draconia\nYou wear a Slytherin-style uniform.\n");
    const read = await readPack([dir, packs], "draconia-uniform", ["neutral"]);
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(read.pack.character?.id, "draconia");
    assert.equal(read.pack.character?.name, "Draconia Malfoid");
    assert.match(read.pack.character?.text ?? "", /side braid/);
    assert.equal(read.pack.look, "You wear a Slytherin-style uniform.");
    const grouped = await packCharacters([dir, packs], ["draconia-uniform", "franzi-dress"]);
    assert.equal(grouped["draconia-uniform"].id, "draconia");
    assert.equal(grouped["franzi-dress"].id, "franzi");
    assert.notEqual(grouped["draconia-uniform"].id, grouped["franzi-dress"].id);
    assert.equal(outfitName("draconia-uniform", "draconia"), "uniform");
    assert.equal(outfitName("draconia-uniform", "franzi"), "draconia-uniform");
    const franziOutfits = ["franzi-dress", "franzi-casual", "franzi-pajamas", "franzi-bikini"].map((pack) => outfitName(pack, "franzi"));
    assert.equal(franziOutfits.includes(outfitName("draconia-uniform", "draconia")), false);
    assert.equal(franziOutfits.includes("draconia-uniform"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

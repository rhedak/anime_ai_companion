import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import sharp from "sharp";
import { readPack } from "../src/frame-pack.ts";
import { buildPackArchive, formatReport, indexEntryForArchive, restorePackArchive } from "../src/pack-archive.ts";
import { readTar, writeTar } from "../src/tar-store.ts";
import { decodeRgba, encodeRgba } from "../src/webp-rgba.ts";

const exec = promisify(execFile);
const root = join(import.meta.dirname, "..");
const emotions = ["neutral", "happy", "sad", "angry", "surprised", "shy", "thinking"];

function setPixel(data: Buffer, width: number, x: number, y: number, rgba: [number, number, number, number]) {
  data.set(rgba, (y * width + x) * 4);
}

/** A small lossless WebP. Pixel (0, 0) is transparent but keeps a colour, which the patch format has to preserve. */
async function frame(width: number, height: number, paint?: (data: Buffer) => void): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 40;
    data[i + 1] = 50;
    data[i + 2] = 60;
    data[i + 3] = 255;
  }
  setPixel(data, width, 0, 0, [9, 8, 7, 0]);
  paint?.(data);
  const encoded = await encodeRgba({ width, height, data });
  assert.ok(encoded);
  return encoded;
}

async function withFolder(files: Record<string, Buffer | string>, run: (folder: string) => Promise<void>) {
  const parent = await mkdtemp(join(tmpdir(), "pack-"));
  const folder = join(parent, "mina");
  await mkdir(folder);
  try {
    for (const [name, body] of Object.entries(files)) await writeFile(join(folder, name), body);
    await run(folder);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

const texts = { "credit.txt": "Mina, an original character.\nMade with AI.\n", "NOTICE.md": "MIT, with the usual caveat about pictures made with AI.\n" };

test("a patch archive restores base frames byte for byte and blink and talk frames pixel for pixel", async () => {
  const width = 8;
  const height = 6;
  const neutral = await frame(width, height);
  const blink = await frame(width, height, (data) => {
    setPixel(data, width, 3, 2, [1, 2, 3, 255]);
    setPixel(data, width, 4, 2, [4, 5, 6, 0]);
  });
  const talk = await frame(width, height);
  const wave = await frame(width, height, (data) => setPixel(data, width, 7, 5, [200, 10, 10, 255]));
  await withFolder({ "neutral.webp": neutral, "neutral-blink.webp": blink, "neutral-talk1.webp": talk, "wave-1.webp": wave, ...texts }, async (folder) => {
    const built = await buildPackArchive(folder, { emotions });
    assert.equal(built.ok, true, !built.ok ? built.reason : "");
    if (!built.ok) return;
    const again = await buildPackArchive(folder, { emotions });
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.ok(built.archive.equals(again.archive), "the same folder builds the same archive, so its sha256 stays put");

    assert.equal(built.report.baseCount, 2);
    assert.equal(built.report.patchCount, 2);
    const blinkRow = built.report.files.find((file) => file.name === "neutral-blink.webp");
    assert.ok(blinkRow?.box && blinkRow.box.width > 0 && blinkRow.storedBytes < blinkRow.sourceBytes);
    const talkRow = built.report.files.find((file) => file.name === "neutral-talk1.webp");
    assert.deepEqual(talkRow?.box, { x: 0, y: 0, width: 0, height: 0 });
    assert.equal(talkRow?.storedBytes, 0);
    assert.match(formatReport(built.report), /2 base frames stored whole/);

    const archivePath = join(folder, "..", "mina.tar");
    await writeFile(archivePath, built.archive);
    // Run in the archive's folder with a bare name: GNU tar (first on the PATH in Git Bash) reads `C:\…` as a host name.
    const listing = execFileSync("tar", ["-tf", "mina.tar"], { encoding: "utf8", cwd: join(folder, "..") });
    assert.match(listing, /manifest\.json/);
    assert.match(listing, /base\/neutral\.webp/);
    assert.match(listing, /patch\/neutral-blink\.webp/);
    assert.doesNotMatch(listing, /neutral-talk1/);

    const dest = join(folder, "..", "out");
    const restored = await restorePackArchive(built.archive, dest);
    assert.equal(restored.ok, true, !restored.ok ? restored.reason : "");
    assert.ok((await readFile(join(dest, "neutral.webp"))).equals(neutral));
    assert.ok((await readFile(join(dest, "wave-1.webp"))).equals(wave));
    assert.ok((await readFile(join(dest, "credit.txt"))).equals(Buffer.from(texts["credit.txt"])));
    assert.ok((await readFile(join(dest, "NOTICE.md"))).equals(Buffer.from(texts["NOTICE.md"])));
    for (const name of ["neutral-blink.webp", "neutral-talk1.webp"]) {
      const original = await decodeRgba(await readFile(join(folder, name)));
      const back = await decodeRgba(await readFile(join(dest, name)));
      assert.ok(original && back);
      assert.equal(back.width, original.width);
      assert.ok(back.data.equals(original.data), `${name} pixels differ`);
    }

    const listed = readTar(built.archive);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    const tampered = new Map(listed.files);
    const base = Buffer.from(tampered.get("base/neutral.webp")!);
    base[20] ^= 0xff;
    tampered.set("base/neutral.webp", base);
    const rewritten = writeTar([...tampered.entries()].map(([name, data]) => ({ name, data })));
    assert.equal(rewritten.ok, true);
    if (!rewritten.ok) return;
    const refused = await restorePackArchive(rewritten.archive, join(folder, "..", "bad"));
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.match(refused.reason, /neutral\.webp does not match the hash/);

    const entry = indexEntryForArchive(built.archive, {
      name: "Mina",
      version: "1",
      url: "https://github.com/rhedak/anime_ai_companion/releases/download/pack-mina-1/mina-1.tar",
      aiMade: true,
    });
    assert.equal(entry.ok, true, !entry.ok ? entry.reason : "");
    if (entry.ok) {
      assert.equal(entry.entry.id, "mina");
      assert.equal(entry.entry.frameCount, 4);
      assert.equal(entry.entry.sizes.width, width);
      assert.equal(entry.entry.hashes.sha256.length, 64);
    }
  });
});

test("a pack archive refuses a folder that is not a lossless WebP pack", async () => {
  const neutral = await frame(4, 4);
  const lossy = await sharp(Buffer.alloc(4 * 4 * 4, 255), { raw: { width: 4, height: 4, channels: 4 } }).webp({ quality: 80 }).toBuffer();
  await withFolder({ "neutral.webp": lossy, ...texts }, async (folder) => {
    const built = await buildPackArchive(folder, { emotions });
    assert.equal(built.ok, false);
    if (!built.ok) assert.match(built.reason, /not a lossless WebP/);
  });
  await withFolder({ "neutral.webp": neutral, "happy.png": neutral, ...texts }, async (folder) => {
    const built = await buildPackArchive(folder, { emotions });
    assert.equal(built.ok, false);
    if (!built.ok) assert.match(built.reason, /not WebP/);
  });
  await withFolder({ "neutral.webp": neutral, "happy-blink.webp": neutral, ...texts }, async (folder) => {
    const built = await buildPackArchive(folder, { emotions });
    assert.equal(built.ok, false);
    if (!built.ok) assert.match(built.reason, /happy-blink\.webp has no happy\.webp/);
  });
  await withFolder({ "neutral.webp": neutral, "happy.webp": await frame(5, 5), ...texts }, async (folder) => {
    const built = await buildPackArchive(folder, { emotions });
    assert.equal(built.ok, false);
    if (!built.ok) assert.match(built.reason, /same size/);
  });
  await withFolder({ "neutral.webp": neutral, "notes.txt": "x", ...texts }, async (folder) => {
    const built = await buildPackArchive(folder, { emotions });
    assert.equal(built.ok, false);
    if (!built.ok) assert.match(built.reason, /notes\.txt/);
  });
  await withFolder({ "neutral.webp": neutral, "credit.txt": texts["credit.txt"] }, async (folder) => {
    const built = await buildPackArchive(folder, { emotions });
    assert.equal(built.ok, false);
    if (!built.ok) assert.match(built.reason, /credit\.txt and NOTICE\.md/);
  });
});

test("the archive reader refuses a path that leaves the archive", () => {
  const unsafe = writeTar([{ name: "../secret.txt", data: Buffer.from("no") }]);
  assert.equal(unsafe.ok, false);
  const crafted = craftTar("../secret.txt", Buffer.from("no"));
  const read = readTar(crafted);
  assert.equal(read.ok, false);
  if (!read.ok) assert.match(read.reason, /not a safe path/);
  const link = craftTar("base/neutral.webp", Buffer.from("x"), "2");
  const linked = readTar(link);
  assert.equal(linked.ok, false);
  if (!linked.ok) assert.match(linked.reason, /link/);
});

test("the build command writes an archive the restore command reads back", async () => {
  const parent = await mkdtemp(join(tmpdir(), "pack-cli-"));
  try {
    const folder = join(parent, "mina");
    await mkdir(folder);
    await writeFile(join(folder, "neutral.webp"), await frame(4, 4));
    await writeFile(join(folder, "neutral-blink.webp"), await frame(4, 4, (data) => setPixel(data, 4, 1, 1, [9, 9, 9, 255])));
    await writeFile(join(folder, "credit.txt"), texts["credit.txt"]);
    await writeFile(join(folder, "NOTICE.md"), texts["NOTICE.md"]);
    const archive = join(parent, "mina.tar");
    const built = await exec(process.execPath, [join(root, "src/pack-archive-cli.ts"), "build", folder, "-o", archive], { cwd: root });
    assert.match(built.stdout, /mina: 2 frames/);
    const restored = await exec(process.execPath, [join(root, "src/pack-archive-cli.ts"), "restore", archive, "-o", join(parent, "back")]);
    assert.match(restored.stdout, /restored/);
    const indexed = await exec(process.execPath, [
      join(root, "src/pack-archive-cli.ts"),
      "index",
      archive,
      "--name",
      "Mina",
      "--version",
      "1",
      "--url",
      "https://github.com/rhedak/anime_ai_companion/releases/download/pack-mina-1/mina-1.tar",
      "--ai-made",
    ]);
    const index = JSON.parse(indexed.stdout);
    assert.equal(index.format, 1);
    assert.equal(index.packs[0].id, "mina");
    assert.equal(index.packs[0].aiMade, true);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("franzi-dress round-trips pixel for pixel, and the patch archive is about 4.2 MB", { timeout: 180_000 }, async () => {
  const folder = await franziPack();
  const built = await buildPackArchive(folder, { id: "franzi-dress", emotions });
  assert.equal(built.ok, true, !built.ok ? built.reason : "");
  if (!built.ok) return;
  const { report } = built;
  assert.equal(report.id, "franzi-dress");
  assert.equal(report.width, 940);
  assert.equal(report.height, 1070);
  assert.equal(report.frameCount, 39);
  assert.equal(report.baseCount, 11);
  assert.equal(report.patchCount, 28);
  assert.equal(report.framesBytes, 14_049_032);
  assert.equal(report.baseBytes, 4_071_740);
  assert.equal(report.patchBytes, 101_078);
  // Git stores the text as LF (4,211 bytes). A Windows checkout adds one CR per line (4,265). The extra
  // bytes fit in the tar's padding or spill into the next block; the pictures are unchanged either way.
  const textLf = 4_211;
  const textCrlf = 4_265;
  const textOnDisk = await textFileBytes(folder);
  assert.equal(report.textBytes, textOnDisk);
  assert.ok(textOnDisk === textLf || textOnDisk === textCrlf, `text files are ${textOnDisk} bytes`);
  const archiveBytes = 4_221_440;
  assert.ok(report.archiveBytes >= archiveBytes && report.archiveBytes <= archiveBytes + 2048, `the archive is ${report.archiveBytes} bytes`);
  const other = await packWithLineEndings(folder, textOnDisk !== textLf);
  try {
    const again = await buildPackArchive(other, { id: "franzi-dress", emotions });
    assert.equal(again.ok, true, !again.ok ? again.reason : "");
    if (again.ok) {
      assert.equal(again.report.framesBytes, report.framesBytes);
      assert.equal(again.report.baseBytes, report.baseBytes);
      assert.equal(again.report.patchBytes, report.patchBytes);
      assert.ok(Math.abs(again.report.archiveBytes - report.archiveBytes) <= 2048);
      assert.equal(again.report.textBytes, textOnDisk === textLf ? textCrlf : textLf);
      assert.equal(again.report.textBytes, await textFileBytes(other));
    }
  } finally {
    await rm(dirname(other), { recursive: true, force: true });
  }

  const destParent = await mkdtemp(join(tmpdir(), "pack-out-"));
  try {
    const dest = join(destParent, "franzi-dress");
    const restored = await restorePackArchive(built.archive, dest);
    assert.equal(restored.ok, true, !restored.ok ? restored.reason : "");
    const names = (await readdir(folder)).filter((name) => !name.startsWith(".")).sort((a, b) => a.localeCompare(b));
    assert.deepEqual(restored.ok ? restored.files : [], names);
    for (const name of names) {
      const original = await readFile(join(folder, name));
      const back = await readFile(join(dest, name));
      if (name.endsWith(".webp") && report.files.find((file) => file.name === name)?.kind === "patch") {
        const a = await decodeRgba(original);
        const b = await decodeRgba(back);
        assert.ok(a && b, name);
        assert.ok(a.data.equals(b.data), `${name} pixels differ`);
      } else {
        assert.ok(original.equals(back), `${name} bytes differ`);
      }
    }
    const pack = await readPack(destParent, "franzi-dress", emotions);
    assert.equal(pack.ok, true, !pack.ok ? pack.reason : "");
    if (!pack.ok) return;
    for (const emotion of emotions) assert.ok(pack.pack.emotions[emotion]?.blink && pack.pack.emotions[emotion].talk.length === 3, emotion);
    assert.deepEqual(pack.pack.gestures, { cheer: ["cheer-1.webp", "cheer-2.webp"], wave: ["wave-1.webp", "wave-2.webp"] });
    assert.match(pack.pack.credit ?? "", /original character/);
    assert.match(pack.pack.terms ?? "", /Made with AI/);
  } finally {
    await rm(destParent, { recursive: true, force: true });
  }
});

const TEXT_FILES = ["credit.txt", "NOTICE.md", "PROCESS.md", "look.txt"];

async function textFileBytes(folder: string): Promise<number> {
  let total = 0;
  for (const name of TEXT_FILES) total += (await readFile(join(folder, name)).catch(() => Buffer.alloc(0))).length;
  return total;
}

/** A copy of the pack whose text files use LF, or CRLF. The pictures are copied unchanged. */
async function packWithLineEndings(folder: string, lf: boolean): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "pack-eol-"));
  const out = join(parent, "franzi-dress");
  await mkdir(out);
  for (const name of await readdir(folder)) {
    const bytes = await readFile(join(folder, name));
    const body = name.endsWith(".webp") ? bytes : Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n").replace(/\n/g, lf ? "\n" : "\r\n"));
    await writeFile(join(out, name), body);
  }
  return out;
}

/** The Franzi dirndl pack ships in `packs/` (the one outfit of Franzi that stays bundled), so it is the real-pack fixture. */
async function franziPack(): Promise<string> {
  const shipped = join(root, "packs", "franzi-dress");
  assert.equal(await isPack(shipped), true, "packs/franzi-dress ships with the app");
  return shipped;
}

async function isPack(folder: string): Promise<boolean> {
  return readFile(join(folder, "neutral.webp"))
    .then(() => true)
    .catch(() => false);
}

/** A ustar member whose name the writer would refuse, so the reader is checked on its own. */
function craftTar(name: string, data: Buffer, typeflag = "0"): Buffer {
  const block = 512;
  const header = Buffer.alloc(block);
  header.write(name, 0, "ascii");
  const octal = (value: number, length: number, at: number) => header.write(value.toString(8).padStart(length - 1, "0"), at, "ascii");
  octal(0o644, 8, 100);
  octal(0, 8, 108);
  octal(0, 8, 116);
  octal(data.length, 12, 124);
  octal(0, 12, 136);
  header.fill(0x20, 148, 156);
  header[156] = typeflag.charCodeAt(0);
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  let sum = 0;
  for (let i = 0; i < block; i++) sum += header[i];
  header.write(sum.toString(8).padStart(6, "0"), 148, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  const pad = (block - (data.length % block)) % block;
  return Buffer.concat([header, data, Buffer.alloc(pad + block * 2)]);
}

test("the manifest command describes a pack folder for a static host: which picture is which, by file name, with the pack's character and credit", async () => {
  const { execFileSync } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "pack-manifest-"));
  try {
    const out = join(dir, "pack.json");
    execFileSync(process.execPath, [join(root, "src", "pack-archive-cli.ts"), "manifest", await franziPack(), "-o", out], { stdio: "pipe" });
    const info = JSON.parse(await readFile(out, "utf8"));
    assert.equal(info.name, "franzi-dress");
    assert.equal(info.character, "franzi");
    assert.equal(info.emotions.neutral.idle, "neutral.webp", "a bare file name: the pictures sit beside the file");
    assert.deepEqual(info.emotions.happy.talk, ["happy-talk1.webp", "happy-talk2.webp", "happy-talk3.webp"]);
    assert.deepEqual(Object.keys(info.gestures).sort(), ["cheer", "wave"]);
    assert.match(info.credit, /Franzi/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

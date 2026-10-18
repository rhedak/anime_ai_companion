import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import sharp from "sharp";
import { listPacks, readPack } from "../src/frame-pack.ts";
import { buildPackArchive, indexEntryForArchive } from "../src/pack-archive.ts";
import {
  DEFAULT_PACK_INDEX_URL,
  createPackInstaller,
  packIndexUrl,
  type PackFetch,
  type PackFetchResponse,
  type PackProgress,
} from "../src/pack-install.ts";
import { parsePackIndex } from "../src/pack-index.ts";
import { readTar } from "../src/tar-store.ts";
import { decodeRgba, encodeRgba } from "../src/webp-rgba.ts";
import { cannotRunServer, startServer } from "./helpers/server.ts";

const exec = promisify(execFile);
const root = join(import.meta.dirname, "..");
const emotions = Object.keys(JSON.parse(await readFile(join(root, "emotions.json"), "utf8")) as Record<string, unknown>);
const texts = { "credit.txt": "Mina, an original character.\nMade with AI.\n", "NOTICE.md": "MIT, with the usual caveat about pictures made with AI.\n" };

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function response(status: number, body: Buffer, url: string, contentLength?: number): PackFetchResponse {
  const length = contentLength ?? body.length;
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name) => (name.toLowerCase() === "content-length" ? String(length) : null) },
    arrayBuffer: async () => Uint8Array.from(body).buffer,
  };
}

async function frame(width: number, height: number, pixel?: [number, number, number, number]): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 4, 40);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  if (pixel) data.set(pixel, 0);
  const encoded = await encodeRgba({ width, height, data });
  assert.ok(encoded);
  return encoded;
}

async function tinyArchive(): Promise<{ archive: Buffer; neutral: Buffer; thumb: Buffer }> {
  const neutral = await frame(4, 4);
  const blink = await frame(4, 4, [9, 8, 7, 255]);
  const parent = await mkdtemp(join(tmpdir(), "pack-src-"));
  const folder = join(parent, "mina");
  await mkdir(folder);
  await writeFile(join(folder, "neutral.webp"), neutral);
  await writeFile(join(folder, "neutral-blink.webp"), blink);
  await writeFile(join(folder, "credit.txt"), texts["credit.txt"]);
  await writeFile(join(folder, "NOTICE.md"), texts["NOTICE.md"]);
  const built = await buildPackArchive(folder, { emotions });
  await rm(parent, { recursive: true, force: true });
  assert.equal(built.ok, true, !built.ok ? built.reason : "");
  if (!built.ok) throw new Error("archive");
  const thumb = await sharp(neutral).resize({ width: 2 }).webp().toBuffer();
  return { archive: built.archive, neutral, thumb };
}

test("the pack index address is the placeholder unless COMPANION_PACK_INDEX says otherwise", () => {
  assert.equal(packIndexUrl({}), DEFAULT_PACK_INDEX_URL);
  assert.match(DEFAULT_PACK_INDEX_URL, /^https:\/\/rhedak\.github\.io\/anime_ai_companion-packs\/index\.json$/);
  assert.equal(packIndexUrl({ COMPANION_PACK_INDEX: "off" }), null);
  assert.equal(packIndexUrl({ COMPANION_PACK_INDEX: "" }), null);
  assert.equal(packIndexUrl({ COMPANION_PACK_INDEX: "https://example.com/packs/index.json" }), "https://example.com/packs/index.json");
});

test("an installer downloads a pack once, checks the hash, and leaves a folder that is already there", async () => {
  const { archive, neutral, thumb } = await tinyArchive();
  const made = indexEntryForArchive(archive, {
    name: "Mina",
    version: "1",
    url: "https://packs.example.com/mina-1.tar",
    thumbnail: "thumbs/mina.webp",
    credit: "Mina, an original character.",
    aiMade: true,
  });
  assert.equal(made.ok, true, !made.ok ? made.reason : "");
  if (!made.ok) return;
  const entry = made.entry;
  const calls: string[] = [];
  const fetchImpl: PackFetch = async (url) => {
    calls.push(url);
    if (url === "https://packs.example.com/index.json") return response(200, Buffer.from(JSON.stringify({ format: 1, packs: [entry] })), url);
    if (url === entry.url) return response(200, archive, url);
    if (url === "https://packs.example.com/thumbs/mina.webp") return response(200, thumb, url);
    return response(404, Buffer.from("no"), url);
  };
  const destDir = await mkdtemp(join(tmpdir(), "pack-dest-"));
  try {
    const installer = createPackInstaller({ destDir, indexUrl: "https://packs.example.com/index.json", fetch: fetchImpl });
    assert.equal(await installer.thumbnail("mina"), null, "a preview is not fetched before the index is known");
    assert.equal(calls.length, 0);
    const loaded = await installer.loadIndex();
    assert.equal(loaded.ok, true, !loaded.ok ? loaded.reason : "");
    const preview = await installer.thumbnail("mina");
    assert.ok(preview?.equals(thumb));
    assert.equal(await installer.thumbnail("mina") && calls.filter((url) => url.endsWith("mina.webp")).length, 1);

    const progress: PackProgress[] = [];
    const installed = await installer.install("mina", (event) => progress.push(event));
    assert.equal(installed.ok, true, !installed.ok ? installed.reason : "");
    if (!installed.ok) return;
    assert.equal(installed.status, "installed");
    assert.ok((await readFile(join(destDir, "mina", "neutral.webp"))).equals(neutral));
    assert.equal(JSON.parse(await readFile(join(destDir, "mina", ".pack-install.json"), "utf8")).sha256, entry.hashes.sha256);
    assert.ok(progress.some((event) => event.phase === "download" && event.received === archive.length && event.total === archive.length));
    assert.equal(progress.at(-1)?.phase, "done");
    const pack = await readPack(destDir, "mina", emotions);
    assert.equal(pack.ok, true, !pack.ok ? pack.reason : "");

    const again = await installer.install("mina");
    assert.equal(again.ok && again.status, "already");
    assert.equal(calls.filter((url) => url.endsWith(".tar")).length, 1);

    const badDir = await mkdtemp(join(tmpdir(), "pack-bad-"));
    const bad = { ...entry, hashes: { sha256: "0".repeat(64) }, version: "2" };
    const refused = createPackInstaller({
      destDir: badDir,
      indexUrl: "https://packs.example.com/index.json",
      fetch: async (url) => {
        if (url.endsWith("/index.json")) return response(200, Buffer.from(JSON.stringify({ format: 1, packs: [bad] })), url);
        if (url === bad.url) return response(200, archive, url);
        return response(404, Buffer.from("no"), url);
      },
    });
    const rejected = await refused.install("mina");
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.reason, /sha256/);
    const leftover = await readdir(badDir);
    assert.equal(leftover.some((name) => name === "mina" || name.startsWith(".staging") || name.startsWith(".incoming")), false);
    await rm(badDir, { recursive: true, force: true });
  } finally {
    await rm(destDir, { recursive: true, force: true });
  }
});

test("a download that is the wrong size, a dead index, and an existing folder are handled without writing over anything", async () => {
  const { archive } = await tinyArchive();
  const made = indexEntryForArchive(archive, {
    name: "Mina",
    version: "1",
    url: "https://packs.example.com/mina-1.tar",
  });
  assert.equal(made.ok, true, !made.ok ? made.reason : "");
  if (!made.ok) return;
  const destDir = await mkdtemp(join(tmpdir(), "pack-safe-"));
  try {
    const short = createPackInstaller({
      destDir,
      indexUrl: "https://packs.example.com/index.json",
      fetch: async (url) => {
        if (url.endsWith("/index.json")) {
          const entry = { ...made.entry, sizes: { ...made.entry.sizes, archiveBytes: made.entry.sizes.archiveBytes - 1 } };
          return response(200, Buffer.from(JSON.stringify({ format: 1, packs: [entry] })), url);
        }
        return response(200, archive, url);
      },
    });
    const sized = await short.install("mina");
    assert.equal(sized.ok, false);
    if (!sized.ok) assert.match(sized.reason, /bytes/);
    assert.equal(await readdir(destDir).then((names) => names.includes("mina")), false);

    let fetched = false;
    const blocked = createPackInstaller({
      destDir,
      indexUrl: "http://evil.example/index.json",
      fetch: async () => {
        fetched = true;
        return response(200, Buffer.from("{}"), "http://evil.example/index.json");
      },
    });
    const refused = await blocked.loadIndex();
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.match(refused.reason, /https/);
    assert.equal(fetched, false);

    const offline = createPackInstaller({
      destDir,
      indexUrl: "https://packs.example.com/index.json",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const down = await offline.loadIndex();
    assert.equal(down.ok, false);
    if (!down.ok) assert.match(down.reason, /could not be reached/);
    assert.match(offline.indexNote() ?? "", /could not be reached/);
    const missing = await offline.install("mina");
    assert.equal(missing.ok, false);

    await mkdir(join(destDir, "mina"));
    await writeFile(join(destDir, "mina", "neutral.webp"), Buffer.from("keep-me"));
    let archives = 0;
    const present = createPackInstaller({
      destDir,
      indexUrl: "https://packs.example.com/index.json",
      fetch: async (url) => {
        if (url.endsWith(".tar")) archives += 1;
        if (url.endsWith("/index.json")) return response(200, Buffer.from(JSON.stringify({ format: 1, packs: [made.entry] })), url);
        return response(200, archive, url);
      },
    });
    const left = await present.install("mina");
    assert.equal(left.ok && left.status, "present");
    assert.equal(archives, 0);
    assert.equal(await readFile(join(destDir, "mina", "neutral.webp"), "utf8"), "keep-me");
  } finally {
    await rm(destDir, { recursive: true, force: true });
  }
});

test("every shipped pack has a 200 px thumbnail, and that folder is not a pack", async () => {
  const packsDir = join(root, "packs");
  const names = (await readdir(packsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  assert.ok(names.includes("thumbs"));
  assert.equal((await listPacks(packsDir)).includes("thumbs"), false);
  assert.equal((await listPacks(packsDir)).includes("characters"), false, "characters/ holds the shared character texts, not pictures");
  for (const name of names) {
    if (name === "thumbs" || name === "characters") continue;
    const thumb = await readFile(join(packsDir, "thumbs", `${name}.webp`));
    const meta = await sharp(thumb).metadata();
    assert.equal(meta.format, "webp", name);
    assert.equal(meta.width, 200, name);
    assert.ok((meta.height ?? 0) > 100, name);
  }
});

test("a local server installs franzi-casual from its patch archive, and a second run does not download it again", { timeout: 180_000 }, async () => {
  const folder = await franziCasual();
  const built = await buildPackArchive(folder, { id: "franzi-casual", emotions });
  assert.equal(built.ok, true, !built.ok ? built.reason : "");
  if (!built.ok) return;
  const thumb = await sharp(join(folder, "neutral.webp")).resize({ width: 200 }).webp().toBuffer();
  const files = new Map<string, Buffer>([
    ["/franzi-casual.tar", built.archive],
    ["/thumbs/franzi-casual.webp", thumb],
  ]);
  let indexBody = Buffer.alloc(0);
  const hits = new Map<string, number>();
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    hits.set(path, (hits.get(path) ?? 0) + 1);
    const body = path === "/index.json" ? indexBody : files.get(path);
    if (!body) {
      res.writeHead(404).end("no");
      return;
    }
    res.writeHead(200).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const made = indexEntryForArchive(built.archive, {
    name: "Franzi (casual)",
    version: "1",
    description: "Franzi in a casual outfit. An original character; the pictures were made with AI.",
    url: "https://example.com/franzi-casual-1.tar",
    thumbnail: "thumbs/franzi-casual.webp",
    credit: "Franzi (casual): an original character, pictures made with AI.",
    aiMade: true,
  });
  assert.equal(made.ok, true, !made.ok ? made.reason : "");
  if (!made.ok) return;
  const entry = { ...made.entry, url: `${origin}/franzi-casual.tar` };
  indexBody = Buffer.from(JSON.stringify({ format: 1, packs: [entry] }));
  const parsed = parsePackIndex(JSON.parse(indexBody.toString("utf8")), { allowLoopbackHttp: true });
  assert.equal(parsed.ok, true, !parsed.ok ? parsed.reason : "");

  const destDir = await mkdtemp(join(tmpdir(), "pack-franzi-"));
  const installer = createPackInstaller({ destDir, indexUrl: `${origin}/index.json` });
  try {
    const preview = await installer.thumbnail("franzi-casual");
    assert.equal(preview, null);
    const loaded = await installer.loadIndex();
    assert.equal(loaded.ok, true, !loaded.ok ? loaded.reason : "");
    const shown = await installer.thumbnail("franzi-casual");
    assert.ok(shown?.equals(thumb));
    assert.equal(hits.get("/thumbs/franzi-casual.webp"), 1);
    assert.ok((await installer.thumbnail("franzi-casual"))?.equals(thumb));
    assert.equal(hits.get("/thumbs/franzi-casual.webp"), 1, "a second look uses the cached preview");

    const progress: PackProgress[] = [];
    const installed = await installer.install("franzi-casual", (event) => progress.push(event));
    assert.equal(installed.ok, true, !installed.ok ? installed.reason : "");
    if (!installed.ok) return;
    assert.equal(installed.status, "installed");
    assert.equal(hits.get("/franzi-casual.tar"), 1);
    assert.ok(progress.some((event) => event.phase === "download" && event.total === built.archive.length && event.received === built.archive.length));
    const dest = join(destDir, "franzi-casual");
    assert.ok((await readFile(join(dest, "neutral.webp"))).equals(await readFile(join(folder, "neutral.webp"))));
    assert.ok((await readFile(join(dest, "credit.txt"))).equals(await readFile(join(folder, "credit.txt"))));
    assert.ok((await readFile(join(dest, "NOTICE.md"))).equals(await readFile(join(folder, "NOTICE.md"))));
    const originalBlink = await decodeRgba(await readFile(join(folder, "neutral-blink.webp")));
    const restoredBlink = await decodeRgba(await readFile(join(dest, "neutral-blink.webp")));
    assert.ok(originalBlink && restoredBlink && originalBlink.data.equals(restoredBlink.data));
    const pack = await readPack(destDir, "franzi-casual", emotions);
    assert.equal(pack.ok, true, !pack.ok ? pack.reason : "");
    if (pack.ok) assert.ok(pack.pack.emotions.neutral?.blink);
    const leftovers = await readdir(destDir);
    assert.equal(leftovers.some((name) => name.startsWith(".staging") || name.startsWith(".incoming") || name.startsWith(".old")), false);

    const again = await installer.install("franzi-casual");
    assert.equal(again.ok && again.status, "already");
    assert.equal(hits.get("/franzi-casual.tar"), 1);

    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    const offline = await installer.loadIndex(true);
    assert.equal(offline.ok, false);
    if (!offline.ok) assert.match(offline.reason, /could not be reached|took too long/);
    assert.ok(await readFile(join(dest, "neutral.webp")).then(() => true), "the installed pack is still on disk when the list cannot be reached");
  } finally {
    await rm(destDir, { recursive: true, force: true });
    await closeServer(server);
  }
});

test("the gallery can download a pack that is not installed", { skip: cannotRunServer() ?? false }, async () => {
  const { archive, neutral, thumb } = await tinyArchive();
  const files = new Map<string, Buffer>([["/mina.tar", archive], ["/thumbs/mina.webp", thumb]]);
  let indexBody = Buffer.alloc(0);
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const body = path === "/index.json" ? indexBody : files.get(path);
    if (!body) {
      res.writeHead(404).end("no");
      return;
    }
    res.writeHead(200).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const made = indexEntryForArchive(archive, {
    name: "Mina",
    version: "1",
    url: "https://example.com/mina-1.tar",
    thumbnail: "thumbs/mina.webp",
    credit: "Mina, an original character.",
  });
  assert.equal(made.ok, true, !made.ok ? made.reason : "");
  if (!made.ok) return;
  indexBody = Buffer.from(JSON.stringify({ format: 1, packs: [{ ...made.entry, character: { id: "mina", name: "Mina" }, url: `${origin}/mina.tar` }] }));
  const app = await startServer({ env: { COMPANION_PACK_INDEX: `${origin}/index.json` } });
  try {
    const client = await app.client();
    const from = client.mark;
    client.send({ type: "pack-catalog" });
    const listed = await client.next((event) => event.type === "packs" && event.remote?.some((pack: { id: string }) => pack.id === "mina"), 10_000, from);
    assert.equal(listed.names.includes("mina"), false);
    assert.deepEqual(listed.remote.find((pack: { id: string }) => pack.id === "mina").character, { id: "mina", name: "Mina" }, "the gallery can group it under its character");
    assert.equal(listed.remote.find((pack: { id: string }) => pack.id === "mina").sizes.archiveBytes, archive.length, "and say how big it is");

    // Choosing it by name asks first: nothing is fetched until the page says yes.
    const asking = client.mark;
    client.send({ type: "user", text: "/frames mina" });
    const offer = await client.next((event) => event.type === "pack-offer", 10_000, asking);
    assert.equal(offer.id, "mina");
    assert.equal(offer.bytes, archive.length);
    assert.equal(offer.host, "127.0.0.1");
    assert.equal(existsSync(join(app.dir, "data", "frames", "mina")), false, "nothing was downloaded yet");

    // She can ask for it herself with [outfit …]: an outfit of her character that is not here raises the same question, and fetches nothing.
    const frames = join(app.dir, "data", "frames");
    await mkdir(join(frames, "characters"), { recursive: true });
    await mkdir(join(frames, "mina-day"), { recursive: true });
    await writeFile(join(frames, "characters", "mina.txt"), "Mina\nA small cheerful girl.\n");
    await writeFile(join(frames, "mina-day", "neutral.webp"), neutral);
    await writeFile(join(frames, "mina-day", "look.txt"), "character: mina\nYou wear a yellow raincoat.\n");
    client.send({ type: "user", text: "/frames mina-day" });
    await client.next((event) => event.type === "notice" && /Showing the pack "mina-day"/.test(event.text), 10_000, asking);
    const wearing = client.mark;
    client.send({ type: "user", text: "please OUTFIT mina" });
    const wishes = await client.next((event) => event.type === "pack-offer" && event.id === "mina", 10_000, wearing);
    assert.equal(wishes.bytes, archive.length);
    assert.equal(existsSync(join(frames, "mina")), false, "still nothing downloaded: only the user's yes does that");
    const preview = await fetch(`http://127.0.0.1:${app.port}/pack-thumb/mina`);
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get("content-type"), "image/webp");
    assert.ok(Buffer.from(await preview.arrayBuffer()).equals(thumb));

    const installing = client.mark;
    client.send({ type: "pack-install", name: "mina" });
    const notice = await client.next((event) => event.type === "notice" && String(event.text).includes('Showing the pack "mina"'), 20_000, installing);
    assert.match(notice.text, /Credit: Mina/);
    assert.ok((await readFile(join(app.dir, "data", "frames", "mina", "neutral.webp"))).equals(neutral));
    const after = client.events.filter((event) => event.type === "packs").at(-1);
    assert.ok(after?.names.includes("mina"));
    assert.equal(after?.remote?.some((pack: { id: string }) => pack.id === "mina"), false);
  } finally {
    await app.stop();
    await closeServer(server);
  }
});

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

/** franzi-casual is added on `add-franzi-casual`. Use it from this tree when it is here, otherwise from that branch. */
async function franziCasual(): Promise<string> {
  const shipped = join(root, "packs", "franzi-casual");
  if (await isPack(shipped)) return shipped;
  const cached = join(tmpdir(), "anaico-franzi-casual");
  if (await isPack(cached)) return cached;
  const ref = "origin/add-franzi-casual";
  const have = await exec("git", ["-C", root, "rev-parse", "--verify", "--quiet", ref]).then(() => true, () => false);
  if (!have) await exec("git", ["-C", root, "fetch", "--depth", "1", "origin", "add-franzi-casual"], { timeout: 120_000 });
  const tarPath = join(tmpdir(), "anaico-franzi-casual-src.tar");
  await exec("git", ["-C", root, "archive", "-o", tarPath, ref, "packs/franzi-casual"], { timeout: 60_000 });
  const archive = readTar(await readFile(tarPath));
  assert.equal(archive.ok, true, !archive.ok ? archive.reason : "");
  if (!archive.ok) throw new Error("no archive");
  await mkdir(cached, { recursive: true });
  const prefix = "packs/franzi-casual/";
  for (const [name, data] of archive.files) {
    if (!name.startsWith(prefix)) continue;
    const base = name.slice(prefix.length);
    if (!base || base.includes("/")) continue;
    await writeFile(join(cached, base), data);
  }
  assert.equal(await isPack(cached), true, "the add-franzi-casual branch did not contain packs/franzi-casual");
  return cached;
}

async function isPack(folder: string): Promise<boolean> {
  return readFile(join(folder, "neutral.webp"))
    .then(() => true)
    .catch(() => false);
}

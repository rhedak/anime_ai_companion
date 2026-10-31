import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assistFolder, assistedBackend, type AssistRequest } from "../src/studio/assisted.ts";
import { encodePng, makeRaster } from "../src/studio/raster.ts";

const picture = (r: number) => encodePng(makeRaster(64, 64, [r, 20, 30, 255]));
const waitUntil = async (what: string, ok: () => boolean) => {
  for (let i = 0; i < 400; i++) {
    if (ok()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out: ${what}`);
};

test("the by-hand maker puts the picture and the words in a folder, asks the page, and returns what the user gives back", async () => {
  const dir = await mkdtemp(join(tmpdir(), "assisted-"));
  try {
    const asked: AssistRequest[] = [];
    const maker = assistedBackend({ dir, onAssist: (r) => asked.push(r), pollMs: 10 });
    const info = await maker.info();
    assert.equal(info.assisted, true);
    assert.equal(info.paid, undefined);
    assert.equal(maker.maxTries, 1, "a person is not asked to redo a picture by itself");
    const drawing = maker.edit({ image: await picture(200), prompt: "a red scarf", seed: 1, width: 64, height: 64 });
    await waitUntil("the request", () => asked.length === 1);
    assert.deepEqual(asked[0], { n: 1, prompt: "a red scarf" });
    assert.deepEqual((await readdir(assistFolder(dir))).sort(), ["1-in.png", "1-prompt.txt"]);
    const answer = await picture(90);
    await writeFile(join(assistFolder(dir), "1-out.png"), answer);
    assert.deepEqual(await drawing, answer);
    assert.deepEqual(await readdir(assistFolder(dir)), [], "nothing is left behind");
    // The next picture is number 2.
    const second = maker.edit({ image: await picture(10), prompt: "again", seed: 2, width: 64, height: 64 });
    await waitUntil("the second request", () => asked.length === 2);
    assert.equal(asked[1].n, 2);
    await writeFile(join(assistFolder(dir), "2-out.webp"), await (await import("sharp")).default(answer).webp().toBuffer());
    assert.ok((await second).length > 0, "a WebP answer counts too");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a file that is not a picture is removed and asked for again, and stopping ends the wait", async () => {
  const dir = await mkdtemp(join(tmpdir(), "assisted-"));
  try {
    const asked: AssistRequest[] = [];
    const maker = assistedBackend({ dir, onAssist: (r) => asked.push(r), pollMs: 10 });
    const stop = new AbortController();
    const drawing = maker.edit({ image: await picture(200), prompt: "x", seed: 1, width: 64, height: 64 }, stop.signal);
    drawing.catch(() => {});
    await waitUntil("the request", () => asked.length === 1);
    await writeFile(join(assistFolder(dir), "1-out.png"), "this is not a picture");
    await waitUntil("asked again", () => asked.length === 2);
    assert.match(asked[1].error ?? "", /not a picture/);
    assert.ok(!(await readdir(assistFolder(dir))).includes("1-out.png"), "the bad file is gone");
    stop.abort();
    await assert.rejects(drawing, (e: Error) => e.name === "AbortError");
    assert.deepEqual(await readdir(assistFolder(dir)), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BackendError, httpBackend, makeBackend, XAI, type EditRequest, type ImageBackend } from "../src/studio/backend.ts";
import { parseJob } from "../src/studio/job.ts";
import { encodePng, makeRaster } from "../src/studio/raster.ts";
import { runBase, runStep, type StudioEvent } from "../src/studio/runner.ts";
import { startFakeBackend } from "./helpers/image-backend.ts";

/** A backend that only records what it was asked and answers with a small picture. */
function recorder(): { backend: ImageBackend; asked: EditRequest[] } {
  const asked: EditRequest[] = [];
  const backend: ImageBackend = {
    info: async () => ({ name: "recorder", model: null, revision: null, licence: null, edit: true, generate: false }),
    edit: async (req) => {
      asked.push(req);
      return encodePng(makeRaster(req.width, req.height, [200, 40, 50, 255]));
    },
    generate: async () => {
      throw new Error("not used");
    },
  };
  return { backend, asked };
}

const jobFields = { id: "job-ref123", kind: "redraw", name: "risa-faye", source: "risa-bikini", character: "risa", look: "", key: "magenta", width: 256, height: 288, backend: { url: "x", name: "recorder" }, seeds: [1, 2] };

test("a job says whether a reference picture gives the outfit or the character, and nothing otherwise", () => {
  const outfit = parseJob({ ...jobFields, outfit: "a gold halter top and shorts", reference: "outfit" });
  assert.ok(outfit.ok);
  if (outfit.ok) assert.equal(outfit.job.reference, "outfit");
  const other = parseJob({ ...jobFields, outfit: "a gold halter top and shorts", reference: "hat" });
  assert.ok(other.ok);
  if (other.ok) assert.equal(other.job.reference, null);
  const none = parseJob({ ...jobFields, outfit: "a gold halter top and shorts" });
  assert.ok(none.ok);
  if (none.ok) assert.equal(none.job.reference, null);
});

test("the local maker sends the reference pictures after the base, and sends none when there are none", async () => {
  const fake = await startFakeBackend();
  try {
    const pic = await encodePng(makeRaster(16, 16, [1, 2, 3, 255]));
    await httpBackend(fake.url).edit({ image: pic, references: [pic, pic], prompt: "x", seed: 1, width: 16, height: 16 });
    await httpBackend(fake.url).edit({ image: pic, prompt: "x", seed: 2, width: 16, height: 16 });
    const [withRefs, without] = fake.requests.filter((r) => r.path === "/edit");
    assert.equal((withRefs.body.references as unknown[]).length, 2);
    assert.equal("references" in without.body, false);
  } finally {
    await fake.stop();
  }
});

test("the makers that take one picture refuse references instead of dropping them", async () => {
  const pic = await encodePng(makeRaster(16, 16, [1, 2, 3, 255]));
  const req = { image: pic, references: [pic], prompt: "x", seed: 1, width: 16, height: 16 };
  await assert.rejects(makeBackend(XAI, { limitUsd: 10, spentUsd: 0 }).edit(req), (e: unknown) => e instanceof BackendError && /one picture at a time/.test(String(e.message)));
});

test("an outfit from a reference: the base is image 1, the reference is image 2, and the prompt says so", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studio-ref-"));
  try {
    const parsed = parseJob({ ...jobFields, outfit: "a gold halter top and shorts", reference: "outfit" });
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    await writeFile(join(dir, "reference.png"), await encodePng(makeRaster(32, 32, [9, 9, 9, 255])));
    const { backend, asked } = recorder();
    const source = makeRaster(94, 107, [200, 40, 50, 255]);
    await runBase(parsed.job, { dir, backend, emit: () => {}, source: await encodePng(source) });
    assert.equal(asked.length, 2);
    assert.equal(asked[0].references?.length, 1);
    assert.match(asked[0].prompt, /image 2/);
    assert.match(asked[0].prompt, /not its face, hair/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("one step draws one change once per seed from the kept picture, and keeps each in its step's folder", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studio-step-"));
  try {
    const parsed = parseJob({ ...jobFields, outfit: "a gold halter top and shorts" });
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    await writeFile(join(dir, "base-chosen.png"), await encodePng(makeRaster(256, 288, [120, 60, 60, 255])));
    const { backend, asked } = recorder();
    const events: StudioEvent[] = [];
    await runStep(parsed.job, { n: 1, change: "her hair to a short red bob", input: "base-chosen.png", seeds: [5, 6] }, { dir, backend, emit: (e) => events.push(e), source: Buffer.alloc(0) });
    assert.equal(asked.length, 2);
    assert.match(asked[0].prompt, /change only her hair to a short red bob/);
    assert.equal(asked[0].references, undefined);
    const candidates = events.filter((e) => e.type === "step-candidate");
    assert.equal(candidates.length, 2);
    assert.equal(events.at(-1)?.type, "step-done");
    const kept = await readFile(join(dir, "steps", "1", "seed-5.png"));
    assert.ok(kept.length > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a step can take a picture for the change, sent as image 2", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studio-step-ref-"));
  try {
    const parsed = parseJob({ ...jobFields, outfit: "a gold halter top and shorts" });
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    await writeFile(join(dir, "base-chosen.png"), await encodePng(makeRaster(256, 288, [120, 60, 60, 255])));
    const { backend, asked } = recorder();
    await runStep(parsed.job, { n: 2, change: "her jacket to the one in image 2", input: "base-chosen.png", reference: await encodePng(makeRaster(32, 32, [0, 0, 0, 255])), seeds: [7] }, { dir, backend, emit: () => {}, source: Buffer.alloc(0) });
    assert.equal(asked[0].references?.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("her suggested steps are read from [studio step=…] tags, one change each", async () => {
  const { findStudioTags } = await import("../src/studio/tags.ts");
  const found = findStudioTags('Try these: [studio step="her hair to a short red bob"] and [studio step="a brown leather jacket over the top"]');
  assert.deepEqual(
    found.map((p) => p.step),
    ["her hair to a short red bob", "a brown leather jacket over the top"],
  );
});

test("a job reads a new character and an upload source, and defaults to a pack of an existing character", () => {
  const plain = parseJob({ ...jobFields, outfit: "a gold halter top and shorts" });
  assert.ok(plain.ok);
  if (plain.ok) {
    assert.equal(plain.job.sourceKind, "pack");
    assert.equal(plain.job.newCharacter, null);
  }
  const fresh = parseJob({ ...jobFields, outfit: "a gold halter top and shorts", sourceKind: "upload", newCharacter: { id: "mira", name: "Mira", description: "a quiet <b>engineer</b> [remember x]" } });
  assert.ok(fresh.ok);
  if (fresh.ok) {
    assert.equal(fresh.job.sourceKind, "upload");
    // Our own tags and markup characters are removed before the text goes into a prompt or a character file.
    assert.equal(fresh.job.newCharacter?.id, "mira");
    assert.equal(fresh.job.newCharacter?.name, "Mira");
    assert.doesNotMatch(fresh.job.newCharacter?.description ?? "", /[<>\[\]]|remember/);
  }
  // A reserved or badly formed id is not a new character (the job still reads as an outfit of a pack).
  for (const id of ["thumbs", "characters", "Bad Id", "-x"]) {
    const bad = parseJob({ ...jobFields, outfit: "a gold halter top and shorts", newCharacter: { id, name: "X", description: "" } });
    assert.ok(bad.ok);
    if (bad.ok) assert.equal(bad.job.newCharacter, null, id);
  }
});

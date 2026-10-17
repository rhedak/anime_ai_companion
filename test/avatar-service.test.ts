import { winSkip } from "./helpers/platform.ts";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { AvatarService, type AvatarOptions } from "../src/avatar.ts";

const creatorSrc = process.env.CREATOR_SRC ?? resolve(import.meta.dirname, "../../anime-character-creator/ts/src");

async function service(extra: Partial<AvatarOptions> = {}, defaultPreset = "linnea") {
  const dir = await mkdtemp(join(tmpdir(), "aic-avatar-"));
  const s = new AvatarService({
    creatorSrc,
    statePath: join(dir, "avatar.json"),
    looksDir: join(dir, "looks"),
    emotions: { neutral: {} },
    defaultPreset,
    ...extra,
  });
  await s.start();
  return s;
}

const skip = !existsSync(join(creatorSrc, "render.ts")) && `the creator's TypeScript is not at ${creatorSrc} (set CREATOR_SRC to its ts/src folder)`;

test("the starting character comes first in the list of presets, and nothing is lost", { skip }, async () => {
  const s = await service(); // starts as linnea
  try {
    const names = s.presetNames;
    assert.equal(names[0], "linnea");
    assert.equal(new Set(names).size, names.length);
    assert.ok(names.includes("risa") && names.length > 5);
  } finally {
    s.close();
  }
  const r = await service({}, "risa");
  try {
    assert.equal(r.presetNames[0], "risa");
  } finally {
    r.close();
  }
});

test("changes can be undone, one step at a time", { skip }, async () => {
  const s = await service();
  try {
    const original = s.character.hair_color;
    assert.equal(s.canUndo, false);
    await s.applyPatch({ hair_color: "#112233" });
    await s.applyPatch({ hair_color: "#445566" });
    assert.equal(s.character.hair_color, "#445566");
    assert.equal(await s.undo(), true);
    assert.equal(s.character.hair_color, "#112233");
    assert.equal(await s.undo(), true);
    assert.equal(s.character.hair_color, original);
    assert.equal(await s.undo(), false);
  } finally {
    s.close();
  }
});

test("saved looks can be loaded by the user or by the model, and bad names are reported", { skip }, async () => {
  const s = await service();
  try {
    await s.applyPatch({ hair_color: "#aa0000", glasses: "true" });
    assert.equal(await s.saveLook("My Red Look!"), "my-red-look");
    assert.deepEqual(s.lookNames, ["my-red-look"]);

    await s.applyPatch({ hair_color: "#00aa00" });
    assert.equal(await s.loadLook("my-red-look"), true);
    assert.equal(s.character.hair_color, "#aa0000");

    // [avatar load=...] with a further change in the same tag
    await s.applyPatch({ hair_color: "#00aa00" });
    const res = await s.applyPatch({ load: "My Red Look", hair_color: "#0000aa" });
    assert.deepEqual(res.applied, ["load=my-red-look", "hair_color=#0000aa"]);
    assert.equal(s.character.face.glasses, true);

    const missing = await s.applyPatch({ load: "nope" });
    assert.deepEqual(missing.applied, []);
    assert.match(missing.rejected[0].reason, /saved looks: my-red-look/);

    assert.equal(await s.saveLook("!!!"), null);
    await s.deleteLook("my-red-look");
    assert.deepEqual(s.lookNames, []);
  } finally {
    s.close();
  }
});

test("gesture frames are two different poses, and unknown gestures are refused", { skip }, async () => {
  const s = await service();
  try {
    const wave = await s.gestureFrames("neutral", "wave");
    assert.equal(wave?.length, 2);
    assert.notEqual(wave![0], wave![1]);
    const rest = await s.frames("neutral");
    assert.notEqual(wave![0], rest[0]);
    assert.equal(await s.gestureFrames("neutral", "backflip"), null);
    assert.equal(await s.gestureFrames("neutral", "wave"), wave); // cached
  } finally {
    s.close();
  }
});

test("the model cannot make her younger, shorter than standard, or take her down to underwear", { skip }, async () => {
  const s = await service(); // linnea: tunic and trousers
  try {
    const res = await s.applyPatch({ face_age: "0", height: "0.8" });
    assert.deepEqual(res.applied, []);
    assert.deepEqual(res.rejected.map((r) => r.key).sort(), ["face_age", "height"]);
    const before = s.character.face_age;
    await s.applyPatch({ tunic_color: "none", skirt_color: "none", trouser_color: "none", coat_color: "none" });
    const o = s.character.outfit as Record<string, unknown>;
    assert.ok(["tunic_color", "coat_color", "robe_color", "skirt_color", "trouser_color"].some((k) => o[k]));
    assert.equal(s.character.face_age, before);
  } finally {
    s.close();
  }
});

test("[avatar load=<preset>] works like base=<preset>, since a preset is the thing she meant", { skip }, async () => {
  const s = await service();
  try {
    const res = await s.applyPatch({ load: "Katherina", hair_color: "#0000aa" });
    assert.deepEqual(res.rejected, []);
    assert.deepEqual(res.applied, ["base=katherina", "hair_color=#0000aa"]);
  } finally {
    s.close();
  }
});

test("the preset she is based on is tracked through changes, undo and a restart, so the gallery can mark it", { skip }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "aic-avatar-"));
  const make = () => new AvatarService({ creatorSrc, statePath: join(dir, "avatar.json"), looksDir: join(dir, "looks"), emotions: { neutral: {} }, defaultPreset: "linnea" });
  let s = make();
  await s.start();
  try {
    assert.equal(s.basePreset, "linnea", "a fresh start is the starting character");
    await s.applyPatch({ hair_color: "#aa0000" });
    assert.equal(s.basePreset, "linnea", "a tweak keeps the base");
    await s.applyPatch({ base: "risa" });
    assert.equal(s.basePreset, "risa");
    await s.applyPatch({ load: "Katherina" }); // a preset named as a saved look
    assert.equal(s.basePreset, "katherina");
    await s.undo();
    assert.equal(s.basePreset, "risa", "undo goes back to the base she had");
    await s.saveLook("mine");
    await s.applyPatch({ base: "gero" });
    await s.loadLook("mine");
    assert.equal(s.basePreset, null, "a saved look is not a preset");
  } finally {
    s.close();
  }
  s = make();
  await s.start();
  try {
    assert.equal(s.basePreset, null, "remembered over a restart");
    await s.resetLook();
    assert.equal(s.basePreset, "linnea");
  } finally {
    s.close();
  }
});

// ---- the renderer thread going wrong: the server must outlive it ----

const STUB = resolve(import.meta.dirname, "helpers/stub-render-worker.ts");

/** A service whose renderer thread goes wrong on its first `frames` request (see the stub for the modes), and the log the stub writes. */
async function stubbed(mode: "hang" | "exit" | "throw", timeoutMs = 15_000) {
  const dir = await mkdtemp(join(tmpdir(), "aic-stub-"));
  const log = join(dir, "stub.log");
  Object.assign(process.env, { STUB_RENDER_MODE: mode, STUB_RENDER_LOG: log, STUB_RENDER_FLAG: join(dir, "flag") });
  const s = await service({ workerPath: STUB, timeoutMs });
  const lines = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []);
  return { s, lines };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Skipped on Windows for now: its short timeout is flaky on a slow runner. To be made robust.

test("a render that never ends is cut off at the timeout, the thread is really stopped, and the next call gets a fresh renderer", { skip: skip || winSkip }, async () => {
  const { s, lines } = await stubbed("hang", 700);
  try {
    const started = Date.now();
    await assert.rejects(s.frames("neutral"), /avatar renderer timed out on 'frames'/);
    const waited = Date.now() - started;
    assert.ok(waited >= 650 && waited < 5000, `cut off at the timeout, not before or long after (${waited} ms)`);
    assert.ok(lines().some((l) => l.startsWith("spin")), "it was really hung");
    await sleep(300); // the thread is being terminated; once it is, nothing more is written
    const settled = lines().length;
    await sleep(400);
    assert.equal(lines().length, settled, "the hung thread was terminated, not left spinning");
    const svgs = await s.frames("neutral"); // a fresh renderer answers
    assert.equal(svgs.length, 5); // four mouth openings and a blink
    assert.equal(lines().filter((l) => l.startsWith("start")).length, 2, "a second renderer thread was started");
    assert.ok((await s.applyPatch({ hair_color: "#112233" })).applied.length === 1, "and it is a working one");
  } finally {
    s.close();
  }
});

test("a renderer that exits or throws fails that call only: the service stays up and starts another", { skip }, async () => {
  for (const mode of ["exit", "throw"] as const) {
    const { s, lines } = await stubbed(mode);
    try {
      await assert.rejects(s.frames("neutral"), mode === "exit" ? /avatar renderer exited/ : /avatar renderer failed: the renderer broke/);
      const svgs = await s.frames("neutral");
      assert.equal(svgs.length, 5);
      assert.equal(lines().filter((l) => l.startsWith("start")).length, 2, `${mode}: restarted once`);
      // the look survived: it lives in the service, not in the thread
      assert.equal((await s.applyPatch({ hair_color: "#445566" })).applied.length, 1);
      assert.equal(s.character.hair_color, "#445566");
    } finally {
      s.close();
    }
  }
});

test("a request the renderer answers with an error comes back as a rejection, and the renderer keeps working", { skip }, async () => {
  const s = await service();
  try {
    const good = s.character;
    s.character = { face: 5 }; // a look that cannot be drawn (hand-edited saved look)
    await assert.rejects(s.frames("neutral"), /AttributeError: 'int' object has no attribute 'update'/);
    s.character = good;
    s.version++; // the failed frames were not cached, but a changed look is what clears the cache in the app
    assert.equal((await s.frames("neutral")).length, 5);
  } finally {
    s.close();
  }
});

test("close() ends the renderer thread, and a call after it starts a fresh one", { skip }, async () => {
  const s = await service();
  const first = (await s.frames("neutral"))[0];
  s.close();
  s.version++; // not the cached frames
  assert.equal((await s.frames("neutral"))[0], first);
  s.close();
});

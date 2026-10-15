import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { AvatarService } from "../src/avatar.ts";
import { pythonCommand } from "../src/python.ts";

const creatorSrc = process.env.CREATOR_SRC ?? resolve(import.meta.dirname, "../../anime-character-creator/src");

async function service() {
  const dir = await mkdtemp(join(tmpdir(), "aic-avatar-"));
  const s = new AvatarService({
    creatorSrc,
    python: pythonCommand(),
    workerPath: resolve(import.meta.dirname, "../python/render_worker.py"),
    statePath: join(dir, "avatar.json"),
    looksDir: join(dir, "looks"),
    emotions: { neutral: {} },
    defaultPreset: "linnea",
  });
  await s.start();
  return s;
}

const skip = !existsSync(creatorSrc) && `creator not found at ${creatorSrc}`;

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
  const dir = await mkdtemp(join(tmpdir(), "aic-avatar-"));
  const r = new AvatarService({
    creatorSrc,
    python: pythonCommand(),
    workerPath: resolve(import.meta.dirname, "../python/render_worker.py"),
    statePath: join(dir, "avatar.json"),
    looksDir: join(dir, "looks"),
    emotions: { neutral: {} },
    defaultPreset: "risa",
  });
  await r.start();
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

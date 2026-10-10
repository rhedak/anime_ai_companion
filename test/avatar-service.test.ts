import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { AvatarService } from "../src/avatar.ts";

const creatorSrc = process.env.CREATOR_SRC ?? resolve(import.meta.dirname, "../../anime-character-creator/src");

async function service() {
  const dir = await mkdtemp(join(tmpdir(), "aic-avatar-"));
  const s = new AvatarService({
    creatorSrc,
    python: process.env.PYTHON ?? "python3",
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

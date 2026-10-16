import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { Worker } from "node:worker_threads";

const creatorSrc = process.env.CREATOR_SRC ?? resolve(import.meta.dirname, "../../anime-character-creator/ts/src");
const worker = resolve(import.meta.dirname, "../src/render-worker.ts");
const skip = !existsSync(join(creatorSrc, "render.ts")) && `the creator's TypeScript is not at ${creatorSrc} (set CREATOR_SRC to its ts/src folder)`;

/** The renderer thread itself, spoken to the way AvatarService speaks to it: JSON text in, JSON text out. */
function renderer() {
  const thread = new Worker(worker, { workerData: { creatorSrc } });
  const replies: ((text: string) => void)[] = [];
  thread.on("message", (text: string) => replies.shift()?.(text));
  let id = 0;
  const call = (payload: object): Promise<any> =>
    new Promise((resolveReply, reject) => {
      replies.push((text) => resolveReply(JSON.parse(text)));
      thread.once("error", reject);
      thread.postMessage(JSON.stringify({ id: ++id, ...payload }));
    });
  return { call, stop: () => thread.terminate() };
}

test("render worker validates patches and renders frames", { skip }, async () => {
  const { call, stop } = renderer();
  try {
    const { character } = await call({ op: "base", name: "linnea" });
    const patched = await call({
      op: "patch",
      character,
      set: { hair_color: "#ff0000", hairstyle: "nope", bogus: "1", "outfit.hat_color": "#222" },
    });
    assert.deepEqual(patched.applied, ["hair_color=#ff0000", "outfit.hat_color=#222222"]);
    assert.deepEqual(patched.rejected.map((r: any) => r.key), ["hairstyle", "bogus"]);

    // free text goes into the SVG unescaped by the creator, so markup must never get through
    const evil = await call({
      op: "patch",
      character,
      set: { wristband_text: '"/><script>alert(1)</script>', hair_clip: "<svg/onload=alert(1)>", "outfit.wristband_text": "fine words" },
    });
    assert.deepEqual(evil.applied, ["outfit.wristband_text=fine words"]);
    assert.deepEqual(evil.rejected.map((r: any) => r.key), ["wristband_text", "hair_clip"]);

    const frames = await call({ op: "frames", character: patched.character, face: {}, mouth: [0, 0.5] });
    assert.equal(frames.svgs.length, 3); // two mouth openings plus a blink
    assert.ok(frames.svgs.every((svg: string) => svg.startsWith("<svg")));
  } finally {
    await stop();
  }
});

test("a request that fails is an error reply, and the renderer answers the next one", { skip }, async () => {
  const { call, stop } = renderer();
  try {
    const unknown = await call({ op: "nope" });
    assert.deepEqual(unknown, { ok: false, error: "KeyError: 'nope'", id: 1 });
    const broken = await call({ op: "patch" });
    assert.deepEqual(broken, { ok: false, error: "KeyError: 'character'", id: 2 });
    const fine = await call({ op: "base", name: "nobody" });
    assert.deepEqual(fine, { ok: false, error: "KeyError: 'nobody'", id: 3 });
    assert.equal((await call({ op: "base", name: "risa" })).ok, true);
  } finally {
    await stop();
  }
});

test("every starting character is soft, and she can still change the finish", { skip }, async () => {
  const { call, stop } = renderer();
  try {
    const schema = await call({ op: "schema" });
    const { character } = await call({ op: "base", name: "risa" });
    if (!("finish" in schema.top)) {
      // a creator older than the soft finish: nothing is set, and she is drawn as before
      assert.equal(character.finish, undefined);
      return;
    }
    assert.equal(character.finish, "soft");
    assert.ok("highlight_strength" in schema.top, "the strength is an ordinary field");
    // a base chosen in a patch starts soft too
    const switched = await call({ op: "patch", character, set: { base: "satoko" } });
    assert.equal(switched.character.finish, "soft");
    // and the finish and the strength stay hers to change
    const changed = await call({ op: "patch", character, set: { finish: "flat" } });
    assert.deepEqual(changed.applied, ["finish=flat"]);
    assert.equal(changed.character.finish, "flat");
    const strength = await call({ op: "patch", character, set: { highlight_strength: "0.5" } });
    assert.deepEqual(strength.applied, ["highlight_strength=0.5"]);
    const bad = await call({ op: "patch", character, set: { finish: "glossy", highlight_strength: "7" } });
    assert.deepEqual(bad.applied, []);
    assert.deepEqual(bad.rejected.map((r: any) => r.key), ["finish", "highlight_strength"]);
    // a look saved before the finish existed has no `finish`: it has chosen nothing, so it is drawn with the default; flat stays flat
    const { finish: _dropped, highlight_strength: _kept, ...older } = character;
    const unsaid = await call({ op: "frames", character: older, face: {}, mouth: [0] });
    const said = await call({ op: "frames", character, face: {}, mouth: [0] });
    assert.equal(unsaid.svgs[0], said.svgs[0]);
    // soft draws the clumps and the finish costs bytes, so the frames really are different
    const soft = await call({ op: "frames", character, face: {}, mouth: [0] });
    const flat = await call({ op: "frames", character: changed.character, face: {}, mouth: [0] });
    assert.ok(soft.svgs[0].length > flat.svgs[0].length);
  } finally {
    await stop();
  }
});

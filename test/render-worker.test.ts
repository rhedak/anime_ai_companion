import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";

const creatorSrc = process.env.CREATOR_SRC ?? resolve(import.meta.dirname, "../../anime-character-creator/src");
const worker = resolve(import.meta.dirname, "../python/render_worker.py");

test("render worker validates patches and renders frames", { skip: !existsSync(creatorSrc) && `creator not found at ${creatorSrc}` }, async () => {
  const proc = spawn(process.env.PYTHON ?? "python3", ["-I", worker], {
    env: { ...process.env, CREATOR_SRC: creatorSrc },
  });
  const lines = createInterface({ input: proc.stdout })[Symbol.asyncIterator]();
  let id = 0;
  const call = async (payload: object): Promise<any> => {
    proc.stdin.write(JSON.stringify({ id: ++id, ...payload }) + "\n");
    return JSON.parse((await lines.next()).value);
  };
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
    proc.kill();
  }
});

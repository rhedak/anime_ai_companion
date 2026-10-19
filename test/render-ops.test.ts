import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { before, describe, test } from "node:test";
import { loadCreator } from "../src/creator-load.ts";
import { createRenderOps, type Creator, type RenderOps } from "../src/render-ops.ts";
import { fixtureTools } from "./helpers/render-ops-fixture.ts";

/**
 * test/fixtures/render-ops.json holds about three thousand requests and what the request handling answered to each. Until the creator's 0.4.0 the replies were
 * Python's (python/render_ops.py, which made the TypeScript port provably the same); the creator's 0.5.0 removed its Python and changed what it draws (the adult
 * body, Franzi, more hairstyles), so since then the replies are a snapshot of the TypeScript creator's own: `node scripts/refresh-render-ops-fixture.ts` re-records
 * them, and a change in the diff is a change in what the creator or this request handling answers (look at it before keeping it). An SVG is compared by the
 * SHA-256 and the length of its bytes, and the character of a patch by the same for its JSON text. The creator is read from CREATOR_SRC (its `ts/src` folder), by
 * path, as the server does.
 */

const creatorSrc = process.env.CREATOR_SRC ?? resolve(import.meta.dirname, "../../anime-character-creator/ts/src");
const skip = !existsSync(join(creatorSrc, "render.ts")) && `the creator's TypeScript is not at ${creatorSrc} (set CREATOR_SRC to its ts/src folder)`;

let creator: Creator;
let ops: RenderOps;
let fixture: Map<string, unknown>;
let characters: Map<string, unknown>;

let tools: ReturnType<typeof fixtureTools>;

before(async () => {
  if (skip) return;
  creator = await loadCreator(creatorSrc);
  ops = createRenderOps(creator);
  fixture = creator.loadsText(readFileSync(resolve(import.meta.dirname, "fixtures/render-ops.json"), "utf8")) as Map<string, unknown>;
  characters = fixture.get("characters") as Map<string, unknown>;
  tools = fixtureTools(creator, characters);
});

describe("render-ops against the recorded replies", { skip }, () => {
  test("every request gets the recorded reply", () => {
    const { dumps, expand, shorten } = tools;
    const cases = fixture.get("cases") as Map<string, unknown>[];
    assert.ok(cases.length > 2500, "the fixture is the large set");
    const failures: string[] = [];
    let svgs = 0;
    cases.forEach((one, index) => {
      const request = expand(one.get("request"));
      const reply = creator.loadsText(ops.handleLine(dumps(request)));
      const got = dumps(shorten(request, reply));
      const want = dumps(one.get("reply"));
      if (got !== want) failures.push(`#${index} ${dumps(one.get("request")).slice(0, 300)}\n   recorded: ${want.slice(0, 600)}\n   now:      ${got.slice(0, 600)}`);
      if (reply instanceof Map && Array.isArray(reply.get("svgs"))) svgs += (reply.get("svgs") as unknown[]).length;
    });
    assert.ok(svgs > 500, `the SVGs were really drawn (${svgs})`);
    assert.equal(failures.length, 0, `${failures.length} of ${cases.length} replies differ from the recording (node scripts/refresh-render-ops-fixture.ts re-records it, once the change is wanted):\n${failures.slice(0, 12).join("\n")}`);
  });

  test("raw lines (text that is not JSON, or not a request) get the recorded reply text", () => {
    const lines = fixture.get("lines") as Map<string, string>[];
    assert.ok(lines.length > 40);
    const failures: string[] = [];
    for (const one of lines) {
      const got = ops.handleLine(`${one.get("line") as string}\n`); // the worker read each line with its newline
      if (got !== one.get("reply")) failures.push(`${JSON.stringify(one.get("line"))}\n   recorded: ${one.get("reply")}\n   now:      ${got}`);
    }
    assert.equal(failures.length, 0, failures.join("\n"));
  });

  test("a request that is a plain object (not read from text) is answered too, and never throws", () => {
    const reply = ops.handle({ id: 5, op: "base", name: "risa" });
    assert.equal(reply.get("ok"), true);
    assert.equal(reply.get("id"), 5);
    const bad = ops.handle({ id: 6, op: "patch", character: 5, set: { hair_color: "#fff" } });
    assert.deepEqual([bad.get("ok"), bad.get("error")], [false, "AttributeError: 'float' object has no attribute 'get'"]);
    assert.equal(ops.handle(undefined).get("ok"), false);
  });

  test("the model cannot make her younger, shorter than standard, or take her down to underwear", () => {
    const risa = creator.dumps((ops.handle(new Map([["op", "base"], ["name", "linnea"]])).get("character")));
    const patch = (set: Record<string, unknown>) => ops.handle(new Map<string, unknown>([["op", "patch"], ["character", creator.loadsText(risa)], ["set", new Map(Object.entries(set))]]));
    const rejected = (reply: Map<string, unknown>) => (reply.get("rejected") as Map<string, unknown>[]).map((r) => r.get("key"));
    assert.deepEqual(rejected(patch({ face_age: "0", height: "0.8" })), ["face_age", "height"]);
    const bare = patch({ tunic_color: "none", trouser_color: "none" });
    assert.deepEqual(bare.get("applied"), ["tunic_color=none"]);
    assert.deepEqual(rejected(bare), ["trouser_color"]);
  });
});

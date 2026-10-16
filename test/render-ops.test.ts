import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { before, describe, test } from "node:test";
import { createRenderOps, loadCreator, type Creator, type RenderOps } from "../src/render-ops.ts";

/**
 * The oracle: test/fixtures/render-ops.json holds about three thousand requests and what Python's python/render_ops.py answered to each
 * (scripts/gen-render-ops-fixtures.py made it). The TypeScript must answer the same JSON, text of errors included. An SVG is compared
 * by the SHA-256 and the length of its bytes, and the character of a patch by the same for its JSON text. The creator is read from
 * CREATOR_SRC (its `ts/src` folder), by path, as the server does.
 */

const creatorSrc = process.env.CREATOR_SRC ?? resolve(import.meta.dirname, "../../anime-character-creator/ts/src");
const skip = !existsSync(join(creatorSrc, "render.ts")) && `the creator's TypeScript is not at ${creatorSrc} (set CREATOR_SRC to its ts/src folder)`;

let creator: Creator;
let ops: RenderOps;
let fixture: Map<string, unknown>;
let characters: Map<string, unknown>;

const dumps = (value: unknown): string => creator.dumps(value);
const sha = (text: string): Map<string, unknown> => {
  const bytes = Buffer.from(text, "utf8");
  return new Map<string, unknown>([["sha256", createHash("sha256").update(bytes).digest("hex")], ["len", new creator.PyInt(bytes.length)]]);
};

/** A request with its {"$character": name} references replaced by the characters. */
function expand(value: unknown): unknown {
  if (value instanceof Map) {
    if (value.size === 1 && value.has("$character")) return structuredCopy(characters.get(value.get("$character") as string));
    return new Map([...value].map(([k, v]) => [k, expand(v)]));
  }
  if (Array.isArray(value)) return value.map(expand);
  return value;
}

function structuredCopy(value: unknown): unknown {
  if (value instanceof Map) return new Map([...value].map(([k, v]) => [k, structuredCopy(v)]));
  if (Array.isArray(value)) return value.map(structuredCopy);
  return value;
}

/** The part of a reply that must agree even where the creator is known to differ: ok or not, the error's class, and the SVGs' lengths. */
function shape(reply: unknown): string {
  if (!(reply instanceof Map)) return dumps(reply);
  const svgs = reply.get("svgs");
  const lens = Array.isArray(svgs) ? svgs.map((s) => (s instanceof Map ? s.get("len") : s)) : undefined;
  const error = reply.get("error");
  return dumps(new Map<string, unknown>([["ok", reply.get("ok")], ["class", typeof error === "string" ? error.split(":")[0] : null], ["lens", lens ?? null], ["id", reply.get("id")]]));
}

/** What the fixture keeps of a reply (see the generator): SVGs and a patched character shortened, a base character as a reference. */
function shorten(request: unknown, reply: unknown): unknown {
  if (!(reply instanceof Map)) return reply;
  const out = new Map(reply);
  const svgs = out.get("svgs");
  if (Array.isArray(svgs)) out.set("svgs", svgs.map((s) => (typeof s === "string" ? sha(s) : s)));
  const op = request instanceof Map ? request.get("op") : undefined;
  if (out.has("character")) {
    if (op === "patch") out.set("character", sha(dumps(out.get("character"))));
    else if (op === "base") {
      const name = (request as Map<string, unknown>).get("name") as string;
      if (dumps(out.get("character")) === dumps(characters.get(name))) out.set("character", new Map([["$character", name]]));
    }
  }
  return out;
}

/**
 * The one place the text differs from Python's: a value of the wrong type (a string where a number belongs) meeting arithmetic inside the
 * creator's drawing. Python names the operator (`unsupported operand type(s) for *: 'NoneType' and 'float'`, `'>' not supported between
 * instances of ...`, `can't multiply sequence by non-int of type 'float'`); the creator's TypeScript says `unsupported operand type(s): 'X' is
 * not a number`, always a TypeError. It only shows for a saved look that was edited by hand, and the class, the rejection and the character
 * left unchanged are the same. Both texts are made one before comparing, and the count is checked so this cannot grow unnoticed.
 */
const OPERAND_TEXT = /unsupported operand type\(s\)(?: for [^:]+:|:) '[^']*'(?: and '[^']*'| is not a number)|can't multiply sequence by non-int of type '[a-z]+'|'[<>]=?' not supported between instances of '[^']*' and '[^']*'/g;
const KNOWN_OPERAND_DIFFERENCES = 36;
const KNOWN_OTHER_DIFFERENCES = 4; // cases the fixture marks `known_difference`: see the generator for each reason
const sameOperandText = (text: string): string => text.replace(OPERAND_TEXT, "<an operand TypeError>");

before(async () => {
  if (skip) return;
  creator = await loadCreator(creatorSrc);
  ops = createRenderOps(creator);
  fixture = creator.loadsText(readFileSync(resolve(import.meta.dirname, "fixtures/render-ops.json"), "utf8")) as Map<string, unknown>;
  characters = fixture.get("characters") as Map<string, unknown>;
});

describe("render-ops against Python's replies", { skip }, () => {
  test("every request Python answered gets the same reply", () => {
    const cases = fixture.get("cases") as Map<string, unknown>[];
    assert.ok(cases.length > 2500, "the fixture is the large set");
    const failures: string[] = [];
    let svgs = 0;
    let operandTexts = 0;
    let knownOther = 0;
    cases.forEach((one, index) => {
      const request = expand(one.get("request"));
      const reply = creator.loadsText(ops.handleLine(dumps(request)));
      let got = dumps(shorten(request, reply));
      let want = dumps(one.get("reply"));
      if (one.has("known_difference")) {
        knownOther++;
        got = shape(shorten(request, reply));
        want = shape(one.get("reply"));
      }
      if (got !== want && sameOperandText(got) === sameOperandText(want)) {
        operandTexts++;
        got = want;
      }
      if (got !== want) failures.push(`#${index} ${dumps(one.get("request")).slice(0, 300)}\n   python: ${want.slice(0, 600)}\n   ts:     ${got.slice(0, 600)}`);
      if (reply instanceof Map && Array.isArray(reply.get("svgs"))) svgs += (reply.get("svgs") as unknown[]).length;
    });
    assert.ok(svgs > 500, `the SVGs were really drawn (${svgs})`);
    assert.equal(failures.length, 0, `${failures.length} of ${cases.length} replies differ from Python's:\n${failures.slice(0, 12).join("\n")}`);
    assert.equal(operandTexts, KNOWN_OPERAND_DIFFERENCES, "the replies whose operand text is the creator's generic one");
    assert.equal(knownOther, KNOWN_OTHER_DIFFERENCES, "the cases marked as known differences of the creator");
  });

  test("raw lines (text that is not JSON, or not a request) get Python's reply text", () => {
    const lines = fixture.get("lines") as Map<string, string>[];
    assert.ok(lines.length > 40);
    const failures: string[] = [];
    for (const one of lines) {
      const got = ops.handleLine(`${one.get("line") as string}\n`); // the Python worker read each line with its newline
      if (got !== one.get("reply")) failures.push(`${JSON.stringify(one.get("line"))}\n   python: ${one.get("reply")}\n   ts:     ${got}`);
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

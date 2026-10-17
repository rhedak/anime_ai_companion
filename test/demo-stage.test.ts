import { winSkip } from "./helpers/platform.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { stage } from "../demo/stage.mjs";
import { loadCreator } from "../src/creator-load.ts";
import { createRenderOps, creatorFromModules } from "../src/render-ops.ts";

/**
 * The staged browser demo, built for real into a temporary folder: no Python and no Pyodide in it, a small download, and its compiled
 * modules (the creator's TypeScript and src/render-ops.ts, as the browser gets them) load as plain ES modules and draw the very same bytes
 * as the server's path (`loadCreator` and `createRenderOps`, which is what src/render-worker.ts runs). The page itself in a real browser is
 * checked by hand in Chrome (demo/README.md).
 */
const creatorSrc = process.env.CREATOR_SRC ?? resolve(import.meta.dirname, "../../anime-character-creator/ts/src");
const skip = existsSync(join(creatorSrc, "render.ts")) ? false : "the creator's TypeScript is not next to this repo (set CREATOR_SRC to its ts/src folder)";

/** Every file under `dir` (relative path, size), skipping the picture pack's pictures, which a visitor only fetches when they choose the pack. */
function files(dir: string, skipPacks = true): { path: string; size: number }[] {
  const found: { path: string; size: number }[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.push({ path: relative(dir, full), size: statSync(full).size });
    }
  };
  walk(dir);
  return skipPacks ? found.filter((f) => !/^(frames|pack-thumb)\//.test(f.path)) : found;
}

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

let dir = "";
before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), "anaico-demo-stage-"));
  await stage(dir);
});
after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("the staged demo", { skip }, () => {
  test("has no Pyodide and no Python in it", () => {
    for (const { path } of files(dir)) {
      assert.ok(!path.endsWith(".py"), `a Python file was staged: ${path}`);
      assert.notEqual(path, "creator-files.json");
      if (!/\.(html|js|css|json)$/.test(path)) continue;
      const text = readFileSync(join(dir, path), "utf8");
      assert.doesNotMatch(text, /pyodide|render_ops|creator-files|cdn\.jsdelivr\.net\/pyodide/i, path);
      assert.doesNotMatch(text, /\.py\b/, path);
    }
    assert.ok(!existsSync(join(dir, "render_ops.py")));
  });

  test("is small: what a visitor downloads on the first load is under 2 MB (the picture pack waits until it is chosen)", { skip: winSkip }, () => {
    const code = files(dir).reduce((sum, f) => sum + f.size, 0);
    assert.ok(code < 2 * 1024 * 1024, `${code} bytes`);
    assert.ok(code > 300 * 1024, "the creator's compiled code is in it");
    const compiled = files(dir).filter((f) => /^creator\/js\//.test(f.path));
    assert.ok(compiled.length > 40 && compiled.every((f) => f.path.endsWith(".js")));
  });

  test("its compiled modules import nothing from Node and every import is a relative .js file that exists", () => {
    for (const { path } of files(dir).filter((f) => /^(js|creator\/js)\//.test(f.path))) {
      const text = readFileSync(join(dir, path), "utf8");
      assert.doesNotMatch(text, /from "node:|require\(|\.ts"/, path);
      for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)[^"';]*?from "([^"]+)"/g)) {
        const target = m[1] as string;
        assert.match(target, /^\.\.?\/.*\.js$/, `${path} imports ${target}`);
        assert.ok(existsSync(resolve(dir, path, "..", target)), `${path} imports ${target}, which is not staged`);
      }
    }
  });

  test("loads as plain ES modules and draws the same bytes as the server's path", async () => {
    const load = (file: string): Promise<any> => import(pathToFileURL(join(dir, file)).href);
    const [ops, render, presets, head, body, model, urlstate, pynum, pyjson, pyjsonload, pyvalue] = await Promise.all([
      load("js/render-ops.js"),
      ...["render", "presets", "core-head", "body", "model", "urlstate", "pynum", "pyjson", "pyjsonload", "pyvalue"].map((n) => load(`creator/js/${n}.js`)),
    ]);
    const staged = ops.createRenderOps(ops.creatorFromModules({ render, presets, head, body, model, urlstate, pynum, pyjson, pyjsonload, pyvalue }));
    const server = createRenderOps(await loadCreator(creatorSrc)); // what src/render-worker.ts runs
    assert.equal(typeof creatorFromModules, "function");

    const ask = async (one: ReturnType<typeof createRenderOps>, request: unknown): Promise<any> => JSON.parse(one.handleLine(JSON.stringify(request)));
    const both = async (request: unknown): Promise<[any, any]> => [await ask(staged, request), await ask(server, request)];

    // The reply to every op is the same JSON: the schema, a base, a patch (with a rejection in it) and an error.
    const [schemaA, schemaB] = await both({ id: 1, op: "schema" });
    assert.equal(schemaA.ok, true);
    assert.deepEqual(schemaA, schemaB);
    const [baseA, baseB] = await both({ id: 2, op: "base", name: "linnea" });
    assert.deepEqual(baseA, baseB);
    const [patchA, patchB] = await both({ id: 3, op: "patch", character: baseA.character, set: { hair_color: "#00aa66", eye_color: "#3366cc", nonsense: "1" } });
    assert.deepEqual(patchA, patchB);
    assert.equal(patchA.rejected.length, 1);
    const [badA, badB] = await both({ id: 4, op: "nonsense" });
    assert.deepEqual([badA.ok, badA], [false, badB]);

    // The pictures: the same SHA-256, byte for byte, for a talking mouth and the blink, and for poses.
    const [framesA, framesB] = await both({ id: 5, op: "frames", character: patchA.character, face: { mouth_open: 0 }, mouth: [0, 0.3, 0.6] });
    assert.equal(framesA.ok, true);
    assert.equal(framesA.svgs.length, 4);
    assert.ok(framesA.svgs.every((svg: string) => svg.startsWith("<svg") && svg.length > 5000));
    assert.deepEqual(framesA.svgs.map(sha), framesB.svgs.map(sha));
    assert.equal(new Set(framesA.svgs.map(sha)).size, 4, "four different pictures");
    const [posesA, posesB] = await both({ id: 6, op: "frames", character: baseA.character, face: {}, mouth: [0], poses: [{}, { right_arm_out: 1 }] });
    assert.deepEqual(posesA.svgs.map(sha), posesB.svgs.map(sha));
  });

  test("stages from a creator checkout that has no node_modules (the pinned clone under ~/.anaico has none), to the same compiled code", async () => {
    const copy = mkdtempSync(join(tmpdir(), "anaico-creator-copy-"));
    const other = mkdtempSync(join(tmpdir(), "anaico-demo-stage2-"));
    const was = process.env.CREATOR_SRC;
    try {
      const ts = resolve(creatorSrc, "..");
      for (const name of ["package.json", "tsconfig.json", "tsconfig.web.json"]) cpSync(join(ts, name), join(copy, name));
      cpSync(creatorSrc, join(copy, "src"), { recursive: true });
      assert.ok(!existsSync(join(copy, "node_modules")));
      process.env.CREATOR_SRC = join(copy, "src");
      await stage(other);
      for (const { path } of files(dir).filter((f) => f.path.startsWith("creator/js/"))) assert.equal(readFileSync(join(other, path), "utf8"), readFileSync(join(dir, path), "utf8"), path);
    } finally {
      if (was === undefined) delete process.env.CREATOR_SRC;
      else process.env.CREATOR_SRC = was;
      rmSync(copy, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });
});

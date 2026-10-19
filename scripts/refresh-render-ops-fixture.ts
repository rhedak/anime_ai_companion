/**
 * Re-records test/fixtures/render-ops.json from the TypeScript creator: the same requests, the replies the request handling gives now.
 *
 *   CREATOR_SRC=<creator>/ts/src node scripts/refresh-render-ops-fixture.ts
 *
 * Run it when the creator moves to a release that changes what it draws or lists (a new preset, hairstyle or body), and read the diff of the fixture before
 * keeping it: each changed reply is a change in what the creator or the request handling answers. (Until the creator's 0.4.0 the replies were Python's, made by
 * scripts/gen-render-ops-fixtures.py; the creator has no Python any more, so that script can no longer run.)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadCreator } from "../src/creator-load.ts";
import { createRenderOps } from "../src/render-ops.ts";
import { fixtureTools } from "../test/helpers/render-ops-fixture.ts";

const creatorSrc = process.env.CREATOR_SRC ?? resolve(import.meta.dirname, "../../anime-character-creator/ts/src");
const file = resolve(import.meta.dirname, "../test/fixtures/render-ops.json");
const creator = await loadCreator(creatorSrc);
const ops = createRenderOps(creator);
const fixture = creator.loadsText(readFileSync(file, "utf8")) as Map<string, unknown>;
const characters = fixture.get("characters") as Map<string, unknown>;
const { dumps, expand, shorten } = fixtureTools(creator, characters);
const compact = (value: unknown): string => creator.dumps(value as never, { compact: true, ensureAscii: false });

const cases = (fixture.get("cases") as Map<string, unknown>[]).map((one) => {
  const request = expand(one.get("request"));
  const reply = creator.loadsText(ops.handleLine(dumps(request)));
  return new Map<string, unknown>([["request", one.get("request")], ["reply", shorten(request, reply)]]);
});
const lines = (fixture.get("lines") as Map<string, unknown>[]).map((one) => new Map<string, unknown>([["line", one.get("line")], ["reply", ops.handleLine(`${one.get("line") as string}\n`)]]));
const svgs = cases.reduce((n, c) => n + (((c.get("reply") as Map<string, unknown>)?.get?.("svgs") as unknown[] | undefined)?.length ?? 0), 0);
const meta = new Map<string, unknown>([
  ["about", "The request handling's replies, recorded from the TypeScript creator (node scripts/refresh-render-ops-fixture.ts); until the creator's 0.4.0 they were Python's, from python/render_ops.py"],
  ["creator", process.env.CREATOR_LABEL ?? "the TypeScript creator at CREATOR_SRC"],
  ["cases", new creator.PyInt(cases.length)],
  ["lines", new creator.PyInt(lines.length)],
  ["svgs", new creator.PyInt(svgs)],
  ["svg_marker", "an SVG string is {sha256, len}: the SHA-256 and the number of bytes of its UTF-8"],
]);
writeFileSync(
  file,
  `{"meta":${compact(meta)},\n"characters":{\n${[...characters].map(([k, v]) => `${compact(k)}:${compact(v)}`).join(",\n")}},\n"cases":[\n${cases.map(compact).join(",\n")}],\n"lines":[\n${lines.map(compact).join(",\n")}]}\n`,
);
console.log(`${cases.length} cases, ${lines.length} lines, ${svgs} svgs -> ${file}`);

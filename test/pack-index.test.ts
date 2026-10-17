import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PACK_INDEX_ENTRY_KEYS, PACK_INDEX_ENTRY_REQUIRED, parsePackIndex } from "../src/pack-index.ts";

const root = join(import.meta.dirname, "..");

const sample = {
  format: 1,
  packs: [
    {
      id: "franzi-pajamas",
      name: "Franzi (pajamas)",
      version: "1",
      description: "Franzi in a lavender pajama outfit.",
      frameCount: 39,
      sizes: { width: 940, height: 1070, archiveBytes: 4400000, framesBytes: 15142742 },
      hashes: { sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" },
      url: "https://github.com/rhedak/anime_ai_companion/releases/download/pack-franzi-pajamas-1/franzi-pajamas-1.tar",
      thumbnail: "https://github.com/rhedak/anime_ai_companion/releases/download/pack-franzi-pajamas-1/franzi-pajamas-thumb.webp",
      credit: "Franzi (pajamas): an original character, pictures made with AI.",
      aiMade: true,
    },
  ],
};

test("a pack index accepts the documented fields and nothing else", () => {
  const parsed = parsePackIndex(sample);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.index.packs[0].id, "franzi-pajamas");
  assert.equal(parsed.index.packs[0].sizes.archiveBytes, 4400000);
  assert.equal(parsed.index.packs[0].aiMade, true);
  assert.equal(parsePackIndex({ format: 1, packs: [] }).ok, true);

  const schema = JSON.parse(readFileSync(join(root, "packs/index.schema.json"), "utf8")) as {
    required: string[];
    $defs: { pack: { required: string[]; properties: Record<string, unknown> } };
  };
  assert.deepEqual(schema.required, ["format", "packs"]);
  assert.deepEqual(schema.$defs.pack.required, [...PACK_INDEX_ENTRY_REQUIRED]);
  assert.deepEqual(Object.keys(schema.$defs.pack.properties).sort(), [...PACK_INDEX_ENTRY_KEYS].sort());
});

test("the example in the docs is a valid pack index", () => {
  const doc = readFileSync(join(root, "docs/pack-archives.md"), "utf8");
  const block = /```json\r?\n([\s\S]*?)\r?\n```/.exec(doc);
  assert.ok(block, "docs/pack-archives.md should show a JSON index");
  const parsed = parsePackIndex(JSON.parse(block[1]));
  assert.equal(parsed.ok, true, !parsed.ok ? parsed.reason : "");
});

test("a pack index refuses a broken entry", () => {
  const cases: [unknown, RegExp][] = [
    [null, /JSON object/],
    [{ format: 1, packs: [], extra: 1 }, /extra is not a field/],
    [{ format: 2, packs: [] }, /format must be 1/],
    [{ packs: [] }, /format must be 1/],
    [{ format: 1 }, /packs list/],
    [{ format: 1, packs: [{ ...sample.packs[0], id: "../x" }] }, /folder name/],
    [{ format: 1, packs: [{ ...sample.packs[0], id: "a..b" }] }, /folder name/],
    [{ format: 1, packs: [{ ...sample.packs[0], version: "v1" }] }, /version/],
    [{ format: 1, packs: [{ ...sample.packs[0], frameCount: 0 }] }, /frameCount/],
    [{ format: 1, packs: [{ ...sample.packs[0], url: "http://github.com/rhedak/a.tar" }] }, /https/],
    [{ format: 1, packs: [{ ...sample.packs[0], url: "https://user:pw@github.com/a/b.tar" }] }, /https/],
    [{ format: 1, packs: [{ ...sample.packs[0], hashes: { sha256: "ABCD" } }] }, /sha256/],
    [{ format: 1, packs: [{ ...sample.packs[0], hashes: { sha256: sample.packs[0].hashes.sha256, md5: "abc" } }] }, /md5/],
    [{ format: 1, packs: [{ ...sample.packs[0], sizes: { width: 940, height: 1070 } }] }, /archiveBytes/],
    [{ format: 1, packs: [sample.packs[0], sample.packs[0]] }, /twice/],
    [{ format: 1, packs: [{ ...sample.packs[0], thumbnail: "not a url" }] }, /thumbnail/],
    [{ format: 1, packs: [{ ...sample.packs[0], aiMade: "yes" }] }, /aiMade/],
    [{ format: 1, packs: [{ ...sample.packs[0], note: "hi" }] }, /note is not a field/],
  ];
  for (const [value, reason] of cases) {
    const parsed = parsePackIndex(value);
    assert.equal(parsed.ok, false, JSON.stringify(value));
    if (!parsed.ok) assert.match(parsed.reason, reason, parsed.reason);
  }
});

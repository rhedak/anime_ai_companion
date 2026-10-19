import assert from "node:assert/strict";
import { test } from "node:test";
import { PACKS_SITE, packInfoFrom, remotePacksFrom, wantedFromSearch } from "../demo/remote-packs.js";

const BASE = `${PACKS_SITE}frames/franzi-bikini/`;
const entry = (over: Record<string, unknown> = {}) => ({
  id: "franzi-bikini",
  name: "Franzi (bikini)",
  version: "1",
  frameCount: 39,
  sizes: { width: 940, height: 1070, archiveBytes: 4_421_632, framesBytes: 15_078_150 },
  hashes: { sha256: "0".repeat(64) },
  url: "https://github.com/rhedak/anime_ai_companion-packs/releases/download/franzi-bikini-v1/franzi-bikini-v1.tar",
  thumbnail: "thumbs/franzi-bikini.webp",
  credit: "Franzi (bikini): an original character.",
  character: { id: "franzi", name: "Franzi" },
  ...over,
});

test("the index becomes gallery entries: the size is what the demo fetches (the loose frames), the pictures and preview stay on the packs site", () => {
  const found = remotePacksFrom({ format: 1, packs: [entry()] });
  const pack = found["franzi-bikini"];
  assert.equal(pack.sizes.archiveBytes, 15_078_150, "the question names the frames, not the archive the demo does not use");
  assert.equal(pack.host, "rhedak.github.io");
  assert.equal(pack.base, BASE);
  assert.equal(pack.thumb, `${PACKS_SITE}thumbs/franzi-bikini.webp`);
  assert.deepEqual(pack.character, { id: "franzi", name: "Franzi" });
  assert.match(pack.saved, /browser keeps it/);
});

test("an index entry that names another host's preview, a bad id or a repeated id is not used as given", () => {
  const found = remotePacksFrom({
    packs: [
      entry({ id: "a", thumbnail: "https://evil.example/x.webp" }),
      entry({ id: "../b" }),
      entry({ id: "a b" }),
      entry({ id: "a" }),
      entry({ id: "c", character: { id: "bad id!", name: "x" } }),
    ],
  });
  assert.deepEqual(Object.keys(found).sort(), ["a", "c"]);
  assert.equal(found.a.thumb, undefined, "a preview on another host is dropped");
  assert.equal(found.a.base.startsWith(PACKS_SITE), true, "the pictures are only ever looked for under the packs site");
  assert.equal(found.c.character, undefined);
  assert.deepEqual(remotePacksFrom(null), {});
  assert.deepEqual(remotePacksFrom({ packs: "no" }), {});
});

const manifest = () => ({
  name: "franzi-bikini",
  character: "franzi",
  credit: "Franzi (bikini)",
  terms: "Made with AI.",
  emotions: { neutral: { idle: "neutral.webp", blink: "neutral-blink.webp", talk: ["neutral-talk1.webp"] }, happy: { idle: "happy.webp", talk: [] } },
  gestures: { wave: ["wave-1.webp", "wave-2.webp"] },
});

test("pack.json becomes the page's PackInfo with every picture under the pack's own folder", () => {
  const info = packInfoFrom(manifest(), BASE)!;
  assert.equal(info.emotions.neutral.idle, `${BASE}neutral.webp`);
  assert.deepEqual(info.emotions.neutral.talk, [`${BASE}neutral-talk1.webp`]);
  assert.equal(info.emotions.happy.blink, undefined);
  assert.deepEqual(info.gestures.wave, [`${BASE}wave-1.webp`, `${BASE}wave-2.webp`]);
  assert.equal(info.character, "franzi");
  assert.equal(info.terms, "Made with AI.");
});

test("a pack.json that names a path, an address, a non-picture, no neutral picture or too many pictures is refused", () => {
  const bad = (change: (m: any) => void) => {
    const m = manifest();
    change(m);
    return packInfoFrom(m, BASE);
  };
  assert.equal(bad((m) => (m.emotions.neutral.idle = "../neutral.webp")), null);
  assert.equal(bad((m) => (m.emotions.neutral.idle = "https://evil.example/n.webp")), null);
  assert.equal(bad((m) => (m.emotions.neutral.idle = "n.svg")), null);
  assert.equal(bad((m) => (m.emotions.happy.talk = ["sub/x.webp"])), null);
  assert.equal(bad((m) => delete m.emotions.neutral), null);
  assert.equal(bad((m) => (m.gestures.wave = Array.from({ length: 130 }, (_, i) => `w${i}.webp`))), null);
  assert.equal(bad((m) => (m.emotions["bad name!"] = { idle: "x.webp", talk: [] })), null);
  assert.equal(packInfoFrom(null, BASE), null);
  assert.equal(packInfoFrom({ emotions: "no" }, BASE), null);
});

test("the link's ?pack= or ?character= is read as a plain id, and anything else in it is ignored", () => {
  assert.equal(wantedFromSearch("?pack=franzi-bikini"), "franzi-bikini");
  assert.equal(wantedFromSearch("?character=Miku"), "miku");
  assert.equal(wantedFromSearch("?x=1&pack=miku&character=franzi"), "miku", "pack wins when both are there");
  for (const bad of ["", "?pack=", "?pack=../x", "?pack=a%20b", "?pack=<script>", "?pack=" + "a".repeat(41), "?pack=https://evil.example/", "?other=miku"]) assert.equal(wantedFromSearch(bad), "", bad);
});

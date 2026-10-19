// Every preview in packs/thumbs/ whose pack is not bundled (no packs/<id>/ folder) is a download-only pack, and the download index must list it:
// otherwise the gallery shows a tile nobody can install, and the README and About page promise an outfit that does not exist yet.
// Publish the pack in the packs repository first (its publish workflow), then merge the thumbnail here.
// Needs the network (the live index, DEFAULT_PACK_INDEX_URL). Used by CI and by check.sh; CHECK_OFFLINE=1 skips it on a machine with none.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PACK_INDEX_URL } from "../src/pack-install.ts";

const packs = join(import.meta.dirname, "..", "packs");
const bundled = new Set(readdirSync(packs, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name));
const previews = readdirSync(join(packs, "thumbs")).filter((f) => f.endsWith(".webp")).map((f) => f.slice(0, -".webp".length));
const downloadOnly = previews.filter((id) => !bundled.has(id));

const response = await fetch(DEFAULT_PACK_INDEX_URL, { signal: AbortSignal.timeout(20_000) }).catch((error) => {
  console.error(`could not fetch the pack index (${DEFAULT_PACK_INDEX_URL}): ${error.message}`);
  process.exit(1);
});
if (!response.ok) {
  console.error(`the pack index answered ${response.status} (${DEFAULT_PACK_INDEX_URL})`);
  process.exit(1);
}
const listed = new Set(((await response.json()).packs ?? []).map((p) => p.id));
const missing = downloadOnly.filter((id) => !listed.has(id));
if (missing.length) {
  console.error(`packs/thumbs has a preview for pack(s) the published index does not list: ${missing.join(", ")}.\nPublish them in anime_ai_companion-packs first.`);
  process.exit(1);
}
console.log(`published: ${downloadOnly.join(", ") || "(none)"} are in the index`);

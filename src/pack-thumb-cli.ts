/**
 * Writes a gallery preview for every picture pack.
 *
 *   node src/pack-thumb-cli.ts [packs-dir] [-o packs/thumbs]
 *
 * Each pack that has a neutral frame gets `thumbs/<id>.webp` (about 200 px wide). That path is
 * the index entry's `thumbnail` field. The running app does not call this.
 */
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PACK_THUMBS_DIR } from "./frame-pack.ts";
import { writePackThumbs } from "./pack-thumb.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function usage(): string {
  return `Write a 200 px WebP preview of each pack's neutral frame.

  node src/pack-thumb-cli.ts [packs-dir] [-o out-dir]

packs-dir defaults to packs/. out-dir defaults to <packs-dir>/${PACK_THUMBS_DIR}.
Prints the thumbnail field to put in packs/index.json (thumbs/<id>.webp).`;
}

async function run(argv: string[]): Promise<number> {
  let packsDir = join(root, "packs");
  let outDir: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      console.log(usage());
      return 0;
    }
    if (arg === "-o" || arg === "--out") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        console.error("-o needs a folder.");
        return 1;
      }
      outDir = value;
      i += 1;
      continue;
    }
    positional.push(arg);
  }
  if (positional[0]) packsDir = positional[0];
  const written = await writePackThumbs(packsDir, outDir);
  if (!written.length) {
    console.error(`No packs with a neutral frame in ${packsDir}.`);
    return 1;
  }
  for (const thumb of written) {
    console.log(`${thumb.id}: ${thumb.thumbnail}  ${thumb.width}×${thumb.height}  ${thumb.bytes} bytes`);
  }
  return 0;
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exit(await run(process.argv.slice(2)));
}

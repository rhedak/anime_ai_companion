/**
 * Builds and restores a picture-pack patch archive. The running app does not call this.
 *
 *   node src/pack-archive-cli.ts build <pack-folder> -o <archive.tar>
 *   node src/pack-archive-cli.ts restore <archive.tar> -o <folder>
 *   node src/pack-archive-cli.ts report <archive.tar>
 *   node src/pack-archive-cli.ts index <archive.tar> --name <name> --version <version> --url <https-url>
 *       [--description text] [--credit text] [--thumbnail https-url] [--ai-made]
 */
import { realpathSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPackArchive, formatReport, indexEntryForArchive, inspectPackArchive, restorePackArchive } from "./pack-archive.ts";
import { PACK_INDEX_FORMAT } from "./pack-index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Args {
  command: string;
  positional: string[];
  out?: string;
  name?: string;
  version?: string;
  url?: string;
  description?: string;
  credit?: string;
  thumbnail?: string;
  aiMade: boolean;
}

function usage(): string {
  return `Build a lossless patch archive from a folder of lossless WebP frames, or restore one.

  node src/pack-archive-cli.ts build <pack-folder> -o <archive.tar>
  node src/pack-archive-cli.ts restore <archive.tar> -o <folder>
  node src/pack-archive-cli.ts report <archive.tar>
  node src/pack-archive-cli.ts index <archive.tar> --name <name> --version <version> --url <https-url>
      [--description text] [--credit text] [--thumbnail https-url] [--ai-made]

build prints a size report. index prints a packs/index.json document for that one archive.`;
}

function parseArgs(argv: string[]): Args | string {
  const positional: string[] = [];
  const opts = new Map<string, string>();
  let aiMade = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--ai-made") {
      aiMade = true;
      continue;
    }
    if (arg === "-o" || arg === "--out" || arg.startsWith("--")) {
      const key = arg === "-o" || arg === "--out" ? "out" : arg.slice(2);
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) return `${arg} needs a value.`;
      opts.set(key, value);
      i += 1;
      continue;
    }
    positional.push(arg);
  }
  return {
    command: positional[0] ?? "",
    positional: positional.slice(1),
    out: opts.get("out"),
    name: opts.get("name"),
    version: opts.get("version"),
    url: opts.get("url"),
    description: opts.get("description"),
    credit: opts.get("credit"),
    thumbnail: opts.get("thumbnail"),
    aiMade,
  };
}

async function emotions(): Promise<string[]> {
  const parsed = JSON.parse(await readFile(join(root, "emotions.json"), "utf8")) as Record<string, unknown>;
  return Object.keys(parsed);
}

async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (typeof args === "string" || args.command === "" || args.command === "help" || args.command === "--help") {
    console.log(typeof args === "string" ? `${args}\n\n${usage()}` : usage());
    return typeof args === "string" ? 1 : 0;
  }
  if (args.command === "build") {
    const folder = args.positional[0];
    if (!folder || !args.out) {
      console.error("build needs a pack folder and -o <archive.tar>.");
      return 1;
    }
    const built = await buildPackArchive(folder, { emotions: await emotions() });
    if (!built.ok) {
      console.error(built.reason);
      return 1;
    }
    await mkdir(dirname(args.out), { recursive: true });
    await writeFile(args.out, built.archive);
    console.log(formatReport(built.report));
    console.log(`wrote ${args.out}`);
    return 0;
  }
  if (args.command === "restore") {
    const archivePath = args.positional[0];
    if (!archivePath || !args.out) {
      console.error("restore needs an archive and -o <folder>.");
      return 1;
    }
    const restored = await restorePackArchive(await readFile(archivePath), args.out);
    if (!restored.ok) {
      console.error(restored.reason);
      return 1;
    }
    console.log(`restored ${restored.files.length} files into ${args.out}`);
    return 0;
  }
  if (args.command === "report") {
    const archivePath = args.positional[0];
    if (!archivePath) {
      console.error("report needs an archive.");
      return 1;
    }
    const inspected = inspectPackArchive(await readFile(archivePath));
    if (!inspected.ok) {
      console.error(inspected.reason);
      return 1;
    }
    console.log(formatReport(inspected.report));
    return 0;
  }
  if (args.command === "index") {
    const archivePath = args.positional[0];
    if (!archivePath || !args.name || !args.version || !args.url) {
      console.error("index needs an archive, --name, --version and --url.");
      return 1;
    }
    const entry = indexEntryForArchive(await readFile(archivePath), {
      name: args.name,
      version: args.version,
      url: args.url,
      description: args.description,
      credit: args.credit,
      thumbnail: args.thumbnail,
      aiMade: args.aiMade ? true : undefined,
    });
    if (!entry.ok) {
      console.error(entry.reason);
      return 1;
    }
    console.log(JSON.stringify({ format: PACK_INDEX_FORMAT, packs: [entry.entry] }, null, 2));
    return 0;
  }
  console.error(usage());
  return 1;
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exit(await run(process.argv.slice(2)));
}

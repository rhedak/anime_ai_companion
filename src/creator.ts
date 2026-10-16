/**
 * Where the anime-character-creator's TypeScript comes from (its `ts/src` folder, which src/creator-load.ts loads by path), in order:
 *   1. CREATOR_SRC (explicit override: the `ts/src` folder, not the Python `src` folder of the earlier releases)
 *   2. a sibling checkout at ../anime-character-creator (the development layout)
 *   3. a clone of the pinned tag from package.json ("creator"), kept in ~/.anaico/creator/<ref>
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function resolveCreatorSrc(): Promise<string> {
  if (process.env.CREATOR_SRC) return process.env.CREATOR_SRC;

  const sibling = resolve(root, "../anime-character-creator/ts/src");
  if (existsSync(sibling)) return sibling;

  const { url, ref } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).creator as {
    url: string;
    ref: string;
  };
  const dir = join(process.env.ANAICO_HOME ?? join(homedir(), ".anaico"), "creator", ref);
  const noTypeScript = (): Error =>
    new Error(`The creator at ${dir} has no ts/src folder (a release before its TypeScript). Set CREATOR_SRC to a checkout's ts/src folder, or pin a newer release in package.json.`);
  if (!existsSync(join(dir, "ts", "src"))) {
    if (existsSync(dir)) throw noTypeScript(); // an earlier release fetched here, in the Python layout
    console.log(`Fetching the character creator (${ref}) into ${dir} ...`);
    await mkdir(dirname(dir), { recursive: true });
    const clone = spawnSync("git", ["clone", "--quiet", "--depth", "1", "--branch", ref, url, dir], {
      stdio: "inherit",
    });
    if (clone.status !== 0) {
      throw new Error(`Could not clone ${url} at ${ref}. Set CREATOR_SRC to a local checkout's ts/src folder instead.`);
    }
    if (!existsSync(join(dir, "ts", "src"))) throw noTypeScript();
  }
  return join(dir, "ts", "src");
}

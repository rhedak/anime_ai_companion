/**
 * Where the anime-character-creator source comes from, in order:
 *   1. CREATOR_SRC (explicit override)
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

  const sibling = resolve(root, "../anime-character-creator/src");
  if (existsSync(sibling)) return sibling;

  const { url, ref } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).creator as {
    url: string;
    ref: string;
  };
  const dir = join(process.env.ANAICO_HOME ?? join(homedir(), ".anaico"), "creator", ref);
  if (!existsSync(join(dir, "src"))) {
    console.log(`Fetching the character creator (${ref}) into ${dir} ...`);
    await mkdir(dirname(dir), { recursive: true });
    const clone = spawnSync("git", ["clone", "--quiet", "--depth", "1", "--branch", ref, url, dir], {
      stdio: "inherit",
    });
    if (clone.status !== 0) {
      throw new Error(`Could not clone ${url} at ${ref}. Set CREATOR_SRC to a local checkout's src folder instead.`);
    }
  }
  return join(dir, "src");
}

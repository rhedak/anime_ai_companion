import { execFile } from "node:child_process";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const WEEK_MS = 7 * 24 * 3600 * 1000;

/** True if the checkout has uncommitted changes or commits its upstream does not have. */
async function hasLocalWork(dir: string): Promise<boolean> {
  try {
    await access(join(dir, ".git"));
    const git = (...args: string[]) => run("git", ["-C", dir, ...args], { timeout: 5000 });
    if ((await git("status", "--porcelain")).stdout.trim()) return true;
    const ahead = await git("rev-list", "--count", "@{u}..HEAD").catch(() => ({ stdout: "0" }));
    return Number(ahead.stdout.trim()) > 0;
  } catch {
    return false; // not a git checkout, or git is missing: nothing to say
  }
}

/**
 * A friendly, optional reminder. If your checkout of this project or of
 * anime-character-creator has local changes, say that a pull request would be
 * welcome. Purely local (no network, no telemetry), at most once a week, and
 * silenced with COMPANION_NO_NUDGE=1. It never blocks anything.
 */
export async function shareNudge(
  repos: { name: string; dir: string; url: string }[],
  statePath: string,
): Promise<void> {
  if (process.env.COMPANION_NO_NUDGE) return;
  try {
    const last = Number(JSON.parse(await readFile(statePath, "utf8")).last ?? 0);
    if (Date.now() - last < WEEK_MS) return;
  } catch {
    // no state yet
  }
  const changed: typeof repos = [];
  for (const repo of repos) if (await hasLocalWork(repo.dir)) changed.push(repo);
  if (changed.length === 0) return;

  console.log("\nYou have local changes in: " + changed.map((r) => r.name).join(", ") + ".");
  console.log("If they could help others, a pull request would be very welcome (never required):");
  for (const r of changed) console.log(`  ${r.url}`);
  console.log("Silence this with COMPANION_NO_NUDGE=1.\n");

  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify({ last: Date.now() }));
}

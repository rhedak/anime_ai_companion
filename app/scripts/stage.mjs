// Stages what the installer carries next to the shell: the app itself (only what runs, with its production packages) and the character creator at the
// release package.json pins. Output: app/stage/.
//   node scripts/stage.mjs
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const stage = join(here, "..", "stage");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
// npm.cmd and git need a shell on Windows to be found the way a user's terminal finds them.
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });

rmSync(stage, { recursive: true, force: true });
const appDir = join(stage, "anaico-app");
mkdirSync(appDir, { recursive: true });

// 1. The app: no tests, site, demo, trailer, docs, or the user's data/. Not named "app": Electron would take resources/app for its own program.
for (const item of ["src", "public", "packs", "bin", "persona.md", "persona-work.md", "emotions.json", "package.json", "package-lock.json", "LICENSE"]) {
  cpSync(join(root, item), join(appDir, item), { recursive: true });
}
run(npm, ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], appDir);
rmSync(join(appDir, "package-lock.json"));

// 2. The creator at the pinned release. Only its TypeScript is read at run time (ts/src, and ts/package.json, which says "type": "module");
// the reference images and the Python tooling are most of its size.
const creatorDir = join(stage, "creator");
run("git", ["-c", "advice.detachedHead=false", "clone", "--quiet", "--depth", "1", "--branch", pkg.creator.ref, pkg.creator.url, creatorDir]);
for (const name of readdirSync(creatorDir)) {
  if (name !== "ts" && name !== "LICENSE") rmSync(join(creatorDir, name), { recursive: true, force: true });
}
for (const name of readdirSync(join(creatorDir, "ts"))) {
  if (name !== "src" && name !== "package.json") rmSync(join(creatorDir, "ts", name), { recursive: true, force: true });
}
console.log(`Staged ${pkg.version} with the creator at ${pkg.creator.ref} in ${stage}`);

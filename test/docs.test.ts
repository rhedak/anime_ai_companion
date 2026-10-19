import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("every slash command the server has is in the commands page", () => {
  const source = read("src/server.ts");
  const block = source.slice(source.indexOf("const slashCommands"), source.indexOf("Object.setPrototypeOf(slashCommands"));
  const names = [...block.matchAll(/^  ("?)([a-z-]+)\1: /gm)].map((m) => m[2]);
  assert.ok(names.length > 15, `found only ${names.length} commands`);
  const page = read("site/pages/commands.md");
  for (const name of names) assert.ok(page.includes(`\`/${name}`), `site/pages/commands.md does not mention /${name}`);
});

test("the site builds, every page exists, and no link or picture points at nothing", () => {
  execFileSync(process.execPath, [join(root, "site/build.mjs")], { stdio: "pipe" });
  const dist = join(root, "site/dist");
  const files = readdirSync(dist).filter((f) => f.endsWith(".html"));
  assert.ok(files.length >= 13);
  for (const file of files) {
    const html = readFileSync(join(dist, file), "utf8");
    for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      if (target === "demo/") continue; // staged into the site after the build (the pages workflow, or npm run site:preview)
      const [path, hash] = target.split("#");
      assert.ok(existsSync(join(dist, path)), `${file} links to ${target}, which does not exist`);
      if (hash && path.endsWith(".html")) {
        const other = readFileSync(join(dist, path), "utf8");
        assert.ok(other.includes(`id="${hash}"`), `${file} links to ${target}, but that page has no such section`);
      }
    }
  }
});

test("every link from the site to a file on GitHub points at a file that exists in the repository", () => {
  execFileSync(process.execPath, [join(root, "site/build.mjs")], { stdio: "pipe" });
  const dist = join(root, "site/dist");
  const base = "https://github.com/rhedak/anime_ai_companion/";
  const checked = new Set<string>();
  for (const file of readdirSync(dist).filter((f) => f.endsWith(".html"))) {
    for (const m of readFileSync(join(dist, file), "utf8").matchAll(/href="([^"]+)"/g)) {
      const href = m[1].replace(/&amp;/g, "&");
      const rest = href.startsWith(base) ? /^(?:blob|tree|edit)\/main\/([^#?]+)/.exec(href.slice(base.length))?.[1] : undefined;
      if (!rest) continue;
      checked.add(rest);
      assert.ok(existsSync(join(root, rest)), `${file} links to ${rest} on GitHub, but it is not in the repository`);
    }
  }
  assert.ok(checked.has("packs/risa-dress/NOTICE.md") && checked.has("CONTRIBUTING.md"), "the repository links were not found");
});

test("the documentation does not carry anything personal", () => {
  const dist = join(root, "site/dist");
  execFileSync(process.execPath, [join(root, "site/build.mjs")], { stdio: "pipe" });
  for (const file of readdirSync(dist).filter((f) => f.endsWith(".html"))) {
    const html = readFileSync(join(dist, file), "utf8");
    assert.doesNotMatch(html, /\/Users\/[a-z]/i, `${file} has a home folder path`);
    assert.doesNotMatch(html, /\b(?:192\.168|100\.\d{1,3}|10\.\d{1,3})\.\d{1,3}\.\d{1,3}\b/, `${file} has a network address`);
    assert.doesNotMatch(html, /\?t=[A-Za-z0-9_-]{16,}/, `${file} has an access token`);
  }
});

test("the AI disclosure is in the README, on the About page, and at the foot of every page", () => {
  const readme = read("README.md");
  assert.match(readme, /## How this was made/);
  assert.match(readme, /documentation was written by Claude Code/i);
  const about = read("site/pages/about.md");
  assert.match(about, /## How this was made/);
  for (const agent of ["Claude Code", "Cursor", "opencode", "Big Pickle", "Grok"]) assert.ok(about.includes(agent), `the About page does not name ${agent}`);
  assert.match(about, /documentation[^.]*written by Claude Code/i);
  execFileSync(process.execPath, [join(root, "site/build.mjs")], { stdio: "pipe" });
  const dist = join(root, "site/dist");
  for (const file of readdirSync(dist).filter((f) => f.endsWith(".html") && f !== "404.html")) {
    assert.match(readFileSync(join(dist, file), "utf8"), /This documentation was written by Claude Code/, `${file} has no AI note`);
  }
});

test("the clone commands in the README and on the site take the creator release that package.json pins", () => {
  const ref = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).creator.ref;
  for (const file of ["README.md", "site/pages/getting-started.md"]) {
    const text = readFileSync(join(root, file), "utf8");
    assert.ok(text.includes(`git clone --branch ${ref} https://github.com/rhedak/anime-character-creator.git`), `${file}: clone the creator with --branch ${ref} (the pin in package.json)`);
    assert.doesNotMatch(text, /^git clone https:\/\/github\.com\/rhedak\/anime-character-creator\.git/m, `${file}: a bare clone gets whatever main holds today`);
  }
});

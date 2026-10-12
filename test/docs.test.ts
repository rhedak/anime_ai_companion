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
      const [path, hash] = target.split("#");
      assert.ok(existsSync(join(dist, path)), `${file} links to ${target}, which does not exist`);
      if (hash && path.endsWith(".html")) {
        const other = readFileSync(join(dist, path), "utf8");
        assert.ok(other.includes(`id="${hash}"`), `${file} links to ${target}, but that page has no such section`);
      }
    }
  }
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

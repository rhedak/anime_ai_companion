import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { exportPack, importPack } from "../src/studio/transfer.ts";
import { removeDir } from "./helpers/platform.ts";

async function pack(files: Record<string, string>): Promise<{ root: string; folder: string }> {
  const root = await mkdtemp(join(tmpdir(), "anaico-transfer-"));
  const folder = join(root, "src-pack");
  await mkdir(folder);
  for (const [name, text] of Object.entries(files)) await writeFile(join(folder, name), text);
  return { root, folder };
}

test("export copies pictures and texts, adds a notice only when missing, and never overwrites", async () => {
  const { root, folder } = await pack({ "neutral.webp": "a", "happy.webp": "b", "look.txt": "her look", "stray.exe": "x" });
  try {
    const out = join(root, "out");
    await mkdir(out);
    const to = await exportPack(folder, out, "mine");
    assert.deepEqual((await readdir(to)).sort(), ["happy.webp", "look.txt", "neutral.webp", "NOTICE.md"].sort());
    assert.equal(await readFile(join(to, "look.txt"), "utf8"), "her look");
    await assert.rejects(exportPack(folder, out, "mine"), /already exists/);
    await assert.rejects(exportPack(folder, "relative/dir", "mine"), /whole path/);
  } finally {
    await removeDir(root);
  }
});

test("export keeps a NOTICE.md the pack already has", async () => {
  const { root, folder } = await pack({ "neutral.webp": "a", "NOTICE.md": "theirs" });
  try {
    const to = await exportPack(folder, root, "kept");
    assert.equal(await readFile(join(to, "NOTICE.md"), "utf8"), "theirs");
  } finally {
    await removeDir(root);
  }
});

test("import needs a neutral picture, skips links, and refuses an existing pack", async () => {
  const { root, folder } = await pack({ "neutral.webp": "a", "sad.webp": "b" });
  try {
    await symlink(join(folder, "neutral.webp"), join(folder, "link.webp"));
    const frames = join(root, "frames");
    assert.equal(await importPack(folder, frames, "new"), 2);
    assert.deepEqual((await readdir(join(frames, "new"))).sort(), ["NOTICE.md", "neutral.webp", "sad.webp"]);
    await assert.rejects(importPack(folder, frames, "new"), /already a pack/);
    const empty = join(root, "empty");
    await mkdir(empty);
    await assert.rejects(importPack(empty, frames, "other"), /no neutral\.webp/);
  } finally {
    await removeDir(root);
  }
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { findImageTags } from "../src/avatar-tags.ts";
import { checkShownImage } from "../src/shown-images.ts";
import { trySymlinkFile } from "./helpers/platform.ts";

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
let dir = "";
let root = "";
let outside = "";
let linked = false;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "shown-"));
  root = join(dir, "project");
  outside = join(dir, "secret.png");
  await mkdir(join(root, "shots"), { recursive: true });
  await writeFile(join(root, "shots", "a.png"), png);
  await writeFile(join(root, "fake.png"), "<html>not a png</html>");
  await writeFile(join(root, "notes.txt"), "text");
  await writeFile(outside, png);
  linked = trySymlinkFile(outside, join(root, "link.png")); // Windows without Developer Mode cannot make a file symlink
});
after(() => rm(dir, { recursive: true, force: true }));

test("a real image inside the folder is accepted, by relative or absolute path", async () => {
  const relative = await checkShownImage("shots/a.png", root);
  assert.ok(!("error" in relative));
  assert.equal(relative.name, "a.png");
  assert.equal(relative.mime, "image/png");
  assert.ok(!("error" in (await checkShownImage(join(root, "shots", "a.png"), root))));
});

test("anything outside the folder is refused: paths, dots, symlinks", async (t) => {
  for (const bad of [outside, "../secret.png", "/etc/passwd.png", ...(linked ? ["link.png"] : [])]) {
    const result = await checkShownImage(bad, root);
    assert.ok("error" in result, bad);
  }
  if (!linked) t.diagnostic("the symlink case was not run: this machine cannot create a file symlink without privileges");
});

test("only real images: extension, contents and existence are all checked", async () => {
  assert.match(String((await checkShownImage("notes.txt", root) as any).error), /only PNG, JPEG, GIF and WebP/);
  assert.match(String((await checkShownImage("fake.png", root) as any).error), /not a real PNG/);
  assert.match(String((await checkShownImage("missing.png", root) as any).error), /no such file/);
  assert.match(String((await checkShownImage("shots", root) as any).error), /only PNG/);
});

test("image tags name their paths, quotes and spaces included", () => {
  assert.deepEqual(findImageTags("Here: [image shots/a.png] and [image 'my dir/b.jpg'] done"), ["shots/a.png", "my dir/b.jpg"]);
  assert.deepEqual(findImageTags("no tags [avatar glasses=true]"), []);
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { detectLocalImageModels, hubCacheDir } from "../src/studio/local-models.ts";

test("the image models on this computer are found in the Hugging Face cache, a model with no snapshot is not", async () => {
  const hub = await mkdtemp(join(tmpdir(), "hub-"));
  try {
    await mkdir(join(hub, "models--Qwen--Qwen-Image-2.1-Turbo", "snapshots", "abc123"), { recursive: true });
    await mkdir(join(hub, "models--Qwen--Qwen-Image-Edit", "snapshots"), { recursive: true }); // an empty snapshot folder: nothing downloaded
    await mkdir(join(hub, "models--Other--chat", "snapshots", "x"), { recursive: true }); // not an image model we know
    assert.deepEqual((await detectLocalImageModels(hub)).map((m) => m.label), ["Qwen-Image-2.1-Turbo"]);
    assert.deepEqual(await detectLocalImageModels(join(hub, "nowhere")), [], "a missing cache folder finds nothing");
  } finally {
    await rm(hub, { recursive: true, force: true });
  }
});

test("the cache folder is HF_HUB_CACHE when it is set, and the Hugging Face default otherwise", () => {
  assert.equal(hubCacheDir({ HF_HUB_CACHE: "/data/hub" }), "/data/hub");
  assert.match(hubCacheDir({}), /\.cache\/huggingface\/hub$/);
});

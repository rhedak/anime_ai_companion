import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Image models whose weights may be on this computer, in the Hugging Face cache (the place local_models reads them from: `HF_HUB_CACHE`, or
 * `~/.cache/huggingface/hub`). Finding them does not start anything: the studio's local entry says what is there and how to start a backend for it.
 */
export const LOCAL_IMAGE_MODELS: readonly { repo: string; label: string }[] = [
  { repo: "black-forest-labs/FLUX.2-klein-4B", label: "FLUX.2 klein 4B" }, // the one `python/pack_studio/server.py` serves
  { repo: "Qwen/Qwen-Image-2.1-Turbo", label: "Qwen-Image-2.1-Turbo" },
  { repo: "Qwen/Qwen-Image-Edit", label: "Qwen-Image-Edit" },
  { repo: "Tongyi-MAI/Z-Image-Turbo", label: "Z-Image-Turbo" },
  { repo: "LyliaEngine/Pony_Diffusion_V6_XL", label: "Pony Diffusion V6 XL" },
];

/** The folder the Hugging Face library keeps its downloads in. */
export function hubCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.HF_HUB_CACHE?.trim() || join(homedir(), ".cache", "huggingface", "hub");
}

/**
 * The models of `LOCAL_IMAGE_MODELS` that have a downloaded snapshot in `hub` (a snapshot folder that is not empty). A model that is only
 * partly downloaded still counts: the reference loader reads what is there, and the backend says if something is missing.
 */
export async function detectLocalImageModels(hub: string = hubCacheDir()): Promise<{ repo: string; label: string }[]> {
  const found: { repo: string; label: string }[] = [];
  for (const model of LOCAL_IMAGE_MODELS) {
    const snapshots = join(hub, `models--${model.repo.replace("/", "--")}`, "snapshots");
    const entries = await readdir(snapshots).catch(() => [] as string[]);
    if (entries.length > 0) found.push(model);
  }
  return found;
}

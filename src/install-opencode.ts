import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, open, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataDir } from "./paths.ts";

/**
 * Installing opencode for the user, after they said yes in the page. The program is the standalone build opencode publishes on GitHub (no Node,
 * npm or administrator needed), kept in this app's own data folder and never put on the PATH: a copy the user installed themselves is left alone.
 *
 * It is PINNED: one release, with the SHA-256 of each file, so the app runs what was looked at and nothing a later release put there. Moving the
 * pin is part of a release: see "Before a release" in AGENTS.md. A file whose hash differs is thrown away.
 */
export const OPENCODE_PIN = {
  version: "1.19.3",
  repo: "anomalyco/opencode",
  /** By `${platform}-${arch}`. The x64 build is the "baseline" one: it needs no AVX2, so it starts on any 64-bit PC, and she does not need the speed. */
  assets: {
    "win32-x64": { name: "opencode-windows-x64-baseline.zip", sha256: "0d59113484bfe8d6dc146fc981f5c33faa8318303c183711b7a9387060b289e8", bytes: 62204138, program: "opencode.exe" },
    "win32-arm64": { name: "opencode-windows-arm64.zip", sha256: "c1b9daf18c97564b2d171703279621f7edc3613e70750d796ef78db87257ad89", bytes: 60695316, program: "opencode.exe" },
  },
} as const;

export interface OpencodeAsset {
  name: string;
  sha256: string;
  bytes: number;
  program: string;
}

/** The pinned file for this machine, or null where there is none (the page then says how to install it by hand). */
export function opencodeAsset(platform: string = process.platform, arch: string = process.arch): OpencodeAsset | null {
  return (OPENCODE_PIN.assets as Record<string, OpencodeAsset>)[`${platform}-${arch}`] ?? null;
}

export const opencodeUrl = (asset: OpencodeAsset): string => `https://github.com/${OPENCODE_PIN.repo}/releases/download/v${OPENCODE_PIN.version}/${asset.name}`;

/** Where the pinned version lives: a folder per version, so a new pin installs next to the old one instead of into it. */
export function opencodeFolder(root: string = dataDir): string {
  return join(root, "tools", `opencode-${OPENCODE_PIN.version}`);
}

/** The managed opencode program if the pinned version is installed, else null. */
export function managedOpencode(root: string = dataDir, platform: string = process.platform, arch: string = process.arch): string | null {
  const asset = opencodeAsset(platform, arch);
  if (!asset) return null;
  const program = join(opencodeFolder(root), asset.program);
  return existsSync(program) ? program : null;
}

export interface InstallProgress {
  stage: "download" | "unpack" | "check";
  received?: number;
  total?: number;
}

export interface InstallOptions {
  root?: string;
  platform?: string;
  arch?: string;
  signal?: AbortSignal;
  onProgress?: (progress: InstallProgress) => void;
  /** Test seams: the file to expect (instead of the pinned one), the network, the unpacker and the "does it run" check. */
  asset?: OpencodeAsset;
  fetchFn?: typeof fetch;
  extract?: (archive: string, into: string) => Promise<void>;
  versionOf?: (program: string) => Promise<string>;
}

/** An install that failed, with a message that is fit to show the user as it is. */
export class InstallError extends Error {}

/** `tar` ships with Windows 10 (1803) and later and reads zip files. */
function defaultExtract(archive: string, into: string): Promise<void> {
  const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  return new Promise((resolve, reject) => {
    const child = spawn(tar, ["-xf", archive, "-C", into], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => reject(new InstallError(`Could not unpack the download: ${e.message}`)));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new InstallError(`Could not unpack the download: ${err.trim().slice(0, 200) || `exit ${code}`}`))));
  });
}

function defaultVersionOf(program: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, ["--version"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    const timer = setTimeout(() => child.kill(), 20_000);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", () => {
      clearTimeout(timer);
      resolve(out.trim());
    });
  });
}

/**
 * Downloads, checks, unpacks and tries the pinned opencode. Everything happens in a scratch folder inside `tools/`, which is renamed into place
 * only at the end, so a failed or stopped install leaves nothing half-made behind. Resolves to the program's path.
 */
export async function installOpencode(options: InstallOptions = {}): Promise<string> {
  const { root = dataDir, platform = process.platform, arch = process.arch, signal, onProgress } = options;
  const fetchFn = options.fetchFn ?? fetch;
  const extract = options.extract ?? defaultExtract;
  const versionOf = options.versionOf ?? defaultVersionOf;
  const asset = options.asset ?? opencodeAsset(platform, arch);
  if (!asset) throw new InstallError(`There is no opencode build for ${platform} ${arch} that I can install. Install it yourself (https://opencode.ai) and restart the app.`);

  const tools = join(root, "tools");
  await mkdir(tools, { recursive: true });
  const scratch = await mkdtemp(join(tools, ".installing-"));
  try {
    // 1. Download, hashing as it arrives. The size is known, so a file that runs on is cut off rather than filling the disk.
    const response = await fetchFn(opencodeUrl(asset), { signal, redirect: "follow" }).catch((err: unknown) => {
      if (signal?.aborted) throw new InstallError("Stopped.");
      throw new InstallError(`Could not reach GitHub: ${err instanceof Error ? err.message : String(err)}`);
    });
    if (!response.ok || !response.body) throw new InstallError(`GitHub answered ${response.status} for the download.`);
    const archive = join(scratch, asset.name);
    const hash = createHash("sha256");
    const file = await open(archive, "w");
    let received = 0;
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        received += chunk.length;
        if (received > asset.bytes + 1024 * 1024) throw new InstallError("The download is larger than expected, so it was stopped.");
        hash.update(chunk);
        await file.write(chunk);
        onProgress?.({ stage: "download", received, total: asset.bytes });
      }
    } catch (err) {
      if (signal?.aborted) throw new InstallError("Stopped.");
      throw err instanceof InstallError ? err : new InstallError(`The download broke off: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await file.close();
    }
    if (hash.digest("hex") !== asset.sha256) throw new InstallError("The download is not the file this version of the app expects (its checksum differs), so it was thrown away.");

    // 2. Unpack and find the program.
    onProgress?.({ stage: "unpack" });
    const unpacked = join(scratch, "unpacked");
    await mkdir(unpacked);
    await extract(archive, unpacked);
    const program = join(unpacked, asset.program);
    if (!existsSync(program)) throw new InstallError(`The download did not contain ${asset.program}.`);
    await rm(archive, { force: true });

    // 3. Run it once: it must start and say the pinned version.
    onProgress?.({ stage: "check" });
    const said = await versionOf(program).catch(() => "");
    if (!said.includes(OPENCODE_PIN.version)) throw new InstallError(`The program did not start properly (it said "${said.slice(0, 80)}").`);

    // 4. Into place.
    const finalFolder = opencodeFolder(root);
    await rm(finalFolder, { recursive: true, force: true });
    await mkdir(dirname(finalFolder), { recursive: true });
    await rename(unpacked, finalFolder);
    return join(finalFolder, asset.program);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Removes scratch folders an earlier install left when the app was closed in the middle of it. */
export async function cleanInstallLeftovers(root: string = dataDir): Promise<void> {
  const tools = join(root, "tools");
  for (const name of await readdir(tools).catch(() => [] as string[])) {
    if (name.startsWith(".installing-")) await rm(join(tools, name), { recursive: true, force: true });
  }
}

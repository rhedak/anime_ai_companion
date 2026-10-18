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
    // macOS (zip) and Linux (tar.gz, the glibc build: Alpine and other musl systems fall back to installing by hand). The system `tar` reads both.
    "darwin-arm64": { name: "opencode-darwin-arm64.zip", sha256: "c2d0fecd27acf6e08be02c1f5d384614d07495587766bcc4a6bff3971749bb64", bytes: 45587801, program: "opencode" },
    "darwin-x64": { name: "opencode-darwin-x64-baseline.zip", sha256: "03f8c32f81a2c35429afedfb8f63978af32329febcebf800d52486f6ba568151", bytes: 49218661, program: "opencode" },
    "linux-arm64": { name: "opencode-linux-arm64.tar.gz", sha256: "7900818a6a98881edbbadab4b7525940eff3b9750040c200481f9f56cacee405", bytes: 60519745, program: "opencode" },
    "linux-x64": { name: "opencode-linux-x64-baseline.tar.gz", sha256: "531cff2441129c30f0edd5878af494108ad07f5feb46d7ee29a2a5b830a5765d", bytes: 60716645, program: "opencode" },
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

/**
 * The environment the managed copy runs with: its own config, data, cache and state folders. opencode keeps one database in the user's home and
 * refuses to start when another generation of OpenCode (the desktop app, a newer or older CLI) has written there ("Database is not empty and has no
 * session table"), and this copy must neither fall over that nor touch what is there. Free models need no sign-in, so nothing is lost by it.
 */
export function managedOpencodeEnv(root: string = dataDir): Record<string, string> {
  const home = join(root, "tools", "opencode-home");
  return { XDG_DATA_HOME: join(home, "data"), XDG_CONFIG_HOME: join(home, "config"), XDG_CACHE_HOME: join(home, "cache"), XDG_STATE_HOME: join(home, "state") };
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

/**
 * Renames, trying again for a few seconds when Windows says no. A program that has just been written or run is held for a moment by the virus scanner
 * (Defender), and renaming its folder then fails with EPERM, EBUSY or EACCES: it passes on its own. Other errors are not retried.
 */
export async function renameWithRetry(from: string, to: string, rename_: (a: string, b: string) => Promise<void> = rename, waitMs = 250, tries = 20): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename_(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= tries || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw err;
      await new Promise((resolve) => setTimeout(resolve, waitMs * Math.min(attempt, 8)));
    }
  }
}

/** `tar` ships with Windows 10 (1803) and later (it reads zip files), with macOS (zip and tar.gz) and with Linux (tar.gz). */
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
    await renameWithRetry(unpacked, finalFolder);
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

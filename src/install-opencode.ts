import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, open, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataDir } from "./paths.ts";

/**
 * Installing opencode for the user, after they said yes in the page. opencode 2.x publishes its standalone builds as platform packages on npm (no Node,
 * npm or administrator needed at run time), kept in this app's own data folder and never put on the PATH: a copy the user installed themselves is left alone.
 *
 * It is PINNED: one release, with the SHA-256 of each tarball, so the app runs what was looked at and nothing a later release put there. Moving the
 * pin is part of a release: see "Before a release" in AGENTS.md. A file whose hash differs is thrown away.
 */
export const OPENCODE_PIN = {
  version: "2.1.3",
  registry: "https://registry.npmjs.org",
  /** By `${platform}-${arch}`. The x64 packages are the "baseline" ones: they need no AVX2, so they start on any 64-bit PC, and she does not need the speed. */
  assets: {
    "win32-x64": { package: "@opencode/cli-windows-x64-baseline", name: "cli-windows-x64-baseline-2.1.3.tgz", sha256: "ee2a2c4ca6db550a05a8c4668ad1fc0a497c0b71a16795cf60f7298c4090ee98", bytes: 116608796, folder: "package", program: "bin/opencode.exe" },
    "win32-arm64": { package: "@opencode/cli-windows-arm64", name: "cli-windows-arm64-2.1.3.tgz", sha256: "82bacaf2c7df0b95d59fc52bb86820090bec7e9ef1549636adcc0131aa03fa59", bytes: 110098074, folder: "package", program: "bin/opencode.exe" },
    // macOS and Linux (the glibc build: Alpine and other musl systems fall back to installing by hand). The system `tar` reads every tarball.
    "darwin-arm64": { package: "@opencode/cli-darwin-arm64", name: "cli-darwin-arm64-2.1.3.tgz", sha256: "f1addcd5efa7fea919e66f4f26b4f25c7fc695d52225d861ebc3a0779ec04db8", bytes: 100520406, folder: "package", program: "bin/opencode" },
    "darwin-x64": { package: "@opencode/cli-darwin-x64-baseline", name: "cli-darwin-x64-baseline-2.1.3.tgz", sha256: "b6aa0eeac0f94e5f4a6ef7193c79ed4a72845fb997dceb9cce4fa07383668e4f", bytes: 105630583, folder: "package", program: "bin/opencode" },
    "linux-arm64": { package: "@opencode/cli-linux-arm64", name: "cli-linux-arm64-2.1.3.tgz", sha256: "85046ccd46334022a702dc6e53231fefd994ff935a3b934b95390776b36b98c8", bytes: 112423922, folder: "package", program: "bin/opencode" },
    "linux-x64": { package: "@opencode/cli-linux-x64-baseline", name: "cli-linux-x64-baseline-2.1.3.tgz", sha256: "dc83c937744ba5e2322fec05b26170e3f9240b0e4e8ffc665fe8e96e7e6e807e", bytes: 113799625, folder: "package", program: "bin/opencode" },
  },
} as const;

export interface OpencodeAsset {
  package: string;
  name: string;
  sha256: string;
  bytes: number;
  folder: string;
  program: string;
}

/** The pinned file for this machine, or null where there is none (the page then says how to install it by hand). */
export function opencodeAsset(platform: string = process.platform, arch: string = process.arch): OpencodeAsset | null {
  return (OPENCODE_PIN.assets as Record<string, OpencodeAsset>)[`${platform}-${arch}`] ?? null;
}

export const opencodeUrl = (asset: OpencodeAsset): string => `${OPENCODE_PIN.registry}/${asset.package}/-/${asset.name}`;

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

/** `tar` ships with Windows 10 (1803) and later, with macOS and with Linux, and reads npm's `.tgz` packages everywhere. */
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
      throw new InstallError(`Could not reach the package registry: ${err instanceof Error ? err.message : String(err)}`);
    });
    if (!response.ok || !response.body) throw new InstallError(`The package registry answered ${response.status} for the download.`);
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
    const packageFolder = join(unpacked, asset.folder);
    const program = join(packageFolder, asset.program);
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
    await renameWithRetry(packageFolder, finalFolder);
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

/**
 * Downloads a picture pack from `packs/index.json` and restores it into a folder `readPack` already understands.
 *
 * The index URL defaults to the sister repository's GitHub Pages site. That site is not published yet
 * (`DEFAULT_PACK_INDEX_URL` is a placeholder): a failure leaves every pack already on disk working.
 * Set `COMPANION_PACK_INDEX` to another https address, or to `off`, to change that.
 *
 * An installed pack lands in `destDir/<id>` (the app uses `data/frames`). The archive is checked
 * (size and sha256) before anything is restored. Restore goes into a temporary folder and is renamed
 * into place. A second install of the same archive does nothing. A folder that is already there and
 * was not installed by this module is left untouched.
 */
import { createHash, randomBytes } from "node:crypto";
import { open, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isPackName, PACK_THUMBS_DIR } from "./frame-pack.ts";
import { restorePackArchive } from "./pack-archive.ts";
import {
  isDownloadUrl,
  isLoopbackHttp,
  isRemoteUrl,
  parsePackIndex,
  resolveThumbnail,
  type PackIndex,
  type PackIndexEntry,
  type PackIndexResult,
} from "./pack-index.ts";

/**
 * The pack list the app asks for when `COMPANION_PACK_INDEX` is not set.
 * Placeholder: the sister repository (`anime_ai_companion-packs`) has no GitHub Pages site yet,
 * so this address does not serve an index. Until it does, the gallery simply has nothing to download.
 */
export const DEFAULT_PACK_INDEX_URL = "https://rhedak.github.io/anime_ai_companion-packs/index.json";

const INDEX_TIMEOUT_MS = 8_000;
const ARCHIVE_TIMEOUT_MS = 120_000;
const THUMB_TIMEOUT_MS = 8_000;
const INDEX_CACHE_MS = 60_000;
const INDEX_FAILURE_CACHE_MS = 30_000;
const MAX_INDEX_BYTES = 1_000_000;
const MAX_THUMB_BYTES = 512 * 1024;
/** Written inside an installed pack. A dotfile, so `readPack` ignores it. */
const MARKER = ".pack-install.json";

export interface PackProgress {
  phase: "index" | "download" | "verify" | "restore" | "done";
  id: string;
  received?: number;
  total?: number;
}

export type InstallResult =
  | { ok: true; status: "installed" | "already" | "present"; id: string; dir: string }
  | { ok: false; reason: string };

/** The slice of `fetch` the installer uses. Tests pass their own; the app uses `globalThis.fetch`. */
export interface PackFetchResponse {
  ok: boolean;
  status: number;
  url: string;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
  body?: ReadableStream<Uint8Array> | null;
}

export type PackFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<PackFetchResponse>;

/** What an installed pack says about itself (its marker): the version and archive hash it was installed from. */
export interface InstalledPack {
  version: string;
  sha256: string;
}

/** A pack on this computer that the pack list has newer files for. */
export interface PackUpdate {
  id: string;
  /** The version on this computer, and the one the pack list offers. They can be equal: a republished archive with the same version number is still an update. */
  installed: string;
  available: string;
  entry: PackIndexEntry;
}

/** True when `a` is a higher dotted version (1, 1.2, 1.2.3) than `b`. Anything that is not numbers compares as equal. */
export function versionHigher(a: string, b: string): boolean {
  const parts = (v: string) => v.split(".").map((n) => Number(n));
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (Number.isNaN(d)) return false;
    if (d !== 0) return d > 0;
  }
  return false;
}

export interface PackInstaller {
  /** Loads and checks the index. A network or parse failure is `{ ok: false }`, never a throw. */
  loadIndex(force?: boolean): Promise<PackIndexResult>;
  /** The last index that parsed, if one has. */
  index(): PackIndex | null;
  /** A sentence to add when the list could not be reached, or null when the list is simply unused or fine. */
  indexNote(): string | null;
  /** The entry for `id` in the cached or freshly loaded index, or null. */
  find(id: string): Promise<PackIndexEntry | null>;
  /** The version a pack on disk was installed as, or null for a pack this installer did not put there (shipped, or the user's own: those are never updated). */
  installed(id: string): Promise<InstalledPack | null>;
  /**
   * Whether the pack list, as last loaded, has other files for an installed pack. Looks only at the list already in memory: it never goes to the network,
   * so a caller decides when the list is fetched. Null when there is nothing newer, or the pack list has not been loaded.
   */
  updateFor(id: string): Promise<PackUpdate | null>;
  /** `updateFor` for every pack this installer put in `destDir`. */
  updates(): Promise<PackUpdate[]>;
  /** Downloads and restores one pack. Idempotent for the same archive. Reports progress through `onProgress`. */
  install(id: string, onProgress?: (event: PackProgress) => void): Promise<InstallResult>;
  /**
   * The gallery preview, without installing the pack. A file in `thumbsDir`, then a cached download,
   * then (only when an index is already loaded) the entry's thumbnail. Null when there is nothing to show.
   */
  thumbnail(id: string): Promise<Buffer | null>;
}

export interface PackInstallerOptions {
  /** Where a restored pack is placed. The app passes `data/frames`. */
  destDir: string;
  /** Index URL. `null` disables remote packs. Omitted means `DEFAULT_PACK_INDEX_URL`. */
  indexUrl?: string | null;
  fetch?: PackFetch;
  /** Shipped previews: `packs/thumbs/<id>.webp`. */
  thumbsDir?: string;
  /** Where a downloaded preview is kept. Defaults to `destDir/.thumbs`. */
  thumbCacheDir?: string;
}

interface Marker {
  id: string;
  version: string;
  sha256: string;
}

/** `COMPANION_PACK_INDEX`, or the placeholder when it is unset. `off` or an empty value disables it. */
export function packIndexUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  if (Object.prototype.hasOwnProperty.call(env, "COMPANION_PACK_INDEX")) {
    const value = (env.COMPANION_PACK_INDEX ?? "").trim();
    if (value === "" || value.toLowerCase() === "off") return null;
    return value;
  }
  return DEFAULT_PACK_INDEX_URL;
}

export const defaultPackFetch: PackFetch = (url, init) => fetch(url, { signal: init?.signal, redirect: "follow" });

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isWebp(bytes: Buffer): boolean {
  return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}

async function readOptional(path: string): Promise<Buffer | null> {
  return readFile(path).catch(() => null);
}

function failureKind(err: unknown): "timeout" | "network" {
  return err instanceof Error && err.name === "TimeoutError" ? "timeout" : "network";
}

function unreachable(what: string, err: unknown): string {
  if (failureKind(err) === "timeout") return `${what} took too long. Packs already on this computer still work.`;
  return `${what} could not be reached. Packs already on this computer still work.`;
}

export function createPackInstaller(options: PackInstallerOptions): PackInstaller {
  const destDir = options.destDir;
  const indexUrl = options.indexUrl === undefined ? DEFAULT_PACK_INDEX_URL : options.indexUrl;
  const fetchImpl = options.fetch ?? defaultPackFetch;
  const thumbsDir = options.thumbsDir ?? null;
  const thumbCacheDir = options.thumbCacheDir ?? join(destDir, `.${PACK_THUMBS_DIR}`);
  const allowLoopbackHttp = indexUrl !== null && isLoopbackHttp(indexUrl);

  let cached: PackIndex | null = null;
  let loadedAt = 0;
  let problem: "offline" | "other" | null = null;
  let problemReason = "";
  let loading: Promise<PackIndexResult> | null = null;
  const inflight = new Map<string, Promise<InstallResult>>();

  function remember(result: PackIndexResult, offline: boolean): PackIndexResult {
    loadedAt = Date.now();
    if (result.ok) {
      cached = result.index;
      problem = null;
      problemReason = "";
    } else {
      problem = offline ? "offline" : "other";
      problemReason = result.reason;
    }
    return result;
  }

  async function fetchIndex(): Promise<PackIndexResult> {
    if (indexUrl === null) return remember({ ok: false, reason: "No pack index is configured." }, false);
    if (!isRemoteUrl(indexUrl, { allowLoopbackHttp: true }) || (!isDownloadUrl(indexUrl) && !isLoopbackHttp(indexUrl))) {
      return remember({ ok: false, reason: "The pack index address must be https." }, false);
    }
    let response: PackFetchResponse;
    try {
      response = await fetchImpl(indexUrl, { signal: AbortSignal.timeout(INDEX_TIMEOUT_MS) });
    } catch (err) {
      return remember({ ok: false, reason: unreachable("The pack list", err) }, true);
    }
    const finalUrl = response.url || indexUrl;
    if (!isRemoteUrl(finalUrl, { allowLoopbackHttp })) {
      return remember({ ok: false, reason: "The pack list moved to an address that is not https." }, false);
    }
    if (response.status === 404) return remember({ ok: false, reason: "There is no pack list at that address yet." }, false);
    if (!response.ok) return remember({ ok: false, reason: `The pack list answered ${response.status}.` }, false);
    let bytes: Buffer;
    try {
      bytes = Buffer.from(await response.arrayBuffer());
    } catch (err) {
      return remember({ ok: false, reason: unreachable("The pack list", err) }, true);
    }
    if (bytes.length > MAX_INDEX_BYTES) return remember({ ok: false, reason: "The pack list is too large." }, false);
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      return remember({ ok: false, reason: "The pack list is not JSON." }, false);
    }
    const checked = parsePackIndex(parsed, { allowLoopbackHttp });
    return remember(checked.ok ? checked : { ok: false, reason: `The pack list could not be read. ${checked.reason}` }, false);
  }

  async function loadIndex(force = false): Promise<PackIndexResult> {
    const fresh = Date.now() - loadedAt < (problem ? INDEX_FAILURE_CACHE_MS : INDEX_CACHE_MS);
    if (!force && fresh && cached && !problem) return { ok: true, index: cached };
    if (!force && fresh && problem) return { ok: false, reason: problemReason };
    if (!force && loading) return loading;
    const run = fetchIndex().finally(() => {
      if (loading === run) loading = null;
    });
    loading = run;
    return run;
  }

  async function readMarker(dir: string): Promise<Marker | null> {
    const raw = await readOptional(join(dir, MARKER));
    if (!raw) return null;
    try {
      const value = JSON.parse(raw.toString("utf8")) as Partial<Marker>;
      if (typeof value.id !== "string" || typeof value.version !== "string" || typeof value.sha256 !== "string") return null;
      return { id: value.id, version: value.version, sha256: value.sha256 };
    } catch {
      return null;
    }
  }

  async function download(url: string, expected: number, id: string, onProgress?: (event: PackProgress) => void): Promise<Buffer | string> {
    let response: PackFetchResponse;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS) });
    } catch (err) {
      return unreachable("The pack", err);
    }
    const finalUrl = response.url || url;
    if (!isRemoteUrl(finalUrl, { allowLoopbackHttp })) return "The download moved to an address that is not https.";
    if (!response.ok) return `The pack answered ${response.status}.`;
    const declared = response.headers.get("content-length");
    if (declared !== null && declared !== "" && Number(declared) !== expected) {
      await response.body?.cancel().catch(() => {});
      return `The download is ${declared} bytes, and the pack list says ${expected}.`;
    }
    const tarPath = join(destDir, `.incoming-${id}-${randomBytes(4).toString("hex")}.tar`);
    await mkdir(destDir, { recursive: true });
    const handle = await open(tarPath, "w");
    let received = 0;
    let lastReport = 0;
    let closed = false;
    const take = async (chunk: Buffer): Promise<boolean> => {
      received += chunk.length;
      if (received > expected) return false;
      await handle.write(chunk);
      const now = Date.now();
      if (received === expected || now - lastReport >= 100) {
        lastReport = now;
        onProgress?.({ phase: "download", id, received, total: expected });
      }
      return true;
    };
    try {
      const reader = response.body?.getReader?.();
      if (!reader) {
        const whole = Buffer.from(await response.arrayBuffer());
        if (!(await take(whole))) return `The download is larger than the ${expected} bytes in the pack list.`;
      } else {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!(await take(Buffer.from(value)))) {
              await reader.cancel().catch(() => {});
              return `The download is larger than the ${expected} bytes in the pack list.`;
            }
          }
        } finally {
          reader.releaseLock?.();
        }
      }
      await handle.close();
      closed = true;
      if (received !== expected) return `The download is ${received} bytes, and the pack list says ${expected}.`;
      // Read it back before the file is removed. A failed check below never restores it.
      return await readFile(tarPath);
    } finally {
      if (!closed) await handle.close().catch(() => {});
      await rm(tarPath, { force: true }).catch(() => {});
    }
  }

  async function installOne(id: string, onProgress?: (event: PackProgress) => void): Promise<InstallResult> {
    if (!isPackName(id)) return { ok: false, reason: `"${id}" is not a usable pack name.` };
    onProgress?.({ phase: "index", id });
    const loaded = await loadIndex(true);
    if (!loaded.ok) return loaded;
    const entry = loaded.index.packs.find((pack) => pack.id === id);
    if (!entry) return { ok: false, reason: `The pack list has no pack called "${id}".` };

    const dest = join(destDir, id);
    const info = await stat(dest).catch(() => null);
    if (info && !info.isDirectory()) return { ok: false, reason: `"${id}" is already there and is not a folder, so it was left as it is.` };
    const marker = info ? await readMarker(dest) : null;
    if (info && marker?.sha256 === entry.hashes.sha256 && marker.id === id) {
      onProgress?.({ phase: "done", id });
      return { ok: true, status: "already", id, dir: dest };
    }
    if (info && !marker) {
      onProgress?.({ phase: "done", id });
      return { ok: true, status: "present", id, dir: dest };
    }

    const body = await download(entry.url, entry.sizes.archiveBytes, id, onProgress);
    if (typeof body === "string") return { ok: false, reason: body };
    onProgress?.({ phase: "verify", id });
    if (sha256(body) !== entry.hashes.sha256) {
      return { ok: false, reason: "The download does not match the sha256 in the pack list, so it was not installed." };
    }

    const nonce = randomBytes(4).toString("hex");
    const staging = join(destDir, `.staging-${id}-${nonce}`);
    let placed = false;
    let backup: string | null = null;
    try {
      onProgress?.({ phase: "restore", id });
      const restored = await restorePackArchive(body, staging);
      if (!restored.ok) return { ok: false, reason: restored.reason };
      for (const required of ["credit.txt", "NOTICE.md"]) {
        if (!restored.files.includes(required)) return { ok: false, reason: `The pack has no ${required}, so it was not installed.` };
        const text = await readFile(join(staging, required), "utf8").catch(() => "");
        if (!text.trim()) return { ok: false, reason: `The pack's ${required} is empty, so it was not installed.` };
      }
      const note: Marker = { id, version: entry.version, sha256: entry.hashes.sha256 };
      await writeFile(join(staging, MARKER), `${JSON.stringify(note)}\n`);
      if (info && marker) {
        backup = join(destDir, `.old-${id}-${nonce}`);
        await rename(dest, backup);
      }
      await rename(staging, dest);
      placed = true;
      onProgress?.({ phase: "done", id });
      return { ok: true, status: "installed", id, dir: dest };
    } catch (err) {
      if (backup) await rename(backup, dest).catch(() => {});
      const detail = err instanceof Error ? err.message : "unknown error";
      return { ok: false, reason: `The pack could not be put in place (${detail}).` };
    } finally {
      if (!placed) await rm(staging, { recursive: true, force: true }).catch(() => {});
      if (placed && backup) await rm(backup, { recursive: true, force: true }).catch(() => {});
    }
  }

  return {
    loadIndex,
    index: () => cached,
    indexNote: () => (problem === "offline" ? problemReason : null),
    async installed(id) {
      if (!isPackName(id)) return null;
      const marker = await readMarker(join(destDir, id));
      return marker && marker.id === id ? { version: marker.version, sha256: marker.sha256 } : null;
    },
    async updateFor(id) {
      const entry = cached?.packs.find((pack) => pack.id === id);
      if (!entry || !isPackName(id)) return null;
      const marker = await readMarker(join(destDir, id));
      if (!marker || marker.id !== id || marker.sha256 === entry.hashes.sha256) return null;
      if (versionHigher(marker.version, entry.version)) return null; // what is here is newer than the list: never offer a step back
      return { id, installed: marker.version, available: entry.version, entry };
    },
    async updates() {
      const names = await readdir(destDir).catch(() => [] as string[]);
      const found: PackUpdate[] = [];
      for (const name of names.sort()) {
        if (name.startsWith(".")) continue;
        const update = await this.updateFor(name);
        if (update) found.push(update);
      }
      return found;
    },
    async find(id) {
      const loaded = await loadIndex(false);
      if (!loaded.ok) return null;
      return loaded.index.packs.find((pack) => pack.id === id) ?? null;
    },
    install(id, onProgress) {
      const running = inflight.get(id);
      if (running) return running;
      const job = installOne(id, onProgress).finally(() => inflight.delete(id));
      inflight.set(id, job);
      return job;
    },
    async thumbnail(id) {
      if (!isPackName(id)) return null;
      if (thumbsDir) {
        const shipped = await readOptional(join(thumbsDir, `${id}.webp`));
        if (shipped && shipped.length <= MAX_THUMB_BYTES && isWebp(shipped)) return shipped;
      }
      const cachedThumb = await readOptional(join(thumbCacheDir, `${id}.webp`));
      if (cachedThumb && cachedThumb.length <= MAX_THUMB_BYTES && isWebp(cachedThumb)) return cachedThumb;
      const entry = cached?.packs.find((pack) => pack.id === id);
      if (!entry?.thumbnail || !indexUrl) return null;
      const url = resolveThumbnail(indexUrl, entry.thumbnail);
      if (!url) return null;
      let response: PackFetchResponse;
      try {
        response = await fetchImpl(url, { signal: AbortSignal.timeout(THUMB_TIMEOUT_MS) });
      } catch {
        return null;
      }
      const finalUrl = response.url || url;
      if (!response.ok || !isRemoteUrl(finalUrl, { allowLoopbackHttp })) return null;
      let body: Buffer;
      try {
        body = Buffer.from(await response.arrayBuffer());
      } catch {
        return null;
      }
      if (body.length < 12 || body.length > MAX_THUMB_BYTES || !isWebp(body)) return null;
      await mkdir(thumbCacheDir, { recursive: true }).catch(() => {});
      const tmp = join(thumbCacheDir, `.${id}-${randomBytes(4).toString("hex")}.webp`);
      try {
        await writeFile(tmp, body);
        await rename(tmp, join(thumbCacheDir, `${id}.webp`));
      } catch {
        await rm(tmp, { force: true }).catch(() => {});
      }
      return body;
    },
  };
}

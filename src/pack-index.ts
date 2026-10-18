/**
 * `packs/index.json`: the list of picture packs that live outside the repository.
 * `src/pack-install.ts` downloads an entry's archive, checks `hashes.sha256` and the size, and
 * expands it into `data/frames/<id>/`. The schema that mirrors these checks is `packs/index.schema.json`.
 *
 * A download URL is whatever https address holds the archive. The one this project will publish is a
 * GitHub Release asset:
 *   https://github.com/<owner>/<repo>/releases/download/<tag>/<file>.tar
 * The same fields still work if the files move to another repository.
 *
 * `thumbnail` is an https URL, or a path `thumbs/<id>.webp` relative to the index (the same file as
 * `packs/thumbs/<id>.webp` in this repository). The gallery can show that preview before the pack is installed.
 */
import { isPackName } from "./frame-pack.ts";

export const PACK_INDEX_FORMAT = 1;

/** Every field a pack entry may have, required ones first. The schema test keeps `packs/index.schema.json` in step. */
export const PACK_INDEX_ENTRY_REQUIRED = ["id", "name", "version", "frameCount", "sizes", "hashes", "url"] as const;
export const PACK_INDEX_ENTRY_OPTIONAL = ["description", "thumbnail", "credit", "aiMade", "character"] as const;
export const PACK_INDEX_ENTRY_KEYS = [...PACK_INDEX_ENTRY_REQUIRED, ...PACK_INDEX_ENTRY_OPTIONAL] as const;

const SIZE_REQUIRED = ["width", "height", "archiveBytes"] as const;
const SIZE_OPTIONAL = ["framesBytes"] as const;
const HASH_KEYS = ["sha256"] as const;

const VERSION = /^[0-9]+(\.[0-9]+){0,2}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CHARACTER_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** A frame is at most this wide or tall, and an archive at most this big (GitHub's own asset limit is 2 GiB). */
const MAX_EDGE = 8192;
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_PACKS = 500;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 400;
const MAX_CREDIT = 300;
const MAX_URL = 2000;
const MAX_FRAMES = 120;

export interface PackIndexSizes {
  width: number;
  height: number;
  /** The patch archive, in bytes. */
  archiveBytes: number;
  /** The plain WebP frames the archive was built from, in bytes. Text files are not counted. */
  framesBytes?: number;
}

export interface PackIndexEntry {
  /** The folder name it installs as, under `data/frames/` and `packs/`. */
  id: string;
  /** The name shown in the gallery. */
  name: string;
  /** The pack's own version (`1`, `1.2`, `1.2.3`), not the app's. It changes when the archive bytes change. */
  version: string;
  description?: string;
  frameCount: number;
  sizes: PackIndexSizes;
  hashes: { sha256: string };
  /** https URL of the archive. A GitHub Release asset is the expected one. */
  url: string;
  thumbnail?: string;
  credit?: string;
  /** True when the pictures were made with an image model. */
  aiMade?: boolean;
  /** The character this outfit belongs to, so the gallery can show it in that character's row before it is downloaded. */
  character?: { id: string; name: string };
}

export interface PackIndex {
  format: typeof PACK_INDEX_FORMAT;
  packs: PackIndexEntry[];
}

export type PackIndexResult = { ok: true; index: PackIndex } | { ok: false; reason: string };

const fail = (reason: string): PackIndexResult => ({ ok: false, reason });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownKey(value: Record<string, unknown>, allowed: readonly string[]): string | null {
  return Object.keys(value).find((key) => !allowed.includes(key)) ?? null;
}

function plainText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** An https URL with a host and no user name or password buried in it. */
export function isDownloadUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_URL || /\s/.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.username === "" && url.password === "" && url.hostname.includes(".");
}

export interface PackIndexOptions {
  /**
   * Also accept `http://127.0.0.1` and `http://localhost`. The installer turns this on only when the
   * index itself was loaded from a loopback address, so a published https index cannot point at http.
   */
  allowLoopbackHttp?: boolean;
}

/** `http://127.0.0.1` or `http://localhost`, with no user name or password. */
export function isLoopbackHttp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_URL || /\s/.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname;
  return url.protocol === "http:" && url.username === "" && url.password === "" && (host === "127.0.0.1" || host === "localhost" || host === "::1");
}

/** An address the installer may fetch: https, or loopback http when the option says so. */
export function isRemoteUrl(value: unknown, options?: PackIndexOptions): value is string {
  return isDownloadUrl(value) || (options?.allowLoopbackHttp === true && isLoopbackHttp(value));
}

/** `thumbs/<id>.webp`, relative to the index file. No `..`, no scheme, one path segment. */
const RELATIVE_THUMB = /^thumbs\/[A-Za-z0-9][A-Za-z0-9 ._-]{0,60}\.webp$/;

/** A gallery preview: an https URL, or `thumbs/<id>.webp` next to the index. */
export function isThumbnailRef(value: unknown, options?: PackIndexOptions): value is string {
  if (isRemoteUrl(value, options)) return true;
  return typeof value === "string" && RELATIVE_THUMB.test(value) && !value.includes("..");
}

/**
 * The absolute URL of a thumbnail. A relative `thumbs/<id>.webp` is resolved against the index URL
 * (`…/index.json` + `thumbs/a.webp` is `…/thumbs/a.webp`). Anything that is not a fetchable address is null.
 */
export function resolveThumbnail(indexUrl: string, thumbnail: string): string | null {
  if (!isThumbnailRef(thumbnail, { allowLoopbackHttp: true })) return null;
  if (isDownloadUrl(thumbnail) || isLoopbackHttp(thumbnail)) return thumbnail;
  let resolved: string;
  try {
    resolved = new URL(thumbnail, indexUrl).href;
  } catch {
    return null;
  }
  return isRemoteUrl(resolved, { allowLoopbackHttp: isLoopbackHttp(indexUrl) }) ? resolved : null;
}

function parseEntry(value: unknown, index: number, options?: PackIndexOptions): PackIndexEntry | string {
  const where = `packs[${index}]`;
  if (!isRecord(value)) return `${where} must be an object.`;
  const extra = unknownKey(value, PACK_INDEX_ENTRY_KEYS);
  if (extra) return `${where}.${extra} is not a field of the index.`;
  for (const key of PACK_INDEX_ENTRY_REQUIRED) if (!(key in value)) return `${where} needs ${key}.`;

  if (typeof value.id !== "string" || !isPackName(value.id)) return `${where}.id must be a pack folder name (letters, digits, space, . _ -).`;
  if (!plainText(value.name, MAX_NAME)) return `${where}.name must be 1 to ${MAX_NAME} characters.`;
  if (typeof value.version !== "string" || !VERSION.test(value.version)) return `${where}.version must look like 1 or 1.2.3.`;
  if (!integer(value.frameCount, 1, MAX_FRAMES)) return `${where}.frameCount must be a whole number from 1 to ${MAX_FRAMES}.`;
  if (!isRemoteUrl(value.url, options)) return `${where}.url must be an https address, with no password in it.`;

  if (!isRecord(value.sizes)) return `${where}.sizes must be an object.`;
  const extraSize = unknownKey(value.sizes, [...SIZE_REQUIRED, ...SIZE_OPTIONAL]);
  if (extraSize) return `${where}.sizes.${extraSize} is not a field of the index.`;
  for (const key of SIZE_REQUIRED) if (!(key in value.sizes)) return `${where}.sizes needs ${key}.`;
  if (!integer(value.sizes.width, 1, MAX_EDGE) || !integer(value.sizes.height, 1, MAX_EDGE)) {
    return `${where}.sizes width and height must be whole numbers of pixels.`;
  }
  if (!integer(value.sizes.archiveBytes, 1, MAX_BYTES)) return `${where}.sizes.archiveBytes must be the archive's size in bytes.`;
  if ("framesBytes" in value.sizes && !integer(value.sizes.framesBytes, 1, MAX_BYTES)) {
    return `${where}.sizes.framesBytes must be the plain frames' size in bytes.`;
  }

  if (!isRecord(value.hashes)) return `${where}.hashes must be an object.`;
  const extraHash = unknownKey(value.hashes, HASH_KEYS);
  if (extraHash) return `${where}.hashes.${extraHash} is not a field of the index.`;
  if (typeof value.hashes.sha256 !== "string" || !SHA256.test(value.hashes.sha256)) {
    return `${where}.hashes.sha256 must be 64 lowercase hex characters.`;
  }

  if ("description" in value && !plainText(value.description, MAX_DESCRIPTION)) return `${where}.description must be 1 to ${MAX_DESCRIPTION} characters.`;
  if ("thumbnail" in value && !isThumbnailRef(value.thumbnail, options)) {
    return `${where}.thumbnail must be an https address or a thumbs/<id>.webp path.`;
  }
  if ("credit" in value && !plainText(value.credit, MAX_CREDIT)) return `${where}.credit must be 1 to ${MAX_CREDIT} characters.`;
  if ("aiMade" in value && typeof value.aiMade !== "boolean") return `${where}.aiMade must be true or false.`;
  if ("character" in value) {
    const c = value.character;
    if (!isRecord(c) || unknownKey(c, ["id", "name"]) || typeof c.id !== "string" || !CHARACTER_ID.test(c.id) || !plainText(c.name, 60)) {
      return `${where}.character must be { "id": "franzi", "name": "Franzi" } (a lowercase id of letters, digits and dashes, and a name).`;
    }
  }

  const sizes: PackIndexSizes = { width: value.sizes.width, height: value.sizes.height, archiveBytes: value.sizes.archiveBytes };
  if ("framesBytes" in value.sizes && typeof value.sizes.framesBytes === "number") sizes.framesBytes = value.sizes.framesBytes;
  const entry: PackIndexEntry = {
    id: value.id,
    name: value.name,
    version: value.version,
    frameCount: value.frameCount,
    sizes,
    hashes: { sha256: value.hashes.sha256 },
    url: value.url,
  };
  if (typeof value.description === "string") entry.description = value.description;
  if (typeof value.thumbnail === "string") entry.thumbnail = value.thumbnail;
  if (typeof value.credit === "string") entry.credit = value.credit;
  if (typeof value.aiMade === "boolean") entry.aiMade = value.aiMade;
  if (isRecord(value.character)) entry.character = { id: String(value.character.id), name: String(value.character.name) };
  return entry;
}

/** Checks a parsed `packs/index.json`. Never throws. */
export function parsePackIndex(value: unknown, options?: PackIndexOptions): PackIndexResult {
  if (!isRecord(value)) return fail("The index must be a JSON object.");
  const extra = unknownKey(value, ["format", "packs"]);
  if (extra) return fail(`${extra} is not a field of the index.`);
  if (value.format !== PACK_INDEX_FORMAT) return fail(`The index format must be ${PACK_INDEX_FORMAT}.`);
  if (!Array.isArray(value.packs)) return fail("The index needs a packs list.");
  if (value.packs.length > MAX_PACKS) return fail(`The index lists more than ${MAX_PACKS} packs.`);
  const packs: PackIndexEntry[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < value.packs.length; i++) {
    const entry = parseEntry(value.packs[i], i, options);
    if (typeof entry === "string") return fail(entry);
    if (seen.has(entry.id)) return fail(`The index lists "${entry.id}" twice.`);
    seen.add(entry.id);
    packs.push(entry);
  }
  return { ok: true, index: { format: PACK_INDEX_FORMAT, packs } };
}

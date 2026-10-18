/**
 * A patch archive of a picture pack.
 *
 * The pictures the app shows stay ordinary files in a folder (`readPack` is unchanged). This module
 * packs that folder for download, and the installer (`src/pack-install.ts`) unpacks it into `data/frames/<id>/`.
 *
 * Stored whole, byte for byte:
 *   the emotion rest frames (`neutral.webp`, `happy.webp`, ...),
 *   the pose frames (`wave-1.webp`, `cheer-2.webp`, ...),
 *   `credit.txt`, `NOTICE.md`, `PROCESS.md` and `look.txt` when the folder has them.
 * Stored as a patch, over that emotion's rest frame:
 *   `<emotion>-blink.webp` and `<emotion>-talkN.webp`.
 * A patch is the smallest rectangle that differs, cut from the variant as RGBA, encoded as a lossless WebP
 * (`exact`, so transparent pixels keep their colour), plus the rectangle's origin. `manifest.json` records it.
 *
 * Restoring copies the whole files back unchanged. A patched frame is painted back onto its rest frame and
 * written as a new lossless WebP: the pixels match, the file bytes usually do not.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve, join, sep } from "node:path";
import { GESTURES } from "../public/frames.js";
import { isPackName, MAX_FRAME_BYTES } from "./frame-pack.ts";
import { type PackIndexEntry, parsePackIndex } from "./pack-index.ts";
import { readTar, writeTar } from "./tar-store.ts";
import { decodeRgba, encodeRgba, isLosslessWebp, type RgbaImage } from "./webp-rgba.ts";

export const ARCHIVE_FORMAT = 1;
const TEXT_FILES = ["NOTICE.md", "PROCESS.md", "credit.txt", "look.txt"] as const;
const TEXT_SET = new Set<string>(TEXT_FILES);
const MAX_TEXT_BYTES = 64 * 1024;

/** The same shapes `readPack` uses, limited to WebP: a patch archive is built from lossless WebP only. */
const POSE_FILE = /^([a-z][a-z0-9_]*)-(\d{1,2})\.webp$/i;
const FRAME_FILE = /^([a-z][a-z0-9_]*)(?:-(blink)|-talk(\d{1,2}))?\.webp$/i;

export interface PatchBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArchiveFileReport {
  name: string;
  kind: "base" | "patch" | "text";
  sourceBytes: number;
  storedBytes: number;
  base?: string;
  box?: PatchBox;
}

export interface ArchiveReport {
  id: string;
  width: number;
  height: number;
  frameCount: number;
  baseCount: number;
  patchCount: number;
  textCount: number;
  /** Plain WebP frames, before patching. */
  framesBytes: number;
  /** Frames plus the text files. */
  sourceBytes: number;
  archiveBytes: number;
  baseBytes: number;
  patchBytes: number;
  textBytes: number;
  files: ArchiveFileReport[];
}

interface ManifestBase {
  name: string;
  kind: "base";
  sha256: string;
  sourceBytes: number;
}
interface ManifestPatch {
  name: string;
  kind: "patch";
  base: string;
  x: number;
  y: number;
  width: number;
  height: number;
  sha256?: string;
  sourceBytes: number;
}
interface ManifestText {
  name: string;
  kind: "text";
  sha256: string;
  sourceBytes: number;
}
type ManifestFile = ManifestBase | ManifestPatch | ManifestText;

interface Manifest {
  format: typeof ARCHIVE_FORMAT;
  id: string;
  width: number;
  height: number;
  files: ManifestFile[];
}

export type ArchiveBuild = { ok: true; archive: Buffer; report: ArchiveReport } | { ok: false; reason: string };
export type ArchiveInspect = { ok: true; report: ArchiveReport } | { ok: false; reason: string };
export type ArchiveRestore = { ok: true; files: string[] } | { ok: false; reason: string };

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

function changedBox(base: Buffer, variant: Buffer, width: number, height: number): PatchBox {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      if (base[i] !== variant[i] || base[i + 1] !== variant[i + 1] || base[i + 2] !== variant[i + 2] || base[i + 3] !== variant[i + 3]) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function crop(image: Buffer, width: number, box: PatchBox): Buffer {
  const out = Buffer.alloc(box.width * box.height * 4);
  for (let y = 0; y < box.height; y++) {
    const from = ((box.y + y) * width + box.x) * 4;
    image.copy(out, y * box.width * 4, from, from + box.width * 4);
  }
  return out;
}

function blit(base: Buffer, width: number, patch: Buffer, box: PatchBox): Buffer {
  const out = Buffer.from(base);
  for (let y = 0; y < box.height; y++) {
    const to = ((box.y + y) * width + box.x) * 4;
    patch.copy(out, to, y * box.width * 4, (y + 1) * box.width * 4);
  }
  return out;
}

type Classified =
  | { name: string; bytes: Buffer; role: "base" }
  | { name: string; bytes: Buffer; role: "patch"; base: string }
  | { name: string; bytes: Buffer; role: "text" };

/** Splits a pack folder into rest frames, patches and text. Dotfiles are skipped, as they are when a pack is shown. */
function classify(names: { name: string; bytes: Buffer }[], emotions: string[]): Classified[] | string {
  const emotionSet = new Set(emotions);
  const out: Classified[] = [];
  for (const file of names) {
    if (file.name.startsWith(".")) continue;
    if (TEXT_SET.has(file.name)) {
      if (file.bytes.length > MAX_TEXT_BYTES) return `${file.name} is larger than ${MAX_TEXT_BYTES / 1024} KB.`;
      out.push({ name: file.name, bytes: file.bytes, role: "text" });
      continue;
    }
    if (/\.(png|jpe?g)$/i.test(file.name)) return `${file.name} is not WebP. A patch archive is built from lossless WebP frames.`;
    const pose = POSE_FILE.exec(file.name);
    const gesture = pose?.[1].toLowerCase();
    if (pose && gesture && gesture in GESTURES) {
      out.push({ name: file.name, bytes: file.bytes, role: "base" });
      continue;
    }
    const frame = FRAME_FILE.exec(file.name);
    const emotion = frame?.[1].toLowerCase();
    if (!frame || !emotion || !emotionSet.has(emotion)) {
      return `${file.name} is not a frame (<emotion>[-blink|-talkN].webp), a pose (<gesture>-N.webp), or credit.txt / NOTICE.md / PROCESS.md / look.txt.`;
    }
    if (frame[2] || frame[3]) out.push({ name: file.name, bytes: file.bytes, role: "patch", base: `${emotion}.webp` });
    else out.push({ name: file.name, bytes: file.bytes, role: "base" });
  }
  return out;
}

const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

function whole(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** The manifest is data from a file we may have downloaded, so every field is checked before it is trusted. */
function manifestOf(files: Map<string, Buffer>): Manifest | string {
  const raw = files.get("manifest.json");
  if (!raw) return "The archive has no manifest.json.";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return "manifest.json is not JSON.";
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "manifest.json must be an object.";
  const body = parsed as Record<string, unknown>;
  if (body.format !== ARCHIVE_FORMAT) return `This archive's format is not ${ARCHIVE_FORMAT}.`;
  if (typeof body.id !== "string" || !isPackName(body.id)) return "The archive's id is not a pack folder name.";
  if (!whole(body.width) || !whole(body.height) || body.width < 1 || body.height < 1 || body.width > 8192 || body.height > 8192) {
    return "The archive does not say how big its frames are.";
  }
  if (!Array.isArray(body.files)) return "The archive manifest has no file list.";
  const list: ManifestFile[] = [];
  const names = new Set<string>();
  for (const item of body.files) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return "A manifest entry must be an object.";
    const file = item as Record<string, unknown>;
    if (typeof file.name !== "string" || !SAFE_FILE.test(file.name)) return "A manifest entry names a file that is not a plain file name.";
    if (names.has(file.name)) return `The archive lists ${file.name} twice.`;
    names.add(file.name);
    if (!whole(file.sourceBytes) || file.sourceBytes < 0) return `${file.name} has no source size.`;
    if (file.kind === "base" || file.kind === "text") {
      if (file.kind === "text" && !TEXT_SET.has(file.name)) return `${file.name} is not a text file a pack archive carries.`;
      if (typeof file.sha256 !== "string" || !SHA256_HEX.test(file.sha256)) return `${file.name} has no sha256.`;
      list.push({ name: file.name, kind: file.kind, sha256: file.sha256, sourceBytes: file.sourceBytes });
      continue;
    }
    if (file.kind !== "patch") return `${file.name} is neither a base frame, a patch, nor a text file.`;
    if (typeof file.base !== "string" || !SAFE_FILE.test(file.base)) return `${file.name} does not name the frame it patches.`;
    if (!whole(file.x) || !whole(file.y) || !whole(file.width) || !whole(file.height)) return `${file.name} has no rectangle.`;
    const empty = file.width === 0 && file.height === 0;
    if (!empty && (file.width < 1 || file.height < 1)) return `${file.name} has an empty edge but not an empty rectangle.`;
    if (file.x < 0 || file.y < 0 || file.x + file.width > body.width || file.y + file.height > body.height) {
      return `${file.name} names a rectangle outside its frame.`;
    }
    const patch: ManifestPatch = { name: file.name, kind: "patch", base: file.base, x: file.x, y: file.y, width: file.width, height: file.height, sourceBytes: file.sourceBytes };
    if (!empty) {
      if (typeof file.sha256 !== "string" || !SHA256_HEX.test(file.sha256)) return `${file.name} has no sha256.`;
      patch.sha256 = file.sha256;
    }
    list.push(patch);
  }
  if (!list.some((file) => file.kind === "base" && /^neutral\.webp$/i.test(file.name))) return "The archive has no neutral.webp.";
  for (const file of list) {
    if (file.kind === "patch" && !list.some((base) => base.kind === "base" && base.name === file.base)) {
      return `${file.name} patches ${file.base}, which is not a base frame.`;
    }
  }
  return { format: ARCHIVE_FORMAT, id: body.id, width: body.width, height: body.height, files: list };
}

function reportFrom(manifest: Manifest, stored: Map<string, number>, archiveBytes: number): ArchiveReport | string {
  const files: ArchiveFileReport[] = [];
  let framesBytes = 0;
  let baseBytes = 0;
  let patchBytes = 0;
  let textBytes = 0;
  let baseCount = 0;
  let patchCount = 0;
  let textCount = 0;
  for (const file of manifest.files) {
    const storedBytes = file.kind === "patch" && file.width === 0 ? 0 : (stored.get(storedName(file)) ?? -1);
    if (storedBytes < 0) return `The archive is missing ${file.name}.`;
    if (file.kind === "base") {
      baseCount += 1;
      baseBytes += storedBytes;
      framesBytes += file.sourceBytes;
    } else if (file.kind === "patch") {
      patchCount += 1;
      patchBytes += storedBytes;
      framesBytes += file.sourceBytes;
    } else {
      textCount += 1;
      textBytes += storedBytes;
    }
    const row: ArchiveFileReport = { name: file.name, kind: file.kind, sourceBytes: file.sourceBytes, storedBytes };
    if (file.kind === "patch") {
      row.base = file.base;
      row.box = { x: file.x, y: file.y, width: file.width, height: file.height };
    }
    files.push(row);
  }
  return {
    id: manifest.id,
    width: manifest.width,
    height: manifest.height,
    frameCount: baseCount + patchCount,
    baseCount,
    patchCount,
    textCount,
    framesBytes,
    sourceBytes: framesBytes + manifest.files.filter((file) => file.kind === "text").reduce((sum, file) => sum + file.sourceBytes, 0),
    archiveBytes,
    baseBytes,
    patchBytes,
    textBytes,
    files,
  };
}

function storedName(file: ManifestFile): string {
  if (file.kind === "base") return `base/${file.name}`;
  if (file.kind === "text") return `text/${file.name}`;
  return `patch/${file.name}`;
}

/** Reads an archive and reports how it compares with the plain frames it was built from. Does not decode pictures. */
export function inspectPackArchive(archive: Buffer): ArchiveInspect {
  const tar = readTar(archive);
  if (!tar.ok) return tar;
  const manifest = manifestOf(tar.files);
  if (typeof manifest === "string") return { ok: false, reason: manifest };
  const stored = new Map<string, number>();
  for (const [name, bytes] of tar.files) if (name !== "manifest.json") stored.set(name, bytes.length);
  const report = reportFrom(manifest, stored, archive.length);
  if (typeof report === "string") return { ok: false, reason: report };
  return { ok: true, report };
}

/**
 * Builds a patch archive from a pack folder. `emotions` is the emotion list (the keys of `emotions.json`):
 * a frame whose name is not one of those, and not a wave or cheer pose, is refused rather than dropped.
 */
export async function buildPackArchive(folder: string, opts: { id?: string; emotions: string[] }): Promise<ArchiveBuild> {
  const id = opts.id ?? folder.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "";
  if (!isPackName(id)) return { ok: false, reason: `"${id}" is not a usable pack name.` };
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => null);
  if (!entries) return { ok: false, reason: `There is no folder at ${folder}.` };
  const loaded: { name: string; bytes: Buffer }[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isFile()) return { ok: false, reason: `${entry.name} is not a file. A pack archive is a flat folder.` };
    const bytes = await readFile(join(folder, entry.name));
    if (bytes.length > MAX_FRAME_BYTES) return { ok: false, reason: `${entry.name} is larger than ${MAX_FRAME_BYTES / 1024 / 1024} MB.` };
    loaded.push({ name: entry.name, bytes });
  }
  const classified = classify(loaded, opts.emotions);
  if (typeof classified === "string") return { ok: false, reason: classified };
  if (!classified.some((file) => file.name === "credit.txt") || !classified.some((file) => file.name === "NOTICE.md")) {
    return { ok: false, reason: "A pack archive needs credit.txt and NOTICE.md, so the credit and the terms travel with the pictures." };
  }
  const baseFiles = classified.filter((file): file is Classified & { role: "base" } => file.role === "base");
  const patchFiles = classified.filter((file): file is Classified & { role: "patch"; base: string } => file.role === "patch");
  const textFiles = classified.filter((file): file is Classified & { role: "text" } => file.role === "text");
  const bases = new Map(baseFiles.map((file) => [file.name.toLowerCase(), file]));
  const neutral = baseFiles.find((file) => /^neutral\.webp$/i.test(file.name));
  if (!neutral) return { ok: false, reason: "The pack needs a neutral.webp (her face at rest)." };

  const decoded = new Map<string, RgbaImage>();
  for (const file of classified) {
    if (file.role === "text") continue;
    if (!isLosslessWebp(file.bytes)) return { ok: false, reason: `${file.name} is not a lossless WebP.` };
    const image = await decodeRgba(file.bytes);
    if (!image) return { ok: false, reason: `${file.name} could not be read as a WebP picture.` };
    decoded.set(file.name, image);
  }
  const size = decoded.get(neutral.name)!;
  for (const [name, image] of decoded) {
    if (image.width !== size.width || image.height !== size.height) {
      return { ok: false, reason: `${name} is ${image.width}×${image.height}, and neutral.webp is ${size.width}×${size.height}. Every frame has to be the same size.` };
    }
  }

  const manifestFiles: ManifestFile[] = [];
  const tarFiles: { name: string; data: Buffer }[] = [];
  for (const file of baseFiles.sort((a, b) => a.name.localeCompare(b.name))) {
    manifestFiles.push({ name: file.name, kind: "base", sha256: sha256(file.bytes), sourceBytes: file.bytes.length });
    tarFiles.push({ name: `base/${file.name}`, data: file.bytes });
  }
  for (const file of patchFiles.sort((a, b) => a.name.localeCompare(b.name))) {
    const baseName = bases.get(file.base)?.name;
    const baseImage = baseName ? decoded.get(baseName) : undefined;
    const variant = decoded.get(file.name);
    if (!baseName || !baseImage || !variant) return { ok: false, reason: `${file.name} has no ${file.base} to patch against.` };
    const box = changedBox(baseImage.data, variant.data, size.width, size.height);
    const entry: ManifestPatch = { name: file.name, kind: "patch", base: baseName, x: box.x, y: box.y, width: box.width, height: box.height, sourceBytes: file.bytes.length };
    if (box.width > 0) {
      const encoded = await encodeRgba({ width: box.width, height: box.height, data: crop(variant.data, size.width, box) });
      if (!encoded) return { ok: false, reason: `${file.name} could not be stored as a lossless WebP patch.` };
      entry.sha256 = sha256(encoded);
      tarFiles.push({ name: `patch/${file.name}`, data: encoded });
    }
    manifestFiles.push(entry);
  }
  for (const file of textFiles.sort((a, b) => a.name.localeCompare(b.name))) {
    manifestFiles.push({ name: file.name, kind: "text", sha256: sha256(file.bytes), sourceBytes: file.bytes.length });
    tarFiles.push({ name: `text/${file.name}`, data: file.bytes });
  }
  manifestFiles.sort((a, b) => a.name.localeCompare(b.name));
  const manifest: Manifest = { format: ARCHIVE_FORMAT, id, width: size.width, height: size.height, files: manifestFiles };
  tarFiles.push({ name: "manifest.json", data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8") });
  tarFiles.sort((a, b) => a.name.localeCompare(b.name));
  const written = writeTar(tarFiles);
  if (!written.ok) return written;
  const inspected = inspectPackArchive(written.archive);
  if (!inspected.ok) return inspected;
  return { ok: true, archive: written.archive, report: inspected.report };
}

function insideDest(dest: string, name: string): string | null {
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") return null;
  const file = resolve(dest, name);
  const rel = relative(resolve(dest), file);
  if (rel.startsWith("..") || rel.includes(`..${sep}`) || rel.startsWith("/") || rel === "") return null;
  return file;
}

/**
 * Rebuilds the pack folder from an archive. Whole files come back byte for byte. A patched frame comes back
 * with the same pixels as the frame it was built from, written as a new lossless WebP. Nothing is written
 * until the archive has been checked.
 */
export async function restorePackArchive(archive: Buffer, dest: string): Promise<ArchiveRestore> {
  const tar = readTar(archive);
  if (!tar.ok) return tar;
  const manifest = manifestOf(tar.files);
  if (typeof manifest === "string") return { ok: false, reason: manifest };
  const expected = new Set<string>(["manifest.json"]);
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (seen.has(file.name)) return { ok: false, reason: `The archive lists ${file.name} twice.` };
    seen.add(file.name);
    if (file.kind === "patch" && file.width === 0 && file.height === 0) continue;
    expected.add(storedName(file));
  }
  for (const name of tar.files.keys()) {
    if (!expected.has(name)) return { ok: false, reason: `The archive has ${name}, which its manifest does not list.` };
  }
  for (const name of expected) {
    if (!tar.files.has(name)) return { ok: false, reason: `The archive is missing ${name}.` };
  }

  const bases = new Map<string, Buffer>();
  const outputs = new Map<string, Buffer>();
  for (const file of manifest.files) {
    if (file.kind !== "base" && file.kind !== "text") continue;
    const bytes = tar.files.get(storedName(file))!;
    if (sha256(bytes) !== file.sha256) return { ok: false, reason: `${file.name} does not match the hash in the manifest.` };
    if (file.kind === "base") bases.set(file.name, bytes);
    outputs.set(file.name, bytes);
  }

  const basePixels = new Map<string, RgbaImage>();
  for (const [name, bytes] of bases) {
    const image = await decodeRgba(bytes);
    if (!image) return { ok: false, reason: `${name} could not be read as a WebP picture.` };
    if (image.width !== manifest.width || image.height !== manifest.height) return { ok: false, reason: `${name} is not ${manifest.width}×${manifest.height}.` };
    basePixels.set(name, image);
  }

  for (const file of manifest.files) {
    if (file.kind !== "patch") continue;
    const base = basePixels.get(file.base);
    if (!base) return { ok: false, reason: `${file.name} patches ${file.base}, which is not a base frame.` };
    if (file.width < 0 || file.height < 0 || file.x < 0 || file.y < 0 || file.x + file.width > manifest.width || file.y + file.height > manifest.height) {
      return { ok: false, reason: `${file.name} names a rectangle outside ${file.base}.` };
    }
    let pixels = base.data;
    if (file.width > 0) {
      const stored = tar.files.get(storedName(file));
      if (!stored || !file.sha256 || sha256(stored) !== file.sha256) return { ok: false, reason: `${file.name} does not match the hash in the manifest.` };
      const patch = await decodeRgba(stored);
      if (!patch || patch.width !== file.width || patch.height !== file.height) {
        return { ok: false, reason: `${file.name} is not the ${file.width}×${file.height} patch the manifest describes.` };
      }
      pixels = blit(base.data, manifest.width, patch.data, file);
    }
    const encoded = await encodeRgba({ width: manifest.width, height: manifest.height, data: pixels });
    if (!encoded) return { ok: false, reason: `${file.name} could not be restored as a lossless WebP.` };
    if (encoded.length > MAX_FRAME_BYTES) return { ok: false, reason: `${file.name} restored larger than ${MAX_FRAME_BYTES / 1024 / 1024} MB.` };
    outputs.set(file.name, encoded);
  }

  await mkdir(dest, { recursive: true });
  const written: string[] = [];
  for (const [name, bytes] of [...outputs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const path = insideDest(dest, name);
    if (!path) return { ok: false, reason: `"${name}" is not a safe file name.` };
    await writeFile(path, bytes);
    written.push(name);
  }
  return { ok: true, files: written };
}

const formatBytes = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : n >= 1000 ? `${(n / 1000).toFixed(1)} KB` : `${n} B`);

/** The size report printed by the build tool. */
export function formatReport(report: ArchiveReport): string {
  const ratio = report.archiveBytes > 0 ? (report.framesBytes / report.archiveBytes).toFixed(1) : "0";
  const lines = [
    `${report.id}: ${report.frameCount} frames, ${report.width}×${report.height}. Plain frames ${formatBytes(report.framesBytes)}, archive ${formatBytes(report.archiveBytes)} (${ratio}× smaller).`,
    `  ${report.baseCount} base frames stored whole (${formatBytes(report.baseBytes)})`,
    `  ${report.patchCount} patches (${formatBytes(report.patchBytes)})`,
    `  ${report.textCount} text files (${formatBytes(report.textBytes)})`,
  ];
  for (const file of report.files) {
    if (file.kind === "patch" && file.box && file.base) {
      const box = file.box.width === 0 ? "no pixels differ" : `box ${file.box.x},${file.box.y} ${file.box.width}×${file.box.height}`;
      lines.push(`  ${file.name}  patch of ${file.base}  ${box}  ${file.sourceBytes} → ${file.storedBytes} bytes`);
    } else {
      lines.push(`  ${file.name}  ${file.kind}  ${file.sourceBytes} bytes`);
    }
  }
  return lines.join("\n");
}

export interface IndexEntryMeta {
  name: string;
  version: string;
  url: string;
  description?: string;
  thumbnail?: string;
  credit?: string;
  aiMade?: boolean;
}

/** One `packs/index.json` entry for an archive that was just built. Refuses a meta value the index would refuse. */
export function indexEntryForArchive(archive: Buffer, meta: IndexEntryMeta): { ok: true; entry: PackIndexEntry } | { ok: false; reason: string } {
  const inspected = inspectPackArchive(archive);
  if (!inspected.ok) return inspected;
  const { report } = inspected;
  const entry: PackIndexEntry = {
    id: report.id,
    name: meta.name,
    version: meta.version,
    frameCount: report.frameCount,
    sizes: { width: report.width, height: report.height, archiveBytes: archive.length, framesBytes: report.framesBytes },
    hashes: { sha256: sha256(archive) },
    url: meta.url,
  };
  if (meta.description) entry.description = meta.description;
  if (meta.thumbnail) entry.thumbnail = meta.thumbnail;
  if (meta.credit) entry.credit = meta.credit;
  if (meta.aiMade !== undefined) entry.aiMade = meta.aiMade;
  const parsed = parsePackIndex({ format: 1, packs: [entry] });
  if (!parsed.ok) return parsed;
  return { ok: true, entry: parsed.index.packs[0] };
}

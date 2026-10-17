/**
 * A tiny ustar reader and writer. Pack archives are uncompressed tars so a normal `tar` can list them,
 * and so this file is the only code that has to understand the container. Names are kept short on purpose
 * (one path segment under `base/`, `patch/` or `text/`, or `manifest.json`), which fits the 100-byte name field.
 * Timestamps and owners are always zero, so the same files come out as the same bytes.
 */

const BLOCK = 512;
/** Big enough for a patched pack, far under the 2 GiB GitHub Release asset limit. */
export const MAX_TAR_BYTES = 80 * 1024 * 1024;
const MAX_ENTRIES = 200;
const MAX_NAME = 100;

export type TarRead = { ok: true; files: Map<string, Buffer> } | { ok: false; reason: string };
export type TarWrite = { ok: true; archive: Buffer } | { ok: false; reason: string };

/** A name that stays inside the archive: no absolute path, no `..`, no backslash, no empty segment. */
export function isSafeTarName(name: string): boolean {
  if (!name || name.length > MAX_NAME || name.includes("\0") || name.includes("\\") || name.startsWith("/")) return false;
  return name.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function octal(value: number, length: number): Buffer {
  const field = Buffer.alloc(length);
  field.write(value.toString(8).padStart(length - 1, "0"), 0, "ascii");
  return field;
}

function readOctal(header: Buffer, offset: number, length: number): number | null {
  const text = header.toString("ascii", offset, offset + length).replace(/\0[\s\S]*$/, "").trim();
  if (!/^[0-7]+$/.test(text)) return null;
  return parseInt(text, 8);
}

function headerChecksum(header: Buffer): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i];
  return sum;
}

function isZeroBlock(header: Buffer): boolean {
  for (let i = 0; i < BLOCK; i++) if (header[i] !== 0) return false;
  return true;
}

/** Packs `files` into one ustar archive. The caller gives safe names; this checks them again. */
export function writeTar(files: { name: string; data: Buffer }[]): TarWrite {
  if (files.length > MAX_ENTRIES) return { ok: false, reason: `An archive cannot hold more than ${MAX_ENTRIES} files.` };
  const parts: Buffer[] = [];
  let total = 0;
  for (const file of files) {
    if (!isSafeTarName(file.name)) return { ok: false, reason: `"${file.name}" is not a safe archive name.` };
    if (file.data.length > MAX_TAR_BYTES) return { ok: false, reason: `${file.name} is too large to store.` };
    const header = Buffer.alloc(BLOCK);
    header.write(file.name, 0, "ascii");
    octal(0o644, 8).copy(header, 100);
    octal(0, 8).copy(header, 108);
    octal(0, 8).copy(header, 116);
    octal(file.data.length, 12).copy(header, 124);
    octal(0, 12).copy(header, 136);
    header.fill(0x20, 148, 156);
    header[156] = 0x30; // a regular file
    header.write("ustar\0", 257, "ascii");
    header.write("00", 263, "ascii");
    const sum = headerChecksum(header);
    header.write(sum.toString(8).padStart(6, "0"), 148, "ascii");
    header[154] = 0;
    header[155] = 0x20;
    const pad = (BLOCK - (file.data.length % BLOCK)) % BLOCK;
    total += BLOCK + file.data.length + pad;
    if (total > MAX_TAR_BYTES) return { ok: false, reason: "The archive would be larger than 80 MB." };
    parts.push(header, file.data);
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return { ok: true, archive: Buffer.concat(parts) };
}

/** Reads an uncompressed ustar archive. Refuses links, absolute paths and `..`. */
export function readTar(archive: Buffer): TarRead {
  if (archive.length > MAX_TAR_BYTES) return { ok: false, reason: "The archive is larger than 80 MB." };
  if (archive.length < BLOCK * 2 || archive.length % BLOCK !== 0) return { ok: false, reason: "This is not a tar archive." };
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK);
    offset += BLOCK;
    if (isZeroBlock(header)) return { ok: true, files };
    const stored = readOctal(header, 148, 8);
    if (stored === null || stored !== headerChecksum(header)) return { ok: false, reason: "The archive header is damaged." };
    const size = readOctal(header, 124, 12);
    if (size === null) return { ok: false, reason: "The archive header is damaged." };
    const type = String.fromCharCode(header[156]);
    const name = header.toString("ascii", 0, MAX_NAME).replace(/\0[\s\S]*$/, "");
    const dataEnd = offset + size;
    if (dataEnd > archive.length) return { ok: false, reason: "The archive ended early." };
    const data = Buffer.from(archive.subarray(offset, dataEnd));
    offset += size + ((BLOCK - (size % BLOCK)) % BLOCK);
    // A directory, or a pax header. Pax is not applied: it must not be able to rename the entry that follows.
    if (type === "5" || type === "g" || type === "x") continue;
    if (type !== "0" && type !== "\0") return { ok: false, reason: "The archive contains a link or another special entry, which is refused." };
    if (!isSafeTarName(name)) return { ok: false, reason: `The archive names "${name}", which is not a safe path.` };
    if (files.has(name)) return { ok: false, reason: `The archive lists ${name} twice.` };
    if (files.size >= MAX_ENTRIES) return { ok: false, reason: `An archive cannot hold more than ${MAX_ENTRIES} files.` };
    files.set(name, data);
  }
  return { ok: false, reason: "The archive has no end marker." };
}

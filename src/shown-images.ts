import { open, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, sep } from "node:path";
import { sniffImageType, type ImageType } from "./images.ts";

/**
 * Pictures she shows in the chat with `[image path]`. The path comes from the model, so it is
 * treated like anything else it chooses: it must resolve (symlinks included) to a real image file
 * inside the folder she works in, and the bytes must be the kind of image the name says.
 */

export const MAX_SHOWN_BYTES = 10 * 1024 * 1024;

const extensions: Record<string, ImageType> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export interface ShownImage {
  /** The real path on disk, symlinks resolved. */
  path: string;
  /** The folder it had to be inside, as it was when she showed it. */
  root: string;
  name: string;
  mime: ImageType;
}

export async function checkShownImage(requested: string, root: string): Promise<ShownImage | { error: string }> {
  const extension = /\.[A-Za-z0-9]+$/.exec(requested)?.[0].toLowerCase() ?? "";
  if (!extensions[extension]) return { error: `${requested}: only PNG, JPEG, GIF and WebP files can be shown` };
  let realRoot: string;
  let real: string;
  try {
    realRoot = await realpath(root);
    real = await realpath(isAbsolute(requested) ? requested : join(realRoot, requested));
  } catch {
    return { error: `${requested}: no such file in the project folder` };
  }
  if (real !== realRoot && !real.startsWith(realRoot + sep)) return { error: `${requested}: outside the project folder` };
  const info = await stat(real);
  if (!info.isFile()) return { error: `${requested}: not a file` };
  if (info.size > MAX_SHOWN_BYTES) return { error: `${requested}: larger than ${MAX_SHOWN_BYTES / 1024 / 1024} MB` };
  const head = Buffer.alloc(16);
  const file = await open(real, "r");
  try {
    await file.read(head, 0, 16, 0);
  } finally {
    await file.close();
  }
  const mime = sniffImageType(head);
  if (!mime || mime !== extensions[extension]) return { error: `${requested}: not a real ${extension.slice(1).toUpperCase()} image` };
  return { path: real, root: realRoot, name: basename(real), mime };
}

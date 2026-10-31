import { veryBlurryChance } from "./blur.ts";
import type { ImageBackend } from "./backend.ts";
import { checkBackground, checkLowerBody, type Flags } from "./checks.ts";
import { cleanText } from "./job.ts";
import { cutout, KEYS, pickKey, toRaster, type KeyName } from "./cutout.ts";
import { keyWords } from "./prompts.ts";
import { decode, encodePng, encodeWebp, flatten, resize, type Raster } from "./raster.ts";

/**
 * One picture of an installed pack, drawn again from words (docs/pack-studio.md, "Draw one picture again"). It works on the picture as the
 * pack has it: put on the key colour, the model changes what was asked, and the picture is cut out again and checked like a pack picture.
 * Its result is kept as a picture of the same pack size; nothing is written until the user accepts it (src/studio-service.ts).
 */

/** The working height of the picture the model sees (the same as a new pack's). */
export const FRAME_WORKING_HEIGHT = 1024;
/** The size of a pack picture (src/studio/build.ts, PACK_W x PACK_H). */
export const FRAME_PACK_W = 940;
export const FRAME_PACK_H = 1070;
/** A picture name as a pack has it (`happy-talk2`): the file name without `.webp`. */
export const FRAME_NAME = /^[a-z0-9_-]{1,48}$/;

/** What the model is asked: the change, and what must stay the same. The user's words are cleaned like the outfit's. */
export function frameEditPrompt(change: string, key: KeyName): string {
  return `Change only this in the picture: ${cleanText(change, 400)}. Keep everything else the same: the same character, pose, framing and expression, and the plain flat ${keyWords[key]} background exactly the same.`;
}

export interface DrawnFrame {
  /** The picture at a pack's size, with its background cut out. */
  picture: Raster;
  /** What the checks still found (empty: passed). */
  flags: Flags;
  key: KeyName;
  /** The blur check's chance that the picture is very blurry. */
  blurry: number;
}

/** Draws one picture again (`pose`: the picture may change her whole posture, so the lower-body check is left out; `change` is the user's words; the prompt names the key colour the picture was put on): the frame's own bytes in, the new picture and its checks out. Throws what the backend throws. */
export async function drawFrame(bytes: Buffer, change: string, seed: number, backend: ImageBackend, signal?: AbortSignal, options: { pose?: boolean } = {}): Promise<DrawnFrame> {
  const source = await decode(bytes);
  const { key } = pickKey(source);
  const height = FRAME_WORKING_HEIGHT;
  const width = Math.min(1536, Math.max(256, Math.round(((source.w / source.h) * height) / 16) * 16));
  const onKey = await resize(flatten(source, KEYS[key]), width, height);
  const image = await encodePng(onKey);
  const edited = await resize(await decode(await backend.edit({ image, prompt: frameEditPrompt(change, key), seed, width, height }, signal)), width, height);
  const cut = cutout(edited, { key });
  const base = cutout(onKey, { key });
  // A picture of an activity may sit, bend or kneel: her lower body is not expected to line up with the rest picture.
  const flags: Flags = [...checkBackground(cut.background, width, height), ...(options.pose ? [] : checkLowerBody(base.alpha, cut.alpha, width, height))];
  const blurry = veryBlurryChance(edited);
  if (blurry >= 0.5) flags.push("very blurry");
  const picture = await resize(toRaster(width, height, cut), FRAME_PACK_W, FRAME_PACK_H);
  return { picture, flags, key, blurry };
}

/** A small preview of a picture on a grey backdrop, for the page (a data: address of a WebP). */
export async function thumbnail(picture: Raster): Promise<string> {
  const small = await resize(flatten(picture, [48, 48, 48]), 280, Math.round((280 * picture.h) / picture.w));
  return `data:image/webp;base64,${(await encodeWebp(small, { quality: 80 })).toString("base64")}`;
}

/** The text the new pack gets for the picture that was drawn again (EDIT.md): what was asked, with what, and what the checks still said. */
export function editText(options: { pack: string; frame: string; change: string; model: string; flags: Flags }): string {
  return (
    `# ${options.frame} in this pack\n\n` +
    `This pack is ${options.pack} with one picture drawn again on this computer: ${options.frame}.\n\n` +
    `The change asked for: ${cleanText(options.change, 400)}.\n\n` +
    `Image maker: ${options.model}. ${options.flags.length ? `The checks still said: ${options.flags.join("; ")}. Look at this picture by eye.` : "The checks passed."}\n\n` +
    `NOTICE.md and credit.txt are the ones of the pack this came from: their terms still apply to every picture in this pack.\n`
  );
}


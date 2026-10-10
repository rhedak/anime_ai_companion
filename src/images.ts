/**
 * Images the user attaches in the browser. They arrive as base64 over the websocket and
 * go to the model as they are, so they are checked here: a known type whose bytes really
 * are that type, a size cap, and a count cap. The browser downsizes big pictures first;
 * these limits are what the server insists on regardless.
 */

export type ImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export interface ImageInput {
  mediaType: ImageType;
  /** Base64, without the data: prefix. */
  data: string;
}

export const MAX_IMAGES = 5;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Room for MAX_IMAGES at the size cap in base64, plus the message around them. */
export const MAX_MESSAGE_BYTES = Math.ceil((MAX_IMAGES * MAX_IMAGE_BYTES * 4) / 3) + 1024 * 1024;

const signatures: Record<ImageType, (b: Buffer) => boolean> = {
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/gif": (b) => b.subarray(0, 4).toString("latin1") === "GIF8",
  "image/webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
};

/** Which image type these bytes really are, judging by their first bytes, or null. */
export function sniffImageType(bytes: Buffer): ImageType | null {
  return (Object.keys(signatures) as ImageType[]).find((type) => signatures[type](bytes)) ?? null;
}

/** The attachments of a message, or a sentence saying what is wrong with them. */
export function parseImages(input: unknown): ImageInput[] | string {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) return "The attachments were not understood.";
  if (input.length > MAX_IMAGES) return `At most ${MAX_IMAGES} images per message.`;
  const images: ImageInput[] = [];
  for (const item of input) {
    const type = item?.mediaType;
    const data = item?.data;
    if (typeof type !== "string" || !Object.hasOwn(signatures, type) || typeof data !== "string") {
      return "Only PNG, JPEG, GIF and WebP images can be attached.";
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return "An attachment was not valid image data.";
    const bytes = Buffer.from(data, "base64");
    if (bytes.length > MAX_IMAGE_BYTES) return `An image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`;
    if (!signatures[type as ImageType](bytes)) return "An attachment is not the kind of image it says it is.";
    images.push({ mediaType: type as ImageType, data });
  }
  return images;
}

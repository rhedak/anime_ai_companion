import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_IMAGES, MAX_IMAGE_BYTES, parseImages } from "../src/images.ts";

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const gif = Buffer.from("GIF89a" + "\0".repeat(16), "latin1");
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(8)]);
const item = (mediaType: string, bytes: Buffer) => ({ mediaType, data: bytes.toString("base64") });

test("no attachments is fine, and each supported type passes through unchanged", () => {
  assert.deepEqual(parseImages(undefined), []);
  assert.deepEqual(parseImages([]), []);
  const all = [item("image/png", png), item("image/jpeg", jpeg), item("image/gif", gif), item("image/webp", webp)];
  assert.deepEqual(parseImages(all), all);
});

test("rejects other types, lying types, bad base64, and anything inherited from Object", () => {
  assert.match(String(parseImages([item("image/svg+xml", png)])), /PNG, JPEG, GIF and WebP/);
  assert.match(String(parseImages([item("constructor", png)])), /PNG, JPEG, GIF and WebP/);
  assert.match(String(parseImages([{ mediaType: "image/png", data: 5 }])), /PNG, JPEG, GIF and WebP/);
  assert.match(String(parseImages([item("image/png", jpeg)])), /not the kind of image/);
  assert.match(String(parseImages([{ mediaType: "image/png", data: "data:image/png;base64,AAAA" }])), /not valid image data/);
  assert.match(String(parseImages("nope")), /not understood/);
});

test("enforces the count and size caps", () => {
  assert.match(String(parseImages(Array(MAX_IMAGES + 1).fill(item("image/png", png)))), /At most 5/);
  const big = Buffer.concat([png, Buffer.alloc(MAX_IMAGE_BYTES)]);
  assert.match(String(parseImages([item("image/png", big)])), /larger than 5 MB/);
});

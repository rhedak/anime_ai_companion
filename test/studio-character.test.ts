import assert from "node:assert/strict";
import { test } from "node:test";
import { characterFrom } from "../src/studio-service.ts";
import { prepareUpload } from "../src/studio/upload.ts";
import { makeRaster, type Raster } from "../src/studio/raster.ts";

/** A plain picture with a figure in the middle: the background is `bg` (or see-through when null). */
function picture(bg: [number, number, number, number], figure: [number, number, number, number] = [200, 40, 60, 255]): Raster {
  const r = makeRaster(60, 80, bg);
  for (let y = 15; y < 65; y++) for (let x = 20; x < 40; x++) r.data.set(figure, (y * 60 + x) * 4);
  return r;
}

test("a new character's id is the name in lower case with dashes; reserved folder names are refused", () => {
  assert.deepEqual(characterFrom("Mira Lane"), { id: "mira-lane", name: "Mira Lane" });
  assert.equal(characterFrom("  !!  "), null, "nothing usable is left");
  assert.equal(characterFrom("Thumbs"), null, "the name is lower-cased first");
  assert.equal(characterFrom("thumbs"), null);
  assert.equal(characterFrom("characters"), null);
});

test("an upload with real transparency is cut to her, on a key colour, with no model call", () => {
  const prepared = prepareUpload(picture([0, 0, 0, 0]));
  assert.equal(prepared.route, "alpha");
  assert.ok(prepared.picture.w < 60 && prepared.picture.h < 80, "cropped to her");
  assert.equal(prepared.picture.data[3], 255, "opaque on the key colour");
});

test("an upload on one flat colour that touches the edge is cut out in code", () => {
  const prepared = prepareUpload(picture([255, 255, 255, 255]));
  assert.equal(prepared.route, "flat");
  assert.ok(prepared.picture.w <= 30, "cropped to the figure, not the whole picture");
});

test("an upload with a busy background is handed to the redraw route", () => {
  const busy = makeRaster(60, 80, [0, 0, 0, 255]);
  for (let i = 0; i < busy.w * busy.h; i++) busy.data.set([(i * 37) % 256, (i * 91) % 256, (i * 53) % 256, 255], i * 4);
  const prepared = prepareUpload(busy);
  assert.equal(prepared.route, "redraw");
});

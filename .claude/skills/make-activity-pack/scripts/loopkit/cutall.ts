// node cutall.ts <dir> <key> <start0> <end0> <step> <cleanPink 0|1>   -> <dir>/cut/cNN.png from <dir>/full/fNNN.png (0-based start, end exclusive)
import { mkdir, writeFile } from "node:fs/promises";
import { decode, encodePng } from "/Users/henrik/git/anime_ai_companion-dev/src/studio/raster.ts";
import { cutout, toRaster } from "/Users/henrik/git/anime_ai_companion-dev/src/studio/cutout.ts";
const [dir, key, start, end, step, pink] = process.argv.slice(2);
await mkdir(`${dir}/cut`, { recursive: true });
let n = 0;
const list = start.includes(",") ? start.split(",").map(Number) : Array.from({ length: Math.ceil((Number(end) - Number(start)) / Number(step)) }, (_, k) => Number(start) + k * Number(step));
for (const i of list) {
  const pic = await decode(`${dir}/full/f${String(i + 1).padStart(3, "0")}.png`);
  n++;
  await writeFile(`${dir}/cut/c${String(n).padStart(2, "0")}.png`, await encodePng(toRaster(pic.w, pic.h, cutout(pic, { key: key as "magenta", floor: 0.02, cleanPink: pink === "1" }))));
}
console.log("frames", n);

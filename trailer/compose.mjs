// Joins the recorded scenes into the cuts, with each scene's speed. Usage: node trailer/compose.mjs
import { existsSync } from "node:fs";
import { join } from "node:path";
import { join_, outDir } from "./lib.mjs";

const plan = {
  // scene: speed. Scenes the video does not need (a version without a Miku switch) are simply missing.
  "01-hook": 1, "02-react": 1.15, "02b-show": 1, "03-switch": 1, "04-work": 1.4, "05-views": 1.35, "06-phone": 1, "07-customise": 1.2, "08-end": 1,
};
for (const version of ["miku", "risa"]) {
  const scenes = Object.keys(plan).filter((name) => existsSync(join(outDir, `${version}-${name}.mp4`)) && !(version === "risa" && name === "03-switch"));
  const seconds = join_(scenes.map((n) => join(outDir, `${version}-${n}.mp4`)), join(outDir, `trailer-${version}-cut.mp4`), { speeds: scenes.map((n) => plan[n]) });
  console.log(version, scenes.length, "scenes,", seconds.toFixed(1), "s");
}

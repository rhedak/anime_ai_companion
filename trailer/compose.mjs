// Joins the recorded scenes into the cuts, each at its own speed, then gives them sound: an original backing track and
// effects timed to the cues the recorder noted (trailer/audio.py). Usage: node trailer/compose.mjs [--silent]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { join_, outDir } from "./lib.mjs";

const silentOnly = process.argv.includes("--silent");
const plan = {
  // scene: speed. Scenes the video does not need (a version without a Miku switch) are simply missing.
  "01-hook": 1, "02-react": 1.15, "02b-show": 1, "03-switch": 1, "04-work": 1.4, "05-views": 1.35, "06-phone": 1, "07-customise": 1.2, "08-end": 1,
};
const seconds = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());

for (const version of ["miku", "risa"]) {
  const scenes = Object.keys(plan).filter((name) => existsSync(join(outDir, `${version}-${name}.mp4`)) && !(version === "risa" && name === "03-switch"));
  const files = scenes.map((n) => join(outDir, `${version}-${n}.mp4`));
  const silent = join(outDir, `trailer-${version}-silent.mp4`);
  const total = join_(files, silent, { speeds: scenes.map((n) => plan[n]) });
  console.log(version, scenes.length, "scenes,", total.toFixed(1), "s");
  if (silentOnly) continue;

  // every scene's cues, moved to where that scene sits in the whole (speeds and fades included), plus a whoosh at each join
  const cues = [];
  let offset = 0;
  scenes.forEach((name, i) => {
    const speed = plan[name];
    const cueFile = join(outDir, `${version}-${name}.cues.json`);
    if (i > 0) cues.push({ t: offset, kind: "whoosh" });
    if (existsSync(cueFile)) {
      const own = JSON.parse(readFileSync(cueFile, "utf8"));
      // a look change before anything was asked is the scene's own reset, not her answer: no sparkle for it
      const firstSend = own.find((c) => c.kind === "send")?.t ?? Infinity;
      for (const c of own) if (!(c.kind === "sparkle" && c.t < firstSend)) cues.push({ ...c, t: offset + c.t / speed });
    }
    offset += seconds(files[i]) / speed;
  });
  const cueFile = join(outDir, `${version}-cues.json`);
  const wav = join(outDir, `${version}-sound.wav`);
  writeFileSync(cueFile, JSON.stringify({ duration: total, cues }));
  execFileSync("uv", ["run", "--with", "numpy", "python", join(import.meta.dirname, "audio.py"), cueFile, wav], { stdio: "inherit" });
  // loudness to -14 LUFS (what YouTube and X aim at), then into the video as AAC; the video stream is not touched
  const final = join(outDir, `trailer-${version}-cut.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, "-i", wav, "-filter_complex", "[1:a]loudnorm=I=-14:TP=-1.5:LRA=9,aresample=48000[a]", "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", final]);
  console.log("  with sound:", final.replace(outDir + "/", ""), `(${cues.length} cues)`);
}

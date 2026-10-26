// Makes site/assets/redraw.gif: the drawn Risa redrawing herself when asked ("make your hair mint green", "put on glasses and a witch hat", ...).
// A throwaway copy of the app with no brain installed answers with its built-in script (which understands these requests and changes the look
// for real), a headless Chrome takes screenshots of her while it happens, and ffmpeg makes the GIF. Usage: node site/shot-redraw.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { startApp, openBrowser, sleep, stageDir } from "../trailer/lib.mjs";

const out = join(import.meta.dirname, "assets");
const work = join(stageDir, "..", ".redraw");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const app = await startApp({ port: 3804, settings: { provider: "claude" }, env: { PATH: dirname(process.execPath) } }); // no brain on the PATH: the built-in script answers
const W = 730, H = 700; // the picture of her and her buttons; the chat pane stays out of it
const frames = [];
try {
  const b = await openBrowser({ cdpPort: 9448, width: 1180, height: 760, scale: 1, mobile: false });
  await b.call("Page.navigate", { url: app.url });
  await sleep(5000);
  await b.evaluate(`document.getElementById('looks-hint-close')?.click()`); // the hint about the Looks menu
  await sleep(500);
  const say = (t) =>
    b.evaluate(`(() => { const ta = document.getElementById('input'); ta.value = ${JSON.stringify(t)}; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`);
  const grab = async (caption, n, gap = 90) => {
    for (let i = 0; i < n; i++) {
      const r = await b.call("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
      frames.push({ png: Buffer.from(r.data, "base64"), caption });
      await sleep(gap);
    }
  };
  const asks = ["make your hair mint green", "put on glasses and a witch hat", "a red coat", "short hair"];
  await b.evaluate(`(() => { const s = document.createElement('style'); s.id = 'no-bubble'; s.textContent = '#bubble { display: none !important; }'; document.head.append(s); })()`); // her first words (how to get a brain) are not the point of this picture
  await grab("", 8);
  await b.evaluate(`document.getElementById('no-bubble')?.remove()`);
  for (const ask of asks) {
    await say(ask);
    await grab(`“${ask}”`, 22, 70); // the change, and her answer
    await grab(`“${ask}”`, 10);
  }
  await b.evaluate(`document.getElementById('reset-look').click()`);
  await grab("Reset look", 8);
  b.close();
} finally {
  app.stop();
}
// captions on the frames (Pillow), then the GIF
for (const [i, f] of frames.entries()) writeFileSync(join(work, `f${String(i).padStart(4, "0")}.png`), await sharp(f.png).removeAlpha().png().toBuffer()); // one pixel format for every picture, or ffmpeg's palette filter stops half way
writeFileSync(join(work, "captions.json"), JSON.stringify(frames.map((f) => f.caption)));
execFileSync("uv", ["run", "--with", "pillow", "python", "-I", join(import.meta.dirname, "../scripts/caption-frames.py"), work, "480"], { stdio: "inherit" });
const palette = join(work, "palette.png");
execFileSync("ffmpeg", ["-v", "error", "-framerate", "10", "-i", join(work, "c%04d.png"), "-vf", "palettegen=max_colors=128:stats_mode=full", palette]);
execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", "10", "-i", join(work, "c%04d.png"), "-i", palette, "-lavfi", "paletteuse=dither=bayer:bayer_scale=4", "-loop", "0", join(out, "redraw.gif")]);
// The site plays the same pictures as a looping video; the GIF stays for the README.
execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", "10", "-i", join(work, "c%04d.png"), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-movflags", "+faststart", "-an", join(out, "redraw.mp4")]);
console.log("wrote redraw.gif and redraw.mp4 from", frames.length, "pictures");
process.exit(0);

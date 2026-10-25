// Takes the picture of the pack studio for the documentation site (site/assets/studio.png) from a throwaway copy of the app:
// a finished job (the Risa tennis pack, from its job folder) is carried on from disk, so the review of the real pictures is on screen.
// The image backend is the test suite's stand-in: it is only asked whether it is there. Usage: node site/shot-studio.mjs [path to the job folder]
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startApp, openBrowser, sleep, root } from "../trailer/lib.mjs";
import { startFakeBackend } from "../test/helpers/image-backend.ts";

const job = process.argv[2] ?? join(root, "data/studio/job-8775ee72");
const packs = join(root, "../anime_ai_companion-packs/packs-src");
const out = join(import.meta.dirname, "assets");
mkdirSync(out, { recursive: true });
const fake = await startFakeBackend();
const app = await startApp({
  port: 3803,
  settings: { provider: "opencode", studioBackend: fake.url },
  before: async (dir) => {
    cpSync(job, join(dir, "data/studio", job.split("/").pop()), { recursive: true });
    mkdirSync(join(dir, "data/frames"), { recursive: true });
    cpSync(join(packs, "risa-bikini"), join(dir, "data/frames/risa-bikini"), { recursive: true });
  },
});
try {
  const desk = await openBrowser({ cdpPort: 9447, width: 1180, height: 1010, scale: 1, mobile: false });
  await desk.call("Page.navigate", { url: app.url });
  await sleep(4000);
  const say = (t) =>
    desk.evaluate(`(async () => { const ta = document.getElementById('input'); ta.value = ${JSON.stringify(t)}; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`);
  await say("/studio on");
  await sleep(4000);
  await desk.evaluate(`[...document.querySelectorAll('.studio button')].find((b) => /Carry on/.test(b.textContent))?.click()`);
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    if ((await desk.evaluate(`document.querySelectorAll('.studio-tiles > *').length`)) >= 11 && (await desk.evaluate(`!!document.querySelector('.studio-extra button')`))) break;
  }
  await desk.evaluate(`(() => {
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    document.getElementById('studio-source').value = 'risa-bikini';
    set('studio-name', 'risa-tennis');
    set('studio-outfit', 'a white short-sleeved tennis polo shirt with navy trim on the collar and sleeves, and a short white pleated tennis skirt');
    const maker = document.getElementById('studio-maker'); maker.value = 'grok-web';
    document.querySelector('.studio').scrollTop = 0;
  })()`);
  await sleep(1500);
  // Only the panel: the rest of the page holds the stand-in backend's name and the scratch app's own settings.
  const box = await desk.evaluate(`(() => { const r = document.querySelector('.studio').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  const r = await desk.call("Page.captureScreenshot", { format: "png", clip: { x: Math.max(0, box.x - 6), y: Math.max(0, box.y - 6), width: box.width + 12, height: box.height + 12, scale: 1 } });
  writeFileSync(join(out, "studio.png"), Buffer.from(r.data, "base64"));
  console.log("wrote studio.png");
  desk.close();
} finally {
  app.stop();
  await fake.stop();
}
process.exit(0);

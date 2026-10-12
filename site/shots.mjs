// Takes the screenshots for the documentation site from a throwaway copy of the app (its own data, a demo project,
// a real model), so nothing personal can appear. Usage: node site/shots.mjs   -> site/assets/*.png
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startApp, openBrowser, watchApp, person, recorder, sleep, root, stageDir } from "../trailer/lib.mjs";

const out = join(import.meta.dirname, "assets");
mkdirSync(out, { recursive: true });

const sampleFrames = join(stageDir, "..", ".sample-pack");
rmSync(sampleFrames, { recursive: true, force: true });
// a picture pack drawn by the creator, for the Packs screenshot (no third-party character in any picture)
execFileSync("uv", ["run", "--with", "cairosvg", "python", join(root, "python/make_sample_pack.py"), join(sampleFrames, "risa"), "--preset", "risa"], { stdio: "inherit" });

const app = await startApp({
  port: 3802,
  settings: { provider: "opencode" },
  before: async (dir) => {
    rmSync(join(dir, "packs", "miku"), { recursive: true, force: true }); // no Miku in the screenshots
    mkdirSync(join(dir, "data", "frames"), { recursive: true });
    cpSync(join(sampleFrames, "risa"), join(dir, "data", "frames", "sample-risa"), { recursive: true });
  },
});
const watch = await watchApp(app.url);
const shoot = async (browser, name) => {
  const r = await browser.call("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(out, name), Buffer.from(r.data, "base64"));
  console.log("wrote", name);
};

try {
  // ---- desktop ----  (ONLY_PHONE=1 retakes just the phone pictures)
  if (!process.env.ONLY_PHONE) {
  const desk = await openBrowser({ cdpPort: 9446, width: 1180, height: 760, scale: 1, mobile: false });
  const rec = recorder(desk);
  const me = person(desk, app, watch, rec);
  await me.load(app.url);
  await desk.evaluate(`localStorage.setItem('workbarCollapsed','0')`);
  await me.say("Hi! What can you do?", { cps: 60, hold: 0.5 });
  await me.say("I just got a new job!", { cps: 60, hold: 1.2 });
  await sleep(600);
  await shoot(desk, "chat.png");
  // her look, changed by asking
  await me.say("Give yourself blue hair and put on glasses", { cps: 60, hold: 2.5 });
  await sleep(800);
  await shoot(desk, "customise.png");
  await desk.evaluate(`(() => { const s = document.getElementById('looks'); s.value = 'gallery'; s.dispatchEvent(new Event('change')); })()`);
  await sleep(3500);
  await shoot(desk, "presets.png");
  await desk.evaluate(`document.querySelector('.gallery .preset')?.click()`);
  await sleep(1500);
  await desk.evaluate(`(() => { const s = document.getElementById('looks'); s.value = 'packs'; s.dispatchEvent(new Event('change')); })()`);
  await sleep(2500);
  await shoot(desk, "packs.png");
  await desk.evaluate(`[...document.querySelectorAll('.gallery .preset')].find((b) => /sample-risa/i.test(b.title))?.click()`);
  await sleep(2500);
  await shoot(desk, "pack-active.png");
  watch.send({ type: "pack-select", name: null });
  await sleep(1500);
  // work mode with an approval card
  await me.tap("#mode-work");
  await sleep(800);
  await me.type("Please make the heading in index.html pink", 80);
  const since = watch.mark();
  await me.send();
  const card = await watch.waitFor((e) => e.type === "permission", 150000, since);
  if (card) {
    await sleep(1500);
    await desk.evaluate(`document.querySelector('.perm')?.scrollIntoView({ block: 'center' })`);
    await sleep(500);
    await shoot(desk, "work.png");
    await me.approve(card.request.id);
    // she may ask again (for example to run a command): say yes until she is done
    for (let i = 0; i < 4; i++) {
      const next = await watch.waitFor((e) => e.type === "permission" || e.type === "done" || e.type === "error", 150000, watch.mark());
      if (!next || next.type !== "permission") break;
      await me.approve(next.request.id);
    }
  } else console.log("no approval card appeared");
  desk.close();
  }

  // ---- phone ----
  const phone = await openBrowser({ cdpPort: 9447, width: 390, height: 780, scale: 2, mobile: true });
  const rec2 = recorder(phone);
  const me2 = person(phone, app, watch, rec2);
  await me2.load(app.url);
  watch.send({ type: "pack-select", name: null });
  watch.send({ type: "reset-look" });
  await sleep(1500);
  await phone.evaluate(`document.getElementById('mode-chat')?.click()`);
  await sleep(600);
  await me2.tap("#reset"); // New chat: a clean page
  await sleep(1200);
  await me2.say("Hi! Tell me one nice thing about today, in a short sentence", { cps: 60, hold: 1.8 });
  await sleep(500);
  await shoot(phone, "phone.png");
  await phone.evaluate(`if (document.querySelector('main').dataset.view !== 'behind') document.getElementById('view').click()`);
  await sleep(1400);
  await shoot(phone, "phone-behind.png");
  phone.close();
} finally {
  watch.close();
  app.stop();
}
process.exit(0);

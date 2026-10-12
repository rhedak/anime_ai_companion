// Makes the trailer drafts. Usage:  node trailer/make.mjs miku     (Miku, then Risa)
//                                   node trailer/make.mjs risa      (Risa only: the backup)
// Everything runs in a throwaway copy of the app (trailer/.stage) with its own data, against a real model.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { qrRows } from "../src/lan.ts";
import { startApp, openBrowser, watchApp, recorder, person, sleep, snapshot, join_, outDir } from "./lib.mjs";

const version = process.argv[2] === "risa" ? "risa" : "miku";
// ONLY=06-phone,07-customise records just those scenes (into the same files) and leaves the others alone.
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const fakeLinks = ["http://192.168.0.24:3801/?t=EXAMPLE-ONLY-NOT-A-REAL-TOKEN", "http://my-computer.local:3801/?t=EXAMPLE-ONLY-NOT-A-REAL-TOKEN"];
const fakePhone = { links: fakeLinks, qr: qrRows(fakeLinks[0]) };
const withMiku = version === "miku";
mkdirSync(outDir, { recursive: true });

const credits = withMiku
  ? `Hatsune Miku &copy; Crypton Future Media, INC. www.piapro.net<br>Unofficial fan art under the Piapro Character License, non-commercial.<br>The Miku pictures were made with Grok Imagine.<br>Risa and the drawing engine: anime-character-creator (open source).`
  : `Risa and the drawing engine: anime-character-creator (open source).`;
const endCard = `<h1>Anime AI Companion</h1>
  <div class="sub">Free and open source.<br>Runs on your own computer.<br>Works with Claude Code, Cursor, opencode or Ollama.</div>
  <div class="url">github.com/rhedak/anime_ai_companion</div>
  <div class="credits">${credits}</div>`;

const app = await startApp({
  port: 3801,
  settings: { provider: "opencode", ...(withMiku ? { name: "Miku", framePack: "miku" } : {}) },
});
const browser = await openBrowser();
const watch = await watchApp(app.url);
const rec = recorder(browser);
const me = person(browser, app, watch, rec);
const clips = [];
const log = [];
const emotionsSeen = () => [...watch.state.raw.matchAll(/\[emotion:(\w+)\]/g)].map((m) => m[1]);

/**
 * One scene. A real model is sometimes slow or skips what it was asked, so a scene that throws (or says it
 * was no good) is taken again, up to `takes` times, from a clean chat; only the good take is kept.
 */
async function scene(name, run, { speed = 1, takes = 3, prepare = async () => {} } = {}) {
  if (only && !only.includes(name)) return;
  for (let take = 1; take <= takes; take++) {
    await rec.start(`${version}-${name}`);
    let failure = null;
    try {
      await run();
    } catch (err) {
      failure = err;
    }
    const r = await rec.stop({ speed });
    if (!failure) {
      clips.push(r.clip);
      log.push(`${name}: ${r.seconds.toFixed(1)} s${take > 1 ? ` (take ${take})` : ""}`);
      console.log(name, r.seconds.toFixed(1), "s");
      return;
    }
    log.push(`${name}: take ${take} thrown away: ${failure.message}`);
    console.log(name, "take", take, "thrown away:", failure.message);
    // she may still be answering: stop her, and start the next take from a clean page
    watch.send({ type: "stop" });
    await sleep(2500);
    watch.send({ type: "reset" });
    await sleep(2500);
    await prepare();
  }
  throw new Error(`${name}: no good take in ${takes} tries`);
}

/** The drawn character, named Risa (a no-op after the switch scene; needed when a later scene is recorded on its own). */
async function ensureRisa() {
  if (!withMiku) return;
  watch.send({ type: "pack-select", name: null });
  watch.send({ type: "rename", name: "Risa" });
  await sleep(2000);
}

/** Put the page in the "beside" or "behind" view, whichever it is in now. */
async function setView(view) {
  const now = await browser.evaluate(`document.querySelector('main').dataset.view`);
  if (now !== view) await me.tap("#view");
  await sleep(600);
}

/** Approve every approval card she shows until she has finished. */
async function approveUntilDone() {
  for (;;) {
    const m = await watch.waitFor((e) => e.type === "permission" || e.type === "done" || e.type === "error", 120000);
    if (!m || m.type !== "permission") return m?.type ?? "timeout";
    await sleep(2500); // long enough to read the card
    await me.tap(".perm .allow");
  }
}

try {
  await me.load(app.url, { stageView: "behind" });
  await browser.evaluate(`window.__fakePhone = ${JSON.stringify(fakePhone)}`);

  // 1. the hook
  await scene("01-hook", async () => {
    await me.caption("I gave my AI assistant a face", 3);
    await sleep(2300);
    const said = await me.say("Hi! Who are you?", { cps: 20, hold: 1.0 });
    log.push(`  said: ${said.raw.replace(/\n/g, " ").slice(0, 100)}`);
  });

  // 2. she reacts, then every emotion by name
  await scene("02-react", async () => {
    await me.caption("She reacts to what you say", 4);
    await me.say("I just passed my exam!", { cps: 22, hold: 0.8 });
    log.push(`  emotions: ${emotionsSeen()}`);
    await me.say("Oh no, my laptop just died...", { cps: 22, hold: 0.8 });
    log.push(`  emotions: ${emotionsSeen()}`);
  });
  await scene(
    "02b-show",
    async () => {
      await me.caption("Every emotion has a name", 3);
      await me.type("/show", 16);
      await me.send();
      // the sequence plays itself; its last line says it is over
      for (let i = 0; i < 160; i++) {
        await sleep(250);
        if (await browser.evaluate(`[...document.querySelectorAll('#log .msg.sys')].some((e) => /all of them/.test(e.textContent))`)) break;
      }
      await sleep(600);
    },
    { speed: 2.2 },
  );

  // 3. Miku hands over to Risa
  if (withMiku) {
    await scene("03-switch", async () => {
      await me.caption("Or use the built-in character", 3.2);
      await setView("split");
      await sleep(300);
      await me.tap("#looks");
      await browser.evaluate(`(() => { const s = document.getElementById('looks'); s.value = 'packs'; s.dispatchEvent(new Event('change')); })()`);
      await sleep(1400);
      const tile = await browser.evaluate(`(() => { const b = [...document.querySelectorAll('.gallery .preset')].find((x) => x.title.startsWith('The avatar')); b?.setAttribute('data-trailer', 'drawn'); return Boolean(b); })()`);
      if (!tile) throw new Error("no drawn-avatar tile in the packs gallery");
      await me.tap('[data-trailer="drawn"]');
      watch.send({ type: "rename", name: "Risa" });
      await sleep(2200);
    }, { speed: 1.15 });
  }

  // 4. work mode (the chat takes the whole screen: the approval card needs the room)
  await scene("04-work", async () => {
    await setView("behind");
    await me.tap("#reset"); // New chat: a clean page for the demo
    await sleep(900);
    await me.tap("#mode-work");
    await me.caption("Work mode: she asks before she touches anything", 4.5);
    await sleep(1200);
    await me.type("Please make the heading in index.html pink", 22);
    const since = watch.mark();
    await me.send();
    rec.pause();
    await watch.waitFor((e) => ["delta", "permission", "tool", "done", "error"].includes(e.type), 120000, since);
    rec.resume();
    let ended = "timeout";
    for (let rounds = 0; rounds < 6; rounds++) {
      const asked = watch.mark();
      rec.pause(); // she may still be reading the file: that wait is left out
      const m = await watch.waitFor((e) => e.type === "permission" || e.type === "done" || e.type === "error", 150000, asked);
      await sleep(500);
      rec.resume();
      if (!m || m.type !== "permission") { ended = m?.type ?? "timeout"; break; }
      await sleep(2600); // long enough to read the card
      const after = watch.mark();
      const ok = await me.approve(m.request.id);
      if (!ok) log.push("  (the tap on Allow missed; answered the card directly)");
      rec.pause(); // the wait while she works is left out: the next frame is her next card, or her answer
      const next = await watch.waitFor((e) => ["permission", "done", "error"].includes(e.type), 150000, after);
      await sleep(900);
      rec.resume();
      if (next?.type !== "permission") { ended = next?.type ?? "timeout"; break; }
    }
    log.push(`  work ended: ${ended}`);
    await sleep(1800);
  }, { speed: 1.2 });

  // 5. the views
  const wide = !only || only.includes("05-views") ? await snapshot(app.url, { width: 1100, height: 700, wait: 4500 }) : "";
  await scene("05-views", async () => {
    await me.tap("#mode-chat");
    await me.caption("Beside the chat, behind it, or full screen", 5);
    await sleep(500);
    await setView("split"); // beside the chat, where the divider is
    const { y } = await me.center("#divider");
    await me.dragDivider(y, y - 120);
    await sleep(350);
    await me.dragDivider(y - 120, y + 140);
    await sleep(500);
    await setView("behind"); // and behind the chat again
    await sleep(1100);
    await browser.evaluate(`window.__inset(${JSON.stringify(wide)}, "on a computer", 2200)`);
    await sleep(2500);
  });

  // 6. the phone
  await scene("06-phone", async () => {
    await ensureRisa();
    await setView("behind");
    await me.caption("Scan it. Same session, on your phone", 4);
    await me.type("/phone", 16);
    await me.send();
    await sleep(1800);
    const qr = await browser.evaluate(`(() => { const s = document.querySelector('#log .msg.sys svg'); if (!s) return null; const b = s.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
    if (qr) await browser.evaluate(`window.__scan(${qr.x - 6}, ${qr.y - 6}, ${qr.w + 12}, ${qr.h + 12}, 2400)`);
    await sleep(3000);
  });

  // 7. Risa reshapes herself. A real model sometimes skips a change, so a take is only kept if both landed.
  await scene(
    "07-customise",
    async () => {
      await ensureRisa();
      await me.tap("#reset"); // New chat
      watch.send({ type: "reset-look" });
      await sleep(1500);
      await setView("split"); // beside the chat, so she is whole on screen
      const since = watch.mark();
      await me.caption("Ask, and she redraws herself", 5);
      await me.say("Give yourself blue hair", { cps: 22, hold: 1.8 });
      await me.say("And put on glasses!", { cps: 22, hold: 1.8 });
      await me.say("Now wave goodbye", { cps: 22, hold: 1.2 });
      const applied = watch.state.events.slice(since).filter((e) => e.type === "avatar").flatMap((e) => e.applied).join(" ");
      const waved = /\[gesture:wave\]/.test(watch.state.raw);
      log.push(`  looks=${applied || "none"} wave=${waved}`);
      if (!(/hair_color/.test(applied) && /glasses=true/.test(applied) && waved)) throw new Error("a change did not land");
    },
    { speed: 1.1, takes: 4 },
  );

  // 8. the end card
  await scene("08-end", async () => {
    await browser.evaluate(`window.__end(${JSON.stringify(endCard)})`);
    await sleep(4200);
  });

  if (!only) {
    const total = join_(clips, join(outDir, `trailer-${version}-draft.mp4`));
    log.push(`TOTAL ${total.toFixed(1)} s`);
  }
} finally {
  writeFileSync(join(outDir, `server-${version}.log`), app.output());
  writeFileSync(join(outDir, `log-${version}.txt`), log.join("\n") + "\n");
  console.log(log.join("\n"));
  watch.close();
  browser.close();
  app.stop();
}
process.exit(0);

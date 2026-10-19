// A short sample video of Draconia in the full app. Usage:  CREATOR_SRC=<creator>/ts/src node trailer/draconia.mjs
// Then:                                                       node trailer/compose.mjs draconia   (adds the sound; trailer/out/trailer-draconia-cut.mp4)
// Like make.mjs it runs a throwaway copy of the app against a real model (opencode's free tier). Her pack is restored from the published archive
// first, exactly as the page's own download would do it, so a take never waits on a download.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, openBrowser, watchApp, recorder, person, sleep, join_, root, outDir } from "./lib.mjs";

const version = "draconia";
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const INDEX = "https://rhedak.github.io/anime_ai_companion-packs/index.json";
mkdirSync(outDir, { recursive: true });

const credits =
  "Draconia Malfoid: an unofficial, non-commercial fan character loosely inspired by Draco Malfoy; not affiliated with Warner Bros. or Wizarding World.<br>" +
  "Her pictures were made with AI (Grok Imagine). Franzi and the drawing engine: anime-character-creator (open source).";
const endCard = `<h1>Anime AI Companion</h1>
  <div class="sub">Free and open source.<br>Runs on your own computer.<br>Works with Claude Code, Cursor, opencode or Ollama.</div>
  <div class="url">github.com/rhedak/anime_ai_companion</div>
  <div class="credits">${credits}</div>`;

/** Her pack, from the published archive, checked against the index's hash, restored into the throwaway app's data. */
async function installPack(app) {
  const index = await (await fetch(INDEX)).json();
  const entry = index.packs.find((p) => p.id === "draconia-uniform");
  if (!entry) throw new Error("draconia-uniform is not in the published index");
  const bytes = Buffer.from(await (await fetch(entry.url)).arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== entry.hashes.sha256) throw new Error("the archive does not match its hash");
  const tar = join(mkdtempSync(join(tmpdir(), "draconia-")), "draconia-uniform.tar");
  writeFileSync(tar, bytes);
  execFileSync(process.execPath, [join(root, "src", "pack-archive-cli.ts"), "restore", tar, "-o", join(app, "data", "frames", "draconia-uniform")], { stdio: "pipe" });
}

/**
 * Her voice, the way the README says to change it: the throwaway copy's persona.md. The default is cheerful, and a free model follows the system prompt
 * over the note a pack adds, so without this she would greet everyone sweetly. Everything after the first lines (the expression tags) is the app's own.
 */
function tsunderePersona(app) {
  const file = join(app, "persona.md");
  const text = readFileSync(file, "utf8");
  const hello = /^You are \{\{name\}\}, a cheerful, warm and slightly mischievous anime-style AI companion/;
  const lively = "Show personality: curious, playful, supportive.";
  if (!hello.test(text) || !text.includes(lively)) throw new Error("persona.md has changed: update tsunderePersona in trailer/draconia.mjs");
  writeFileSync(
    file,
    text
      .replace(hello, "You are {{name}}, a proud, sharp-tongued tsundere anime-style AI companion (an adult, 21 years old)")
      .replace(lively, "Show personality: act aloof and tease the user, call them a baka now and then, but be secretly caring and get flustered when they are kind to you; never be cruel."),
  );
}

const app = await startApp({
  port: 3801,
  creatorSrc: process.env.CREATOR_SRC,
  settings: { provider: "opencode", name: "Draconia", framePack: "draconia-uniform" },
  before: async (app) => {
    await installPack(app);
    if (!process.env.DEFAULT_PERSONA) tsunderePersona(app); // DEFAULT_PERSONA=1 leaves persona.md alone: her character's own voice (src/persona.ts) has to do it
  },
});
const browser = await openBrowser();
const watch = await watchApp(app.url);
const rec = recorder(browser);
const me = person(browser, app, watch, rec);
const clips = [];
watch.subscribe((m) => {
  if (m.type === "permission") rec.cue("card");
  else if (m.type === "permission-resolved") rec.cue("approve");
  else if (m.type === "done") rec.cue("done");
});
const log = [];
const emotionsSeen = () => [...watch.state.raw.matchAll(/\[emotion:(\w+)\]/g)].map((m) => m[1]);

/** One scene; a take that throws is taken again from a clean chat (a real model is sometimes slow or skips what it was asked). */
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
    watch.send({ type: "stop" });
    await sleep(2500);
    watch.send({ type: "reset" });
    await sleep(2500);
    await prepare();
  }
  throw new Error(`${name}: no good take in ${takes} tries`);
}

async function setView(view) {
  const now = await browser.evaluate(`document.querySelector('main').dataset.view`);
  if (now !== view) await me.tap("#view");
  await sleep(600);
}

try {
  await me.load(app.url, { stageView: "behind" });

  // 1. the hook: she answers in her own voice, as the character her pack says she is
  await scene("01-hook", async () => {
    await me.caption("Give your AI assistant a face and a personality", 3.4);
    await sleep(2400);
    const said = await me.say("Hi! Who are you?", { cps: 20, hold: 1.2 });
    log.push(`  said: ${said.raw.replace(/\n/g, " ").slice(0, 140)}`);
  });

  // 2. she reacts to what is said
  await scene("02-react", async () => {
    await me.caption("She reacts to what you say", 4);
    await me.say("I just passed my exam!", { cps: 22, hold: 0.9 });
    log.push(`  emotions: ${emotionsSeen()}`);
    await me.say("Oh no, my laptop just died...", { cps: 22, hold: 0.9 });
    log.push(`  emotions: ${emotionsSeen()}`);
    // a model sometimes misspells a tag ([emotion:surried]): her face would stay neutral, so that take is thrown away
    const known = Object.keys(JSON.parse(readFileSync(join(root, "emotions.json"), "utf8")));
    const bad = emotionsSeen().filter((e) => !known.includes(e));
    if (bad.length) throw new Error(`not an emotion: ${bad}`);
  });

  // 3. every picture her pack has: the chat is cleared first, so she is not hidden behind the conversation
  await scene(
    "02b-show",
    async () => {
      await setView("behind");
      await me.type("/clear", 16);
      await me.send();
      await sleep(1500);
      await me.caption("Every emotion has a picture", 3);
      await me.type("/show", 16);
      await me.send();
      for (let i = 0; i < 160; i++) {
        await sleep(250);
        const line = await browser.evaluate(`[...document.querySelectorAll('#log .msg.sys')].map((e) => e.textContent).filter((t) => /^(Emotion|Gesture|Blinking|Talking|That is all)/.test(t)).at(-1) ?? ''`);
        if (/all of them|That is all/.test(line)) break;
      }
      await sleep(600);
    },
    { speed: 2.2 },
  );

  // 4. the gallery: characters and outfits, downloaded when you want them
  await scene(
    "03-packs",
    async () => {
      await me.caption("Pick a character. Pictures download when you want them", 4.4);
      await setView("behind"); // behind the chat: in the split view the outfits sit under the chat window
      await sleep(300);
      await me.tap("#looks");
      await browser.evaluate(`(() => { const s = document.getElementById('looks'); s.value = 'packs'; s.dispatchEvent(new Event('change')); })()`);
      await sleep(1800);
      const opened = await browser.evaluate(`(() => { const b = document.querySelector('.gallery [data-character="franzi"]'); return Boolean(b); })()`);
      if (!opened) throw new Error("no Franzi tile in the packs gallery");
      await me.tap('.gallery [data-character="franzi"]'); // her outfits open as a row, some of them still to download
      await sleep(2600);
      await browser.evaluate(`(() => { const b = document.querySelector('.gallery [data-pack="draconia-uniform"]'); b?.setAttribute('data-trailer', 'her'); })()`);
      await me.tap('[data-trailer="her"]'); // back to her: the tile of the pack she wears only closes the gallery
      await sleep(1600);
    },
    { speed: 1.1 },
  );

  // 5. work mode (the chat takes the whole screen: the approval card needs the room)
  await scene(
    "04-work",
    async () => {
      await setView("behind");
      await me.tap("#reset");
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
        rec.pause();
        const m = await watch.waitFor((e) => e.type === "permission" || e.type === "done" || e.type === "error", 150000, asked);
        await sleep(500);
        rec.resume();
        if (!m || m.type !== "permission") {
          ended = m?.type ?? "timeout";
          break;
        }
        await sleep(2600);
        const after = watch.mark();
        const ok = await me.approve(m.request.id);
        if (!ok) log.push("  (the tap on Allow missed; answered the card directly)");
        rec.pause();
        const next = await watch.waitFor((e) => ["permission", "done", "error"].includes(e.type), 150000, after);
        await sleep(900);
        rec.resume();
        if (next?.type !== "permission") {
          ended = next?.type ?? "timeout";
          break;
        }
      }
      log.push(`  work ended: ${ended}`);
      if (ended !== "done") throw new Error(`work mode ended with ${ended}`);
      await sleep(1800);
    },
    { speed: 1.2 },
  );

  // 6. the end card
  await scene("08-end", async () => {
    rec.cue("end");
    await browser.evaluate(`window.__end(${JSON.stringify(endCard)})`);
    await sleep(4600);
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

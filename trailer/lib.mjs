// Tools for recording the trailer: a throwaway copy of the app, a phone-sized headless Chrome that is driven like a
// person would drive it, and a screen recorder (Chrome's screencast, turned into video by ffmpeg).
import { spawn, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import WebSocket from "../node_modules/ws/wrapper.mjs";

export const root = resolve(import.meta.dirname, "..");
export const stageDir = join(import.meta.dirname, ".stage");
export const outDir = join(import.meta.dirname, "out");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";

// ---- the throwaway copy of the app ------------------------------------------------------------------------------
/** A fresh copy of the app with its own data, a demo project, and a server on `port`. Returns a handle to stop it. */
export async function startApp({ port = 3801, settings = {}, creatorSrc = resolve(root, "../anime-character-creator/ts/src"), before = async () => {} } = {}) {
  const app = join(stageDir, "app");
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(join(app, "data"), { recursive: true });
  for (const item of ["src", "public", "python", "packs", "persona.md", "persona-work.md", "emotions.json", "package.json", "pyproject.toml"]) {
    cpSync(join(root, item), join(app, item), { recursive: true });
  }
  mkdirSync(join(app, "workspace"), { recursive: true });
  symlinkSync(join(root, "node_modules"), join(app, "node_modules"));
  if (existsSync(join(root, ".venv"))) symlinkSync(join(root, ".venv"), join(app, ".venv"));
  const demo = "/tmp/my-site"; // a plain path, so no home folder shows on the approval card
  rmSync(demo, { recursive: true, force: true });
  mkdirSync(demo, { recursive: true });
  writeFileSync(join(demo, "index.html"), readFileSync(join(import.meta.dirname, "demo-site.html")));
  writeFileSync(join(app, "data", "settings.json"), JSON.stringify({ projectDir: demo, ...settings }, null, 2));
  await before(app);
  const log = join(stageDir, "server.log");
  const proc = spawn(process.execPath, ["src/server.ts", "--lan"], {
    cwd: app,
    env: { ...process.env, PORT: String(port), CREATOR_SRC: creatorSrc, ANAICO_HOME: join(stageDir, "home") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  proc.stdout.on("data", (d) => (output += d));
  proc.stderr.on("data", (d) => (output += d));
  for (let i = 0; i < 120 && !/Companion ready/.test(output); i++) await sleep(500);
  writeFileSync(log, output);
  if (!/Companion ready/.test(output)) throw new Error("the app did not start:\n" + output.slice(-800));
  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    demo,
    output: () => output,
    stop() {
      proc.kill();
    },
  };
}

// ---- Chrome ------------------------------------------------------------------------------------------------------
/** A headless Chrome with one phone-sized tab (360 x 640 css px at 3x: 1080 x 1920). */
export async function openBrowser({ cdpPort = 9444, width = 360, height = 640, scale = 3, mobile = true } = {}) {
  const profile = join(stageDir, "chrome");
  rmSync(profile, { recursive: true, force: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--force-device-scale-factor=${scale}`, `--window-size=${width},${height}`, `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try {
      target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()).find((t) => t.type === "page");
    } catch {}
  }
  if (!target) throw new Error("Chrome did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((r) => ws.on("open", r));
  let id = 0;
  const waiting = new Map();
  const listeners = new Map();
  ws.on("message", (d) => {
    const m = JSON.parse(d);
    if (m.id && waiting.has(m.id)) {
      waiting.get(m.id)(m.error ? { error: m.error } : (m.result ?? {}));
      waiting.delete(m.id);
    } else if (m.method) for (const fn of listeners.get(m.method) ?? []) fn(m.params);
  });
  const call = (method, params = {}) => new Promise((res) => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const on = (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]);
  const evaluate = async (expression) => {
    const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("page: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result?.value;
  };
  await call("Page.enable");
  await call("Runtime.enable");
  // The scale comes from the launch flag: only then does the screencast deliver full-resolution frames.
  await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 0, mobile });
  if (mobile) await call("Emulation.setTouchEmulationEnabled", { enabled: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: readFileSync(join(import.meta.dirname, "overlay.js"), "utf8") });
  return { call, on, evaluate, close() { ws.close(); proc.kill(); }, width, height, scale };
}

// ---- watching the app from outside, to know when she has finished ------------------------------------------------------
export async function watchApp(url) {
  const ws = new WebSocket(url.replace("http", "ws") + "ws", { headers: { Origin: url.replace(/\/$/, "") } });
  await new Promise((r) => ws.on("open", r));
  const state = { raw: "", events: [], turns: 0 };
  const handlers = new Set();
  ws.on("message", (d) => {
    const m = JSON.parse(d);
    state.events.push(m);
    if (m.type === "delta") state.raw += m.text;
    if (m.type === "user") state.raw = "";
    for (const fn of handlers) fn(m);
  });
  return {
    state,
    subscribe: (fn) => handlers.add(fn),
    send: (msg) => ws.send(JSON.stringify(msg)),
    /** Resolves with the first event the test accepts, or null after `ms`. */
    /** The first event the test accepts, among those from index `since` on (default: from now), or null after `ms`. */
    mark: () => state.events.length,
    waitFor: (test, ms = 90000, since = state.events.length) => new Promise((resolve) => {
      const earlier = state.events.slice(since).find(test);
      if (earlier) return resolve(earlier);
      const timer = setTimeout(() => { handlers.delete(fn); resolve(null); }, ms);
      const fn = (m) => { if (test(m)) { clearTimeout(timer); handlers.delete(fn); resolve(m); } };
      handlers.add(fn);
    }),
    close: () => ws.close(),
  };
}

// ---- the recorder ------------------------------------------------------------------------------------------------------
export function recorder(browser) {
  let frames = [];
  let dir = "";
  let name = "";
  let paused = true;
  let pausedAt = 0;
  let pausedTotal = 0;
  let started = 0;
  let cues = [];
  browser.on("Page.screencastFrame", (p) => {
    void browser.call("Page.screencastFrameAck", { sessionId: p.sessionId });
    if (paused) return;
    const file = join(dir, `f${String(frames.length).padStart(6, "0")}.jpg`);
    writeFileSync(file, Buffer.from(p.data, "base64"));
    frames.push({ file, t: performance.now() });
  });
  return {
    async start(clip) {
      name = clip;
      dir = join(outDir, "frames", clip);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      frames = [];
      cues = [];
      pausedTotal = 0;
      paused = false;
      started = performance.now();
      await browser.call("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: browser.width * browser.scale, maxHeight: browser.height * browser.scale, everyNthFrame: 1 });
    },
    /** Leave out what happens until `resume()` (the wait for a first word). */
    pause() {
      if (paused) return;
      paused = true;
      pausedAt = performance.now();
      const last = frames.at(-1);
      // Only the first pause after a frame ends it: a later pause (the page did not change in between, so it is still the last frame) must not
      // stretch it over everything that was left out before, which kept the waits in the clip as one long still picture.
      if (last && last.end === undefined) last.end = pausedAt;
    },
    resume() {
      if (!paused) return;
      pausedTotal += performance.now() - pausedAt;
      paused = false;
    },
    /** Note that something happened now, in the clip's own time (what was left out does not count): for the sound. */
    cue(kind, extra = {}) {
      if (!name) return;
      const now = paused ? pausedAt : performance.now();
      cues.push({ t: Math.max(0, (now - started - pausedTotal) / 1000), kind, ...extra });
    },
    /** Stop, and make the clip. `speed` > 1 plays it faster. */
    async stop({ speed = 1 } = {}) {
      const end = performance.now();
      await browser.call("Page.stopScreencast");
      paused = true;
      if (!frames.length) throw new Error(`${name}: no frames were recorded`);
      const lines = ["ffconcat version 1.0"];
      frames.forEach((f, i) => {
        const next = frames[i + 1]?.t ?? end;
        const seconds = Math.max(0.001, ((f.end ?? next) - f.t) / 1000);
        lines.push(`file '${f.file}'`, `duration ${seconds.toFixed(4)}`);
      });
      lines.push(`file '${frames.at(-1).file}'`);
      const list = join(dir, "list.ffconcat");
      writeFileSync(list, lines.join("\n"));
      writeFileSync(join(outDir, `${name}.cues.json`), JSON.stringify(cues));
      const clip = join(outDir, `${name}.mp4`);
      execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", `setpts=PTS/${speed},fps=30,format=yuv420p`, "-c:v", "libx264", "-crf", "17", "-preset", "medium", "-movflags", "+faststart", clip]);
      const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", clip]).toString());
      return { clip, seconds, frames: frames.length };
    },
  };
}

// ---- driving the page like a person ------------------------------------------------------------------------------------
export function person(browser, app, watch, rec) {
  const { call, evaluate } = browser;
  const api = {
    async load(url, localStorage = {}) {
      await call("Page.navigate", { url: "about:blank" });
      await sleep(300);
      await call("Page.navigate", { url });
      await sleep(1500);
      await evaluate(`Object.entries(${JSON.stringify(localStorage)}).forEach(([k, v]) => window.localStorage.setItem(k, v))`);
      await call("Page.reload");
      await sleep(2500);
      await evaluate(`document.getElementById('mode-chat')?.click()`);
      await sleep(600);
    },
    /** A caption at the bottom of the screen for `seconds` (0 = until the next one). */
    async caption(text, seconds = 0) {
      rec.cue("caption");
      await evaluate(`window.__caption(${JSON.stringify(text)}, ${seconds * 1000})`);
    },
    async tag(text) {
      await evaluate(`window.__tag(${JSON.stringify(text)})`);
    },
    async center(selector) {
      const r = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
      if (!r) throw new Error("not on screen: " + selector);
      return r;
    },
    /** Tap an element, with a ripple so the viewer sees where. */
    async tap(selector) {
      const { x, y } = await api.center(selector);
      await evaluate(`window.__ripple(${x}, ${y})`);
      rec.cue("tap");
      await sleep(180);
      await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      await sleep(250);
    },
    /** Tap "Allow once" on the card that is waiting, make sure it was taken, and say so if it was not. */
    async approve(id) {
      const since = watch.mark();
      await evaluate(`document.querySelector('.perm .allow')?.scrollIntoView({ block: 'center' })`);
      await sleep(350);
      await api.tap(".perm .allow");
      const taken = await watch.waitFor((m) => m.type === "permission-resolved", 3500, since);
      if (taken) return true;
      // the tap missed: send what the button sends
      watch.send({ type: "permission-reply", id, decision: "allow" });
      await sleep(600);
      return false;
    },
    async type(text, cps = 17) {
      await evaluate(`document.getElementById('input').focus()`);
      for (const ch of text) {
        rec.cue("key");
        await call("Input.insertText", { text: ch });
        await sleep(1000 / cps + Math.random() * 25);
      }
      await sleep(350);
    },
    async send() {
      rec.cue("send");
      await api.tap("#send");
    },
    /**
     * Type a message and send it, wait for her to finish; the wait for her first word is left out of the clip.
     * Returns what she said (raw, with tags) so a take can be judged.
     */
    async say(text, { cps = 17, hold = 1.2, leaveOutWait = true } = {}) {
      const stuck = await evaluate(`document.getElementById('send').classList.contains('stop')`);
      if (stuck) throw new Error("she is still busy; a message typed now would not be sent");
      await api.type(text, cps);
      const first = watch.waitFor((m) => m.type === "delta" || m.type === "error", 60000);
      const done = watch.waitFor((m) => m.type === "done" || m.type === "error", 150000);
      await api.send();
      if (leaveOutWait) rec.pause();
      const started = await first;
      rec.resume();
      rec.cue("reply");
      if (!started) {
        watch.send({ type: "stop" });
        throw new Error("no answer began within 60 s");
      }
      const end = await done;
      if (!end || end.type === "error") {
        watch.send({ type: "stop" });
        throw new Error("a reply failed: " + (end?.message ?? "no answer in time"));
      }
      await sleep(hold * 1000);
      return { raw: watch.state.raw, error: null };
    },
    async dragDivider(fromY, toY, steps = 22) {
      const { x } = await api.center("#divider");
      await evaluate(`window.__ripple(${x}, ${fromY})`);
      await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y: fromY, button: "left", clickCount: 1 });
      for (let i = 1; i <= steps; i++) {
        await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y: fromY + ((toY - fromY) * i) / steps, button: "left", buttons: 1 });
        await sleep(28);
      }
      await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y: toY, button: "left", clickCount: 1 });
      await sleep(300);
    },
  };
  return api;
}

/** Put clips one after another into one file, each fading in and out a little. */
export function join_(clips, out, { fade = 0.3, speeds = [] } = {}) {
  const inputs = clips.flatMap((c) => ["-i", c]);
  // Hard cuts between scenes: a dip to black at every join looked like a flicker. Only the very start fades in, and the very end fades out.
  const chains = clips.map((c, i) => {
    const speed = speeds[i] ?? 1;
    const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", c]).toString()) / speed;
    const fades = [i === 0 ? `fade=t=in:st=0:d=${fade}` : "", i === clips.length - 1 ? `fade=t=out:st=${Math.max(0, seconds - fade).toFixed(3)}:d=${fade}` : ""].filter(Boolean);
    return `[${i}:v]setpts=PTS/${speed}${fades.length ? "," + fades.join(",") : ""}[v${i}]`;
  });
  const filter = chains.join(";") + ";" + clips.map((_, i) => `[v${i}]`).join("") + `concat=n=${clips.length}:v=1:a=0,scale=in_range=pc:out_range=tv,format=yuv420p[v]`;
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filter, "-map", "[v]", "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-profile:v", "high", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-movflags", "+faststart", out]);
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString());
}

/** A screenshot of a page (a file:// page, or the app on a wide screen), from a second Chrome; returns a data: url. */
export async function snapshot(url, { width = 1100, height = 700, wait = 4000, cdpPort = 9445 } = {}) {
  const profile = join(stageDir, `chrome-snap-${process.pid}-${Date.now()}`);
  mkdirSync(stageDir, { recursive: true });
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--window-size=${width},${height}`, `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      await sleep(250);
      try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()).find((t) => t.type === "page"); } catch {}
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
    await new Promise((r) => ws.on("open", r));
    let id = 0;
    const waiting = new Map();
    ws.on("message", (d) => { const m = JSON.parse(d); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result ?? {}); waiting.delete(m.id); } });
    const call = (method, params = {}) => new Promise((res) => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    await call("Page.enable");
    await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await call("Page.navigate", { url });
    await sleep(wait);
    const shot = await call("Page.captureScreenshot", { format: "png" });
    ws.close();
    return "data:image/png;base64," + shot.data;
  } finally {
    proc.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

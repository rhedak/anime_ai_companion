// Renders the app's page in a hidden Electron window and records it: frames at a steady rate piped into ffmpeg. Touches nothing on screen.
const { app, BrowserWindow } = require("electron");
const { spawn } = require("child_process");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = process.env.CAP_URL || "http://127.0.0.1:3801/";
const OUT = process.env.CAP_OUT;
const W = Number(process.env.CAP_W || 1280), H = Number(process.env.CAP_H || 800), FPS = 30;
const SECONDS = Number(process.env.CAP_SECONDS || 30);
const MESSAGE = process.env.CAP_MESSAGE || "let's go swimming";
if (app.dock) app.dock.hide();
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: W, height: H, useContentSize: true, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.webContents.setFrameRate(60);
  let latest = null;
  win.webContents.on("paint", (_e, _dirty, image) => { latest = image; });
  await win.loadURL(URL);
  await sleep(3500); // the page connects and draws her
  await win.webContents.executeJavaScript('document.getElementById("looks-hint-close")?.click()');
  await sleep(700);
  const size = latest.getSize();
  console.log("frame size", size.width, size.height);
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgra", "-s", `${size.width}x${size.height}`, "-r", String(FPS), "-i", "-",
    "-vf", "scale=1600:-2:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-movflags", "+faststart", OUT], { stdio: ["pipe", "inherit", "inherit"] });
  ff.stdin.on("error", () => {});
  const started = Date.now();
  let frames = 0;
  const timer = setInterval(() => {
    if (latest && Date.now() - started < SECONDS * 1000) { ff.stdin.write(latest.toBitmap()); frames++; }
  }, 1000 / FPS);
  // the script of the take: each message is typed key by key at its time (seconds after the start), then sent
  const sequence = JSON.parse(process.env.CAP_SEQUENCE || "[]");
  for (const step of sequence) {
    while (Date.now() - started < step.at * 1000) await sleep(50);
    win.webContents.focus();
    await win.webContents.executeJavaScript('document.getElementById("input").focus()');
    for (const ch of step.text) {
      win.webContents.sendInputEvent({ type: "char", keyCode: ch });
      await sleep(75);
    }
    await sleep(500);
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
  }
  while (Date.now() - started < SECONDS * 1000) await sleep(100);
  clearInterval(timer);
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  console.log("frames written", frames);
  app.quit();
});

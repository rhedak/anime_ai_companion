// Makes build/icon.png from a render of Risa, the default character: her head and shoulders on a soft rounded plate. Electron does the rasterising, so
// no image tool is needed. Not run by the build; build/icon.png is committed. To make it again:
//   node <creator>/ts/bin/render.ts --out <dir>/risa --preset risa --finish soft --no-metadata
//   npx electron scripts/make-icon.cjs <dir>/risa.svg build/icon.png
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const SIZE = 512;
// The svg is 400x500 with the head near the top: this window of it holds the face and the fringe, with the hair at the sides.
const VIEW = "118 -8 164 164";

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const [svgPath, outPath] = process.argv.slice(2).filter((a) => !a.startsWith("-") && !a.endsWith("make-icon.cjs") && a !== ".");
  if (!svgPath || !outPath) throw new Error("usage: electron scripts/make-icon.cjs <risa.svg> <out.png>");
  const svg = fs.readFileSync(svgPath, "utf8").replace(/<svg[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW}" width="${SIZE}" height="${SIZE}">`);
  const html = `<!doctype html><meta charset="utf-8"><style>
    html, body { margin: 0; background: transparent; }
    .plate { width: ${SIZE}px; height: ${SIZE}px; border-radius: 22%; overflow: hidden;
      background: radial-gradient(circle at 50% 35%, #fdf0ea 0%, #f4d2d9 100%); }
  </style><div class="plate">${svg}</div>`;
  const win = new BrowserWindow({ show: false, width: SIZE, height: SIZE, useContentSize: true, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 800));
  const image = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, image.resize({ width: SIZE, height: SIZE, quality: "best" }).toPNG());
  console.log("wrote", outPath, image.getSize());
  app.quit();
}).catch((err) => {
  console.error(err);
  app.exit(1);
});

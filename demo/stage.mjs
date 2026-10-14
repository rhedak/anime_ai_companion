#!/usr/bin/env node
// Assembles the browser demo as a flat static folder (out/demo by default) from three places: the page itself (public/), the demo's own
// files (demo/), and the renderer (python/render_ops.py plus the creator's package, from the same place the app finds it).
//
//   node demo/stage.mjs                 stage into out/demo
//   node demo/stage.mjs --serve [port]  stage, then serve it on http://127.0.0.1:<port> (default 8765)
//   node demo/stage.mjs --out <dir>     stage somewhere else
//
// Nothing here is served by the app; the folder is what a static host (GitHub Pages) would publish.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCreatorSrc } from "../src/creator.ts";
import { packInfo, readPack } from "../src/frame-pack.ts";

/** The picture packs the demo offers, by folder name in packs/. Each is copied in whole, so it is only fetched when someone chooses it. */
export const DEMO_PACKS = ["risa-dress"];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.indexOf(name);
const out = resolve(flag("--out") >= 0 ? args[flag("--out") + 1] : join(root, "out", "demo"));

/** Every .py file under `dir`, relative to it, without caches. */
function pythonFiles(dir, prefix = "") {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "__pycache__") continue;
    if (entry.isDirectory()) found.push(...pythonFiles(join(dir, entry.name), `${prefix}${entry.name}/`));
    else if (entry.name.endsWith(".py")) found.push(`${prefix}${entry.name}`);
  }
  return found;
}

export async function stage(target = out) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });

  // The page, as it is, except two things a static host changes: the user's stylesheet is a relative path, and the page is told to use
  // the demo's socket (loaded first; module scripts run in the order they appear).
  for (const name of readdirSync(join(root, "public"))) {
    if (name.endsWith(".d.ts")) continue;
    cpSync(join(root, "public", name), join(target, name), { recursive: true });
  }
  let html = readFileSync(join(target, "index.html"), "utf8");
  html = html.replace('href="/custom.css"', 'href="custom.css"');
  const appTag = '<script type="module" src="app.js"></script>';
  if (!html.includes(appTag)) throw new Error("public/index.html no longer loads app.js the way the demo expects");
  html = html.replace(appTag, `<script type="module" src="demo-boot.js"></script>\n  ${appTag}`);
  // Demo mode: its stylesheet, a title that says so, and a banner that says what this is and where the real thing is.
  const styleTag = '<link rel="stylesheet" href="style.css">';
  if (!html.includes(styleTag) || !html.includes("<body>") || !/<title>[^<]*<\/title>/.test(html)) throw new Error("public/index.html has changed shape: update demo/stage.mjs");
  html = html.replace(styleTag, `${styleTag}\n  <link rel="stylesheet" href="demo.css">`);
  html = html.replace(/<title>[^<]*<\/title>/, "<title>Anime AI Companion (demo)</title>");
  html = html.replace(
    "<body>",
    `<body class="demo">
  <div class="demo-banner" role="note"><span class="demo-banner-short">A demo: it runs in your browser, nothing is sent anywhere.</span><span class="demo-banner-full">This is a demo that runs entirely in your browser: nothing you type is sent anywhere. The real thing runs on your own computer, in front of your coding agent.</span><span class="demo-banner-links"><a href="https://github.com/rhedak/anime_ai_companion">Get it on GitHub</a> · <a href="https://rhedak.github.io/anime_ai_companion/">Documentation</a></span><button type="button" class="demo-banner-toggle" aria-expanded="true" aria-label="Hide most of this notice" title="Hide most of this notice">▴</button></div>`,
  );
  writeFileSync(join(target, "index.html"), html);
  writeFileSync(join(target, "custom.css"), "/* the demo has no user stylesheet */\n");

  // In the repository the demo's files import the shared ones as "../public/x.js"; staged, everything sits in one folder.
  for (const name of readdirSync(join(root, "demo"))) {
    if (name.endsWith(".css")) cpSync(join(root, "demo", name), join(target, name));
    if (!name.endsWith(".js")) continue;
    writeFileSync(join(target, name), readFileSync(join(root, "demo", name), "utf8").replaceAll('"../public/', '"./'));
  }
  cpSync(join(root, "python", "render_ops.py"), join(target, "render_ops.py"));
  cpSync(join(root, "emotions.json"), join(target, "emotions.json"));

  // The picture packs: their pictures, a thumbnail for the gallery (the page asks for pack-thumb/<name>), and the list the socket hands the page.
  const emotionNames = Object.keys(JSON.parse(readFileSync(join(root, "emotions.json"), "utf8")));
  const packs = {};
  for (const name of DEMO_PACKS) {
    const read = await readPack(join(root, "packs"), name, emotionNames);
    if (!read.ok) throw new Error(`the demo's pack "${name}" cannot be read: ${read.reason}`);
    mkdirSync(join(target, "frames", name), { recursive: true });
    for (const [file, { path }] of read.pack.files) cpSync(path, join(target, "frames", name, file));
    mkdirSync(join(target, "pack-thumb"), { recursive: true });
    cpSync(read.pack.files.get(read.pack.emotions.neutral.idle).path, join(target, "pack-thumb", name));
    packs[name] = packInfo(read.pack, `frames/${encodeURIComponent(name)}/`);
  }
  writeFileSync(join(target, "packs.json"), JSON.stringify(packs, null, 1) + "\n");

  // The creator's package, from wherever the app finds it, and the list Pyodide needs (its file system must be told what to write).
  const creator = await resolveCreatorSrc();
  const packageDir = join(creator, "anime_character_creator");
  const files = pythonFiles(packageDir).map((f) => `anime_character_creator/${f}`);
  for (const f of files) {
    mkdirSync(dirname(join(target, "creator", f)), { recursive: true });
    cpSync(join(creator, f), join(target, "creator", f));
  }
  writeFileSync(join(target, "creator-files.json"), JSON.stringify(files, null, 1) + "\n");
  return { target, files: files.length };
}

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".py": "text/plain; charset=utf-8", ".png": "image/png", ".webp": "image/webp" };

/** A small static file server for a staged folder (or the whole built site), on 127.0.0.1 only. */
export function serve(dir, port) {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    // A folder is its index.html; "/demo" becomes "/demo/" so its relative links work, as a static host does.
    if (path !== "/" && !path.endsWith("/") && existsSync(join(dir, path)) && statSync(join(dir, path)).isDirectory()) return void res.writeHead(301, { location: `${path}/` }).end();
    const file = normalize(join(dir, path.endsWith("/") ? `${path}index.html` : path));
    if (file !== dir && !file.startsWith(dir + sep)) return void res.writeHead(403).end();
    if (!existsSync(file) || !statSync(file).isFile()) return void res.writeHead(404).end("Not found");
    const body = readFileSync(file);
    // The gallery's thumbnails have no extension (the page asks for pack-thumb/<name>); say what they are from their first bytes.
    const thumbnail = path.startsWith("/pack-thumb/") ? (body.toString("ascii", 0, 4) === "RIFF" ? "image/webp" : "image/png") : null;
    res.writeHead(200, { "content-type": types[extname(file)] ?? thumbnail ?? "application/octet-stream", "cache-control": "no-cache" });
    res.end(body);
  });
  server.listen(port, "127.0.0.1", () => console.log(`serving ${relative(process.cwd(), dir) || dir} on http://127.0.0.1:${port}/`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const done = await stage();
  console.log(`staged ${done.files} creator files into ${relative(process.cwd(), done.target) || done.target}`);
  const at = flag("--serve");
  if (at >= 0) serve(out, Number(args[at + 1]) || 8765);
}

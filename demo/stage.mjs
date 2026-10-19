#!/usr/bin/env node
// Assembles the browser demo as a flat static folder (out/demo by default) from three places: the page itself (public/), the demo's own
// files (demo/), and the renderer: the creator's TypeScript (its `ts/src`, from the same place the app finds it) and this app's
// src/render-ops.ts, both compiled to browser JavaScript with this repository's `tsc` (tsconfig.demo.json for ours, the creator's own
// ts/tsconfig.web.json for its code). Nothing is downloaded by the page except these files: no Python, no Pyodide, no CDN.
//
//   node demo/stage.mjs                 stage into out/demo
//   node demo/stage.mjs --serve [port]  stage, then serve it on http://127.0.0.1:<port> (default 8765)
//   node demo/stage.mjs --out <dir>     stage somewhere else
//
// Nothing here is served by the app; the folder is what a static host (GitHub Pages) would publish.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCreatorSrc } from "../src/creator.ts";
import { packCharacters, packInfo, readPack } from "../src/frame-pack.ts";

/** The picture packs the demo offers, by folder name in packs/. Each is copied in whole, so it is only fetched when someone chooses it. */
export const DEMO_PACKS = ["risa-dress", "franzi-dress"];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.indexOf(name);
const out = resolve(flag("--out") >= 0 ? args[flag("--out") + 1] : join(root, "out", "demo"));

/** Runs this repository's TypeScript compiler (the `typescript` dev dependency) and stops with its own output if it reports an error. */
function tsc(args) {
  const bin = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  try {
    execFileSync(process.execPath, [bin, ...args], { cwd: root, stdio: "pipe", encoding: "utf8" });
  } catch (err) {
    throw new Error(`tsc ${args.join(" ")} failed:\n${err.stdout ?? ""}${err.stderr ?? ""}`);
  }
}

/**
 * The creator's TypeScript as browser JavaScript, in `<target>/creator/js`. It is the creator's own build (`<creator>/ts/tsconfig.web.json`,
 * the one its web tool uses: it rewrites the `.ts` imports to `.js`, which a browser needs), run with this repository's compiler. That config
 * asks for Node's types, which only exist in a checkout that ran `npm install` in `ts/`; the pinned clone has none, so the types come from this
 * repository's own `@types/node` (`--typeRoots`). The code itself imports nothing from Node.
 */
function buildCreator(creatorSrc, target) {
  const config = join(dirname(creatorSrc), "tsconfig.web.json");
  if (!existsSync(config)) throw new Error(`${config} is missing: the creator at ${creatorSrc} has no browser build, so the demo cannot draw with it`);
  const typeRoots = dirname(dirname(createRequire(import.meta.url).resolve("@types/node/package.json")));
  tsc(["-p", config, "--outDir", join(target, "creator", "js"), "--typeRoots", typeRoots]);
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
  <div class="demo-banner" role="note"><span class="demo-banner-short">A demo: it runs in your browser, nothing is sent anywhere.</span><span class="demo-banner-full">This is a demo that runs entirely in your browser: nothing you type is sent anywhere. The real thing runs on your own computer, in front of your coding agent.</span><span class="demo-banner-links"><a href="https://github.com/rhedak/anime_ai_companion">Get it on GitHub</a> · <a href="https://rhedak.github.io/anime_ai_companion/">Documentation</a></span><a class="demo-banner-cta" href="https://rhedak.github.io/anime_ai_companion/download.html">Download the full version</a><button type="button" class="demo-banner-toggle" aria-expanded="true" aria-label="Hide most of this notice" title="Hide most of this notice">▴</button></div>`,
  );
  writeFileSync(join(target, "index.html"), html);
  writeFileSync(join(target, "custom.css"), "/* the demo has no user stylesheet */\n");

  // In the repository the demo's files import the shared ones as "../public/x.js"; staged, everything sits in one folder.
  for (const name of readdirSync(join(root, "demo"))) {
    if (name.endsWith(".css")) cpSync(join(root, "demo", name), join(target, name));
    if (!name.endsWith(".js")) continue;
    writeFileSync(join(target, name), readFileSync(join(root, "demo", name), "utf8").replaceAll('"../public/', '"./'));
  }
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
  // Which character each belongs to (packs/characters/<id>.txt), so the gallery groups an outfit with the others of her character.
  writeFileSync(join(target, "characters.json"), JSON.stringify(await packCharacters([join(root, "packs")], DEMO_PACKS), null, 1) + "\n");

  // The renderer: this app's request handling (src/render-ops.ts) in `js/`, the creator's drawing code in `creator/js/` (demo/render-bridge.js
  // imports both by relative URL). The creator comes from wherever the app finds it.
  const creatorSrc = resolve(await resolveCreatorSrc());
  tsc(["-p", "tsconfig.demo.json", "--outDir", join(target, "js")]);
  buildCreator(creatorSrc, target);
  const files = readdirSync(join(target, "creator", "js")).filter((f) => f.endsWith(".js")).length + readdirSync(join(target, "js")).length;
  return { target, files };
}

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };

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
  console.log(`staged ${done.files} compiled files into ${relative(process.cwd(), done.target) || done.target}`);
  const at = flag("--serve");
  if (at >= 0) serve(out, Number(args[at + 1]) || 8765);
}

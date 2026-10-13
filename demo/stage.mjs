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
  writeFileSync(join(target, "index.html"), html);
  writeFileSync(join(target, "custom.css"), "/* the demo has no user stylesheet */\n");

  // In the repository the demo's files import the shared ones as "../public/x.js"; staged, everything sits in one folder.
  for (const name of readdirSync(join(root, "demo"))) {
    if (!name.endsWith(".js")) continue;
    writeFileSync(join(target, name), readFileSync(join(root, "demo", name), "utf8").replaceAll('"../public/', '"./'));
  }
  cpSync(join(root, "python", "render_ops.py"), join(target, "render_ops.py"));
  cpSync(join(root, "emotions.json"), join(target, "emotions.json"));

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

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".py": "text/plain; charset=utf-8" };

function serve(dir, port) {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const file = normalize(join(dir, path === "/" ? "index.html" : path));
    if (file !== dir && !file.startsWith(dir + sep)) return void res.writeHead(403).end();
    if (!existsSync(file) || !statSync(file).isFile()) return void res.writeHead(404).end("Not found");
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
    res.end(readFileSync(file));
  });
  server.listen(port, "127.0.0.1", () => console.log(`serving ${relative(process.cwd(), dir) || dir} on http://127.0.0.1:${port}/`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const done = await stage();
  console.log(`staged ${done.files} creator files into ${relative(process.cwd(), done.target) || done.target}`);
  const at = flag("--serve");
  if (at >= 0) serve(out, Number(args[at + 1]) || 8765);
}

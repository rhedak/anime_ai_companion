# The browser demo (work in progress)

A version of the page that runs with no server: the visitor's browser runs the character's drawing code (the creator's TypeScript, compiled to
JavaScript, with this app's own `src/render-ops.ts`) and a stand-in for the server answers the page. See step 3 of
[docs/plan.md](../docs/plan.md) for the whole idea and what is still to do.

```bash
npm run demo                       # stages into out/demo and serves it on http://127.0.0.1:8765
node demo/stage.mjs --out <dir>    # only stage
```

Staging runs this repository's `tsc` twice (about two seconds), so it needs `npm install` and the creator's `ts/src` folder (found the way the app
finds it, or `CREATOR_SRC`). The first load downloads about 0.7 MB in all (0.55 MB of that is the creator's compiled drawing code, and a static host compresses it to
about a quarter), without the picture pack, which comes only when it is chosen. The drawing needs no CDN, no Python and no WebAssembly (the
first load was about 6.5 MB, mostly Pyodide, when she was drawn by Python). The browser caches it.

What is here, and how the pieces fit:

- `stage.mjs` assembles a flat static folder from `public/` (the real page), these files, and the renderer, which it compiles: `src/render-ops.ts`
  with `tsconfig.demo.json` into `js/`, and the creator's `ts/src` with the creator's own `ts/tsconfig.web.json` (run with this repository's `tsc`,
  and `--outDir` and `--typeRoots` overridden, because the creator's config asks for Node's types and a pinned clone has no `node_modules`) into
  `creator/js/`. Both compile with `rewriteRelativeImportExtensions`, which turns the `.ts` imports into `.js` ones, as a browser needs. In the
  repository the demo's files import the shared code as `../public/x.js`; staging rewrites that to `./x.js`.
- `demo-boot.js` runs before `public/app.js` and gives it a socket (`window.anaicoSocket`) that lives in the page.
- `local-socket.js` is that socket: the few members of a `WebSocket` the page uses, answering the messages the page sends the way
  `src/server.ts` does for a chat without tools.
- `render-bridge.js` imports the compiled files by relative URL (`js/render-ops.js`, `creator/js/*.js`), builds the creator with
  `creatorFromModules` and runs `createRenderOps`, the same request handling the server's worker thread runs (`src/render-worker.ts`, which
  gets the creator from `src/creator-load.ts` instead). It answers `call(request)` with the reply, so a request gets the same bytes here as
  there (`test/demo-stage.test.ts` checks the SHA-256 of the SVGs).
- `script.js` (in `public/`, shared with the app's basic mode) is what she says: a small rule-based reader that turns a message into a reply with the same tags a model would write. It
  understands several requests in one message (hair, eyes, glasses, hats, a coat, a skirt, hairstyles, presets, moods, gestures, taking things
  off) and answers honestly about anything else. `GREETING` is her first message.
- Asked to chat, or for anything only a model could do (a joke, a poem, "who are you?"), or for anything the script does not know, she says plainly
  that the demo has no language model, and points to the real app's brains (Claude Code, Cursor, opencode) and to Ollama with a link to the
  setup page. The reply ends on words, because the bubble over her picture shows the tail of a reply as plain text.
- **Ollama on the visitor's own computer** (`ollama.js`, `model-switch.js`, the top of the same dialog): "Chat with a model…" first offers Ollama. Nothing is
  tried until the visitor presses *Connect to Ollama*; the page then asks `http://localhost:11434` itself (no server of ours is involved, and nothing
  leaves the machine), lists the models and streams the chat from `/api/chat`: chat only, no tools. It has the interface of `model.js`, so
  `local-socket.js` does not care which answers (`createModelSwitch`; turning one on turns the other off), and the prompt says where it runs
  (`systemPrompt(…, kind)`). Ollama refuses other websites by default, and a browser cannot tell "not running" from "refused", so the failure
  message names both and the fix (`OLLAMA_ORIGINS=<this site> ollama serve`; Chrome may also ask whether the page may reach local devices; Safari may
  block a plain-HTTP address from an HTTPS page). Every model line in the dialog and the first message after switching one on points to the Download page:
  the demo is a taste, the full app is the point. Tests fake Ollama's two endpoints (`test/demo-ollama.test.ts`); nothing real is started.
- The optional small model (`model.js`, `model-dialog.js`, `model-prompt.js`): the prompt "Chat with a small model…" opens a dialog that says
  plainly what is downloaded (SmolLM2 360M, about 207 MB, from huggingface.co, cdn.jsdelivr.net and raw.githubusercontent.com), that it is
  small, and that a model on the visitor's own computer (Ollama) is better. Nothing is fetched before the visitor says yes. With the model on,
  it answers only what the script cannot; the script has first say, so a request about her look (even a loose one, or "turn your hair that color", meaning the colour just named) never goes to the model. It can be turned off or removed from the browser again. WebGPU is
  needed; without it the dialog says so. Tests use a fake model: nothing starts a real one.
- On a phone-sized window the demo starts with her behind the chat (`stageView` in `localStorage`, which `app.js` reads), the notice at the top
  starts folded to one line, and the suggested prompts fold behind an "Ideas" button; the visitor's choices are remembered. `demo-boot.js`
  does this before `app.js` runs.
- `demo.css` is the demo's few changes to the page: a banner, and hiding what only means something with a server behind it (the brain,
  folder, permission and effort menus, the Chat/Work switch, attachments, saved looks, the microphone). `demo-boot.js` adds the suggested prompts.
- The stand-in also plays one scripted scene, a pretend work-mode session: she reads a page, wants one edit, and asks with the real approval
  card (marked as pretend); Allow, Deny and the stop button all lead somewhere. Drawing never waits behind it, so her face keeps moving
  while the card is open.
- **Packs fetched from the packs site** (`remote-packs.js`, `installPack` in `local-socket.js`): the gallery also lists the packs of the packs repository
  (`anime_ai_companion-packs`; the same GitHub Pages host family as the demo, so no new party sees the visitor), grouped by character like the app's, each with the
  index's own preview. A release asset cannot be fetched from a page (no CORS headers), so the packs repository's publish workflow also puts each pack's loose
  lossless frames and a `pack.json` (`node src/pack-archive-cli.ts manifest <folder> -o pack.json`) on its Pages site under `frames/<id>/`; the demo fetches
  `pack.json` and shows the pictures from there, lazily, like the bundled ones. The page asks first, with the size and the host, exactly as in the app
  (`pack-offer`; `/frames <name>` only asks; nothing is fetched before "Download"), and a pack fetched once comes back quietly on the next visit. What comes
  from that site is checked (`remotePacksFrom`, `packInfoFrom`): ids, file names (a bare `*.webp`, never a path or an address) and counts, and only the
  pack's own folder is ever used. A pack not published there yet says so on its tile. The demo bundles `risa-dress` and `franzi-dress` (both in `packs/`).
- **Characters have their own voice** (`VOICES` in `public/script.js`, keyed by the pack's character id, which is look.txt's `character:` line): while a pack of a
  character with a voice is on, the scripted lines (the intro, help, "I can't redraw", the moods and gestures, and every "I need a real model" answer) are
  said in that voice, and the small model is told who she is (`personaFor`). Draconia is a tsundere: when the script cannot answer she says "If you want to talk
  to me properly, download the full version and link a proper brain. If you even have one, baka!", and the link to the Download page follows. Another pack, or the drawn
  avatar, speaks plainly. The app's basic mode (no brain installed) uses the same voices (`character` in `src/providers/scripted.ts`) with the way to install a brain
  instead of the Download link. A new voice is one more entry there; keep each line's emotion tag, and keep it to what the script can actually do.
- **A link can pick the pack or character:** `…/demo/?pack=franzi-bikini` or `?character=franzi` (`wantedFromSearch`, `applyWanted`). A pack that is here (the two
  bundled ones) is shown at once; a character shows its default outfit (`default:` in `packs/characters/<id>.txt`), else any outfit that is here; one that is only
  on the packs site is asked about first (the same question as its tile: size, host, nothing fetched until the visitor says yes). Anything else in the link is ignored, and
  the link wins over the pack she showed last time.
- A picture pack: Looks… → Packs… offers **Risa in a dress** (`DEMO_PACKS` in `stage.mjs`; also `/frames risa-dress`, `/frames off`,
  or the "Try the picture pack" prompt). `stage.mjs` reads the pack with the app's own `readPack` and copies it to `frames/<name>/`, a
  thumbnail to `pack-thumb/<name>` (the page asks for that path) and the list the page needs to `packs.json`. The pictures load only when the
  pack is chosen, so the demo's first load does not grow (the pack is about 11 MB as lossless WebP; about 2.6 MB of that when it is chosen, the rest as emotions are shown or on `/show`). While a pack is on she says
  once that she is a set of pictures and cannot redraw herself, the suggested prompts leave out everything that would redraw her (and offer
  the way back), and a request to redraw is declined in words. `/show` plays only what the pictures have. Picking a drawn look from the
  menu (a preset, Undo, Reset look) shows the drawn avatar again, as in the app.
- Her look, the preset it started from, and the picture pack she shows are kept in the browser's `localStorage` (`demoLook`), so a reload
  brings her back as she was; Reset look forgets it. The chat itself is not kept. A look the drawing code no longer accepts is dropped for the
  default. Messages sent while she answers are listed as queued, can be taken out, and come back to the box on Stop, as in the app.
- `public/frames.js` and `public/tags.js` are shared with the server (`src/avatar.ts`, `src/avatar-tags.ts`): the demo asks for exactly the
  frames the server would, because it runs the same code. Do not fork them.

Rules: the demo's own files are plain JavaScript that is copied as it is, nothing from here is imported by `src/`, and every URL is relative so
it works under a sub-folder. The one build step is the renderer's compile in `stage.mjs`; `src/render-ops.ts` must stay free of `node:` imports
(`npm run typecheck` compiles it with `tsconfig.demo.json`, which has no Node types, so an import of Node fails there), and Node-only loading
lives in `src/creator-load.ts`. Tests: `test/browser-demo.test.ts` and `test/demo-stage.test.ts` (stages the demo into a temporary folder, checks
that there is no Python or Pyodide in it, that it is under 2 MB without the picture pack, and that its compiled modules load in Node and
draw the server's bytes); both run under `npm test`. The page itself is checked by hand in Chrome: stage it, serve the folder with
`python3 -m http.server <port> --bind 127.0.0.1 --directory <dir>` (or `npm run demo`), and look for the avatar's `<svg` in
`chrome --headless=new --virtual-time-budget=60000 --dump-dom http://127.0.0.1:<port>/`, also with the folder staged under `<dir>/demo/`.

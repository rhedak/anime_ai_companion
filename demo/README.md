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
- `script.js` is what she says: a small rule-based reader that turns a message into a reply with the same tags a model would write. It
  understands several requests in one message (hair, eyes, glasses, hats, a coat, a skirt, hairstyles, presets, moods, gestures, taking things
  off) and answers honestly about anything else. `GREETING` is her first message.
- Asked to chat, or for anything only a model could do (a joke, a poem, "who are you?"), or for anything the script does not know, she says plainly
  that the demo has no language model, and points to the real app's brains (Claude Code, Cursor, opencode) and to Ollama with a link to the
  setup page. The reply ends on words, because the bubble over her picture shows the tail of a reply as plain text.
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

# The browser demo (work in progress)

A version of the page that runs with no server: the visitor's browser runs the character's drawing code (Python, through Pyodide) and a
stand-in for the server answers the page. See step 3 of [docs/plan.md](../docs/plan.md) for the whole idea and what is still to do.

```bash
npm run demo                       # stages into out/demo and serves it on http://127.0.0.1:8765
node demo/stage.mjs --out <dir>    # only stage
```

The first load needs the internet (Pyodide comes from a CDN, about 5.5 MB); after that it is cached by the browser.

What is here, and how the pieces fit:

- `stage.mjs` assembles a flat static folder from `public/` (the real page), these files, `python/render_ops.py` and the creator's package
  (found the same way the app finds it). In the repository the demo's files import the shared code as `../public/x.js`; staging rewrites that
  to `./x.js`.
- `demo-boot.js` runs before `public/app.js` and gives it a socket (`window.anaicoSocket`) that lives in the page.
- `local-socket.js` is that socket: the few members of a `WebSocket` the page uses, answering the messages the page sends the way
  `src/server.ts` does for a chat without tools.
- `render-bridge.js` loads Pyodide (from jsDelivr, pinned) and the creator's files, and runs `python/render_ops.py`, the same request
  handling as the server's worker.
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

Rules: plain JavaScript, no build step, nothing from here imported by `src/`. Tests: `test/browser-demo.test.ts` (run under `npm test`);
the page itself is checked by hand in Chrome.

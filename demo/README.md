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
- `demo.css` is the demo's few changes to the page: a banner, and hiding what only means something with a server behind it (the brain,
  folder, permission and effort menus, the Chat/Work switch, attachments, saved looks, the microphone). `demo-boot.js` adds the suggested prompts.
- The stand-in also plays one scripted scene, a pretend work-mode session: she reads a page, wants one edit, and asks with the real approval
  card (marked as pretend); Allow, Deny and the stop button all lead somewhere. Drawing never waits behind it, so her face keeps moving
  while the card is open.
- `public/frames.js` and `public/tags.js` are shared with the server (`src/avatar.ts`, `src/avatar-tags.ts`): the demo asks for exactly the
  frames the server would, because it runs the same code. Do not fork them.

Rules: plain JavaScript, no build step, nothing from here imported by `src/`. Tests: `test/browser-demo.test.ts` (run under `npm test`);
the page itself is checked by hand in Chrome.

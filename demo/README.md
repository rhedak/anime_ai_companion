# The browser demo (work in progress)

A version of the page that runs with no server: the visitor's browser runs the character's drawing code (Python, through Pyodide) and a
stand-in for the server answers the page. See step 3 of [docs/plan.md](../docs/plan.md) for the whole idea and what is still to do.

```bash
node demo/stage.mjs --serve        # stages into out/demo and serves it on http://127.0.0.1:8765
node demo/stage.mjs --out <dir>    # only stage
```

What is here, and how the pieces fit:

- `stage.mjs` assembles a flat static folder from `public/` (the real page), these files, `python/render_ops.py` and the creator's package
  (found the same way the app finds it). In the repository the demo's files import the shared code as `../public/x.js`; staging rewrites that
  to `./x.js`.
- `demo-boot.js` runs before `public/app.js` and gives it a socket (`window.anaicoSocket`) that lives in the page.
- `local-socket.js` is that socket: the few members of a `WebSocket` the page uses, answering the messages the page sends the way
  `src/server.ts` does for a chat without tools.
- `render-bridge.js` loads Pyodide (from jsDelivr, pinned) and the creator's files, and runs `python/render_ops.py`, the same request
  handling as the server's worker.
- `script.js` is what she says. For now two tricks (hair colour, glasses); the scripted conversation grows here.
- `public/frames.js` and `public/tags.js` are shared with the server (`src/avatar.ts`, `src/avatar-tags.ts`): the demo asks for exactly the
  frames the server would, because it runs the same code. Do not fork them.

Rules: plain JavaScript, no build step, nothing from here imported by `src/`. Tests: `test/browser-demo.test.ts` (run under `npm test`);
the page itself is checked by hand in Chrome.

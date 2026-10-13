# Plan: what comes next

Updated 2026-10-13. Everything that was planned before this and is done (Cursor, opencode and Ollama as brains; character cards; her
notes about you; speech input; queued messages; skills; `--doctor`; the server tests) is in the README and in git, and is not repeated here.
This file is only what is still open. Everything here keeps the rules in `AGENTS.md`: loopback only, nothing from a model is injected as
HTML, permission modes stay in memory, and the cache-friendly way of talking to Claude is not broken.

## Order

| # | Step | State | Why this place |
| --- | --- | --- | --- |
| 1 | Check Ollama work mode with real models | waiting for a machine that can run one | Local code never leaves the machine; quality depends on the model |
| 2 | Split `server.ts` and `app.js` | in progress (7 of 11 pieces of the server done; the page not started) | An outside review asked for it, and the tests now make it safe |
| 3 | A demo that runs in the browser | phases 0 and 1 done and checked locally (`npm run demo`); publishing on the docs site is next | A try-before-you-install page, with no server and no cost |

Smaller ideas are at the end.

## Decided against

- **An MCP server that lets another agent drive her face** (`set_emotion`, `play_gesture`, `redesign_avatar`). "Pro mode" (a stdio channel
  into a terminal Claude Code session) was added in `8e6167a` and removed on purpose in `5bf06d2`, with the MCP SDK and a local token
  socket, because the default mode already covers what it did. A new one would bring the same dependency back for a use nobody has
  asked for. If it returns, start from `git show 8e6167a`: loopback only, token protected, unable to start commands. (`data/attach-mcp.json`
  and `data/attach-token` on an old install are leftovers and can be deleted by hand.)
- **A greeting when you come back after a break.** Every message after a long gap pays for the whole conversation again, which is why
  `src/cache-guard.ts` stops it, so a greeting that calls the model is the opposite of what the app protects. A canned line does not fit
  either, because with character cards she can be anyone and a fixed English line would be in the wrong voice. If it returns, the line has to
  come from the character (a field of the card, or `persona.md`), not from the app. (Her card's opening greeting for a new conversation is built.)

## 1. Ollama work mode: check it with real models

Built and tested against a fake Ollama only (`src/providers/ollama-tools.ts`, the loop in `src/providers/ollama.ts`): the loop, approvals,
plan mode, the turn cap, stopping mid-card and the capability check. It has never run against a real model. Tools: `read_file`, `grep`,
`bash`, `write_file` and `edit_file` (exact text replaced once, or everywhere with `replace_all`); `glob` is deferred, since grep and
bash cover it. The docs carry the warning that a local model's tool use is the user's responsibility.

The check waits for another machine (2026-10-13): this one (Intel i5, 16 GB, CPU only) cannot run `qwen3-coder:30b`, whose weights are
19 GB. A machine with about 32 GB of memory, ideally Apple Silicon, can; a 4 to 8 GB tool-capable model such as `qwen3:8b` would also
work here for a first look, slowly. To do: try `qwen3-coder` and one weaker model on a small real task; note which models call tools well,
and whether the exact-match rule of `edit_file` is too strict for them; check whether `/api/show` reports `tools` on the installed Ollama;
decide from that whether to widen the tool set. If the answers are poor, say so in the docs rather than adding tools.

## 2. Splitting `server.ts` and `app.js` (in progress)

Written 2026-10-13, paused for the day. An outside review (issue #1) found the two files too big: `src/server.ts` was 1,815 lines and
`public/app.js` is 1,914. Nothing about behaviour changes in this work; it is only moving code, and the tests decide whether it was safe.

**Where it stands**

- `server.ts` is 1,252 lines. Seven pieces are out, each a module that is *given* what it needs: `memory-service.ts`, `card-service.ts`,
  `skills-service.ts`, `queue-service.ts`, `http-routes.ts`, `notes.ts`, `turn-service.ts` (and `server-types.ts` for `Say` and `Broadcast`).
- The net: `test/server.test.ts` (26 tests, `test/helpers/server.ts`) starts a throwaway copy of the app on a random port with a stand-in
  `claude` and a fake Ollama, and drives it over the websocket. Four deliberate breakages of the old code each failed a test, and so did
  breaking the content-security policy and the cold-cache decision after they moved.
- `npm run typecheck` also checks the page's JavaScript loosely (`tsconfig.frontend.json`). `npm test` runs 242 tests in about 20 seconds.
- Everything done so far is behaviour-neutral and released (0.4.0 and 0.4.1).

**The rules that kept it safe (keep using them)**

1. One module per commit. After each: `npm run typecheck`, then the whole `npm test`, then commit. No other change in the same commit.
2. The pattern is `createXService(deps)` in `src/x-service.ts`, with `deps` an interface of small functions (`mode: () => mode`), never the
   variables themselves: the server keeps reassigning `provider`, `mode` and friends. The service holds its own state.
3. Dependencies are read lazily. A service may be created before the things it reads exist, as long as it only calls them later. The one
   trap: `sessionConfig()` runs while the brains are built, so anything it reads (the skills switch) must be created *before* them.
4. Before moving code that no test touches, write the test first (against the old code), see it pass, then move. Where a test needs a
   state the harness cannot make yet, add a harness option (`coldConversation` was added this way).
5. After the move, break the moved code on purpose once (change one condition) and check a test fails; then restore it. The stand-in runs
   as a separate process, so wait for its log (`waitFor`) instead of reading it the moment an event arrives.
6. Do not undo an experiment with `git checkout <file>` when the file also holds uncommitted work (it cost a re-do once): copy the file
   aside first, or commit first. New, uncommitted files cannot be restored by git at all.
7. `remote` checks (a phone may not run `!commands`, loosen modes, load skills, change the character) must move verbatim. Before and after
   each step, count them: `grep -c remote src/*.ts`, and read the diff for any line that mentions `remote`.

**What is left of `server.ts`, in the order I would do it**

A. **Sessions and `/resume`** → `sessions-service.ts`: `resumeCommand`, `resumeAcp`, `resumeCommandLine`, `ago`, the two listings, the
   Cursor and opencode "remember model" part. Test first: a Claude session file on disk (the harness already writes one for the cold
   conversation), `/resume` lists it, `/resume 1` rebuilds the chat log from it. The Cursor and opencode paths have unit tests for the
   protocol but none at server level; leave their behaviour alone and only move it.
B. **Mode and settings actions** → `actions.ts` (name to be decided): `cannotChange`, `switchMode`, `changeEffort`, `changeClaudeSetup`,
   `changePermissionMode`, `rename`, `chooseFolder`, `stopWork`, `runBang`. This is the coupled one: `mode`, `permissionMode` and
   `claudeSetup` are module variables that `sessionConfig()` and `modeInfo()` read. Give them to the service as its own state
   (`mode()`, `permissionMode()`, `claudeSetup()` getters) and have `sessionConfig()` call those. Tests first: switching chat and work,
   `/effort`, `/setup on` (a restart with the right flags), `/permissions plan` (`--permission-mode plan`), `/rename` (notice and note to
   the model), the home folder refused, stopping a running `!command`.
C. **The slash-command table** → `commands.ts`: `buildCommands(api)` where `api` lists the actions it calls; `parseSlash` and
   `remoteBlocked` go with it. `test/docs.test.ts` already checks that every command is documented. Tests first: `/help` lists them all,
   `/model`, `/cost`, `/phone` without `--lan`, `/export`, `/show`.
D. **The websocket handler** → `ws-handler.ts`: the burst a new page gets (hello, mode, looks, meter, history, queue, cards), then a table
   from message type to handler. This includes the look, preset, pack and error-report messages. Tests first: undo and save a look, switch
   a preset, the page's error report reaching the log, a reloaded page getting the open permission card back. Before and after, list
   every `msg.type` the handler answers (`grep -o 'msg.type === "[a-z-]*"'`); the two lists must be equal.
E. What stays in `server.ts` is the wiring: settings, the avatar, the providers, the services created in the right order, startup and
   shutdown. Target: about 500 lines, readable top to bottom.

**`public/app.js` (1,914 lines), after the server**

It has no automated tests, only checks by hand in Chrome, so it is moved last and in small steps, with `npm run typecheck` (the loose
page check) and this checklist after every step: open the page at a desktop and a phone width; send a message and see the reply and the
tool lines; queue two messages and remove one; open each menu with the mouse and with the arrow keys and Escape; switch Work and back;
tick Use my skills; import a card and see the dialog and its checkboxes; ask the microphone for consent (and say no); trigger a
permission card and the cold-cache card (the harness can start a cold server); save and load a look; drop a picture on the page; reload
and see the history. Candidate modules, by what they own: the chat log and its messages (`addMsg`, Markdown, tool lines), the composer
(submit, queue list, attachments, dictation, the shell hint), the menus (`makeMenu` and the brain, effort and permission menus), the
work bar, the cards and dialogs (permission, cold cache, skills, character card, microphone consent), the voice controls, and the looks
gallery. Shared state (`busy`, `ws`, `state`) goes in one small module that the others import. Consider a tiny browser test (a page
loaded in Chrome by hand is what we have; a headless run would need a dependency, so only add one if the checklist proves too slow).

**Where to pick up**

`git checkout dev` in `/Users/henrik/git/anime_ai_companion-dev` (the worktree; your live checkout stays on `main`), run `npm run
typecheck && npm test` (expect 242 passing), then start with step A: write the `/resume` test, watch it pass, move the code.

## 3. A demo that runs in the browser

Added 2026-10-13. Idea: a page people can open and try without installing anything, like the Godot web exports in `tank_tactics_2d`:
a static folder on GitHub Pages (where the docs site already lives), no server and no running cost. The chat never leaves the visitor's browser.

**Why it looks feasible.** `anime-character-creator` already ships a static web tool (`web/`, deployed to GitHub Pages) in which the visitor's
browser runs the real Python through Pyodide and gets an SVG back from `render_character`; its bridge is about twenty lines and it loads
Pyodide (v0.26.4) from jsDelivr and the package's `.py` files as plain files (3 MB). Our `python/render_worker.py` (191 lines) is the
standard library plus the creator, JSON in and JSON out, so it becomes one function that takes a request and returns a reply instead of
reading stdin. That keeps her whole redraw (hair, glasses, hats, expression, blink, mouth) without a picture pack.

**The architecture, to be confirmed by the spike.** `public/app.js` creates its WebSocket in one place and, as far as I can read, uses a
handful of members of it (`send`, `onmessage`, `readyState`, `close`). A small stand-in object with those members, living in the page,
could answer the messages the server answers today, so the real page (menus, bubbles, drawing, history) runs almost unmodified:

- `demo/` (plain JavaScript, no build step, no TypeScript): `index.html`, `local-socket.js` (the stand-in for the server), a Pyodide worker
  with the ported render function, `script.js` (the scripted conversation), later `model.js`.
- `public/` is copied into the demo at build time, so the demo always shows the real UI. The only change to `public/app.js` is that
  `connect()` may be handed a socket (`window.anaicoSocket`) instead of opening a WebSocket.
- The creator's `.py` files are copied in at build time from the pinned tag in `package.json` (the pages workflow checks the creator out the
  way CI does). Pyodide comes from the CDN at a pinned version.
- Hosting: `/demo/` on the docs site; GitHub Pages already builds and serves it. Nothing else is needed (itch.io was considered and is not
  wanted).

**Phase 0, the spike: done.** Built on `dev` (`demo/`, see `demo/README.md`; `node demo/stage.mjs --serve` stages it and serves it on
port 8765). What it showed, in the browser, with no server:

- The real page runs unmodified except one line: `connect()` takes the socket from `window.anaicoSocket` when something has set it. The
  stand-in (`demo/local-socket.js`) answers `hello`, `mode`, `looks`, `meter`, `history`, `queue`, `frames`, `gesture-frames`, `user` and
  `reset`, and ignores everything else; that was enough for the page to draw her, show a streamed reply, and redraw her.
- "Make my hair mint green" produced a real redraw through Pyodide (hair colour, the page's own "new look" line, her expression and
  blush), and the page said "connected".
- Timing on this machine, Chrome: connected in 4.7 s with the Pyodide files cached. A cold first visit is about 5.5 MB from the CDN
  (`pyodide.asm.wasm` 3.1 MB, the standard library 2.3 MB, both gzip) plus about 1 MB for the demo itself, roughly 6.5 MB.
- The server and the demo now share code, so they cannot drift apart: `public/frames.js` (which frames to ask for) and `public/tags.js`
  (how an `[avatar …]` tag is read) are imported by `src/avatar.ts` and `src/avatar-tags.ts`, and `python/render_ops.py` is the one place the
  renderer's requests are answered (`render_worker.py` is only its stdin loop).
- Tests: `test/browser-demo.test.ts` (12) drives the stand-in against a fake renderer and checks the staged folder; the server tests and
  the avatar tests still pass against the shared code.

Found while doing it, to deal with in phase 1:

- The page still shows controls that mean nothing without a server (the brain menu says "Ollama (local)", Work is greyed out, the folder,
  permission and effort menus, the phone link). Hide or replace them for the demo, and say plainly that it is a demo.
- Python runs on the page's own thread, so a draw blocks the page for a moment. Fine so far; a Web Worker is the fix if it ever shows.
- A message with two requests ("hair mint green and glasses") only gets the first: the scripted reply is one branch. Phase 1 should handle
  several, and a small rule-based reader for redraw requests (colours, glasses, hats, a few moods) will do more for the feel of it than
  canned buttons.
- Not yet checked: a phone-width window, the speech and dictation buttons (they should be hidden), and what a visitor sees if the CDN is
  blocked (a notice appears, and the page stays "disconnected").

**Phase 1, the scripted demo (no model): done, locally.** `npm run demo` stages it and serves it on http://127.0.0.1:8765. What a visitor
gets, all checked by hand in Chrome with no console errors:

- A banner that says what it is (runs entirely in the browser, nothing sent anywhere, where the real thing is), her greeting streamed in,
  and eight suggested prompts as buttons ("Make my hair mint green", "Become Linnea", "Show me work mode", …); typing works the same.
- A rule-based reader (`demo/script.js`) for redraw requests: several in one message, colours with "dark" and "light", hair, ombre tips, eyes,
  hairstyles, glasses, hats (a witch hat too), a coat, skirt, top, ribbon, scarf, mask, boots and belt, taking things off, the 20 presets,
  "surprise me", moods and gestures. A test checks that every field it can set exists in the creator's real schema.
- The page's own buttons work: Undo, Reset look, and the "Looks…" gallery with all 20 characters drawn in the browser.
- A clearly labelled pretend work-mode session with the real approval card (Allow once, Allow for this session, Deny; the stop button
  counts as a no), so the coding side is visible.
- Server-only controls are hidden by `demo/demo.css` (brain, folder, permission and effort menus, the Chat/Work switch, attachments, saved
  looks, the microphone). The Voice button stays: it uses the browser's own voices.
- 18 tests (`test/browser-demo.test.ts`) drive the stand-in against a fake renderer and check the reader, the staged folder and the creator's
  schema.

Still to do before it is public (small): publish it as `/demo/` on the docs site (the pages workflow stages it after the site build, with the
creator checked out at the pinned tag as CI does) and link it from the README, the site and the release notes; check a phone-width window;
see what a visitor sees if the CDN is blocked (a notice appears and the page stays "disconnected"); proofread her lines; decide whether
the demo should say where the real app's screenshots are. Then phase 2.

**Phase 2, an optional model download (later).** A button, off until the visitor asks: "Chat with a small model". A dialog says plainly what
happens: a one-time download of roughly 0.5 to 1 GB from Hugging Face (the real size shown before it starts), cached in the browser,
removable, and that the conversation stays in the browser. Then a ~1B model through WebLLM (WebGPU) or a WebAssembly fallback; chat only, no
work mode. Her expression comes from the `[emotion:…]` tags when the model writes them and from a simple fallback when it does not
(models this small follow the tag protocol badly). Check each model's licence before shipping it. Detect WebGPU first and say so when it
is missing instead of failing.

**Risks and open questions**

- **Model quality.** A ~1B model is weak at persona, tags and long context; the demo must set that expectation, and phase 1 must be good on
  its own so the demo does not depend on it.
- **Browser support.** WebGPU is solid in desktop Chrome and Edge and patchy elsewhere, and on phones. The first load is Pyodide (about
  10 MB) plus the creator files; a model adds 0.5 to 1 GB.
- **Staying in step with the app.** The stand-in server reimplements a small part of `server.ts`. Keep it to chat only, keep it in plain
  JavaScript, and list the messages it answers in one place, so a change to the protocol shows up as a failing test.
- **Privacy wording.** True for the demo: nothing leaves the browser except the downloads. Say it, and say what is downloaded from where.
- **Not for the real app.** Nothing from `demo/` should be imported by `src/` or by the server tests.
- **Open:** the name (the URL is `/demo/` on the docs site); whether to show the pretend work-mode card at all; whether the
  creator's own web tool should link to it.

## Smaller ideas

- Stickers: pick an image from an emotion tag, using the tags she already writes.
- A mood-based theme, through the variables in `public/theme.css`.
- A short page in `docs/` on bringing your own brain, since several listed projects are guides, not code.
- Presets as shareable packs: `packs/` is close to this already.

## Out of scope

- Playing games, Twitch or YouTube chat, and bridges to Telegram, Discord or WeChat. They do not fit a loopback-only, local app.
- Watching the screen or webcam, and device or hardware control.
- Fine-tuning pipelines and anything that sends the user's data off the machine on its own.
- VRM and Live2D, and a UI for the pre-approved tool list, stay open as before and are not part of this plan.

## Risks

- **Local tool use is only as good as the model.** The app cannot make a weak model safe or competent. The approval card is the only gate,
  which is why no looser Ollama mode exists and the docs warn about it.
- **Context.** Tool output can overflow a small `num_ctx`; truncate and say so.
- **Provider differences.** A change that touches the persona or notes must say what Claude Code, Cursor, opencode and Ollama each do now;
  they differ in system prompts (Cursor and opencode prepend the persona to the user message).

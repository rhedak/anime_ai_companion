# Plan: what comes next

Updated 2026-10-14. Everything that was planned before this and is done (Cursor, opencode and Ollama as brains; character cards; her
notes about you; speech input; queued messages; skills; `--doctor`; the server tests) is in the README and in git, and is not repeated here.
This file is only what is still open. Everything here keeps the rules in `AGENTS.md`: loopback only, nothing from a model is injected as
HTML, permission modes stay in memory, and the cache-friendly way of talking to Claude is not broken.

## Order

| # | Step | State | Why this place |
| --- | --- | --- | --- |
| 1 | Check Ollama work mode with real models | first check done 2026-10-14 (`qwen3-coder:30b` good on small tasks, a 7B poor); docs wording and a real-app session still to do | Local code never leaves the machine; quality depends on the model |
| 2 | Split `server.ts` and `app.js` | in progress (7 of 11 pieces of the server done; the page not started) | An outside review asked for it, and the tests now make it safe |
| 3 | A demo that runs in the browser | phases 0 to 2 done and live at `/demo/` on the docs site (since 0.5.0); drawing moved from Pyodide to the creator's compiled TypeScript (about 0.7 MB instead of about 6.5 MB, not yet released); a few small things left, below | A try-before-you-install page, with no server and no cost |

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

Built and tested against a fake Ollama (`src/providers/ollama-tools.ts`, the loop in `src/providers/ollama.ts`): the loop, approvals,
plan mode, the turn cap, stopping mid-card and the capability check. Tools: `read_file`, `grep`,
`bash`, `write_file` and `edit_file` (exact text replaced once, or everywhere with `replace_all`); `glob` is deferred, since grep and
bash cover it. The docs carry the warning that a local model's tool use is the user's responsibility.

**First check against real models, 2026-10-14.** On an Apple M4 with 32 GB, Ollama 0.31.1: `qwen3-coder:30b` (Q4_K_M, 18 GB) and
`qwen2.5-coder-tools:7b`. A script drove the real `OllamaProvider` in work mode on a throwaway project (tasks: find a value, read a long
file, edit in a tab-indented file, edit in a CRLF file, rename a constant four times, create a file and its test, run the tests and fix the
bug, plan mode, a refused command), 3 runs per task and model, `num_ctx` 16384, with an allowlist answering the approval cards. Small sample;
the persona lacked the avatar prompt section.

- `/api/show` reports `tools` for both, and the app's own check (`checkTools()`) returned true.
- **`qwen3-coder:30b`** (about 30 tokens/s): all single-step tasks passed (`edit_file` 14 of 14, tabs, CRLF and `replace_all` included, so
  the exact-match rule was not too strict for it), and it wrote an emotion tag in every run. Run the tests and fix the code: 5 of 5 correct,
  in 8 to 12 steps, one run reaching the 12-step cap. The extra steps were optional `node -e` probes the allowlist refused, which it asked
  for again in other words 2 to 4 times; told to run one refused command it stopped after one ask (3 of 3). In plan mode it called
  `edit_file` and `bash` anyway in 3 of 3 runs (read-only tools only were offered, the app blocked each one and nothing changed) and never
  gave a clean plan; `persona-work.md` says "read and edit files, run commands", which may be why (not tested).
- **`qwen2.5-coder-tools:7b`** (about 21 tokens/s): 4 of 21 on the same tasks. It guessed file names and asked the user instead of
  looking, said it would do something and stopped without a tool call, read a file and asked "Is this what you wanted?" without editing,
  and wrote CommonJS into an ESM project. It gave up after one `edit_file` error asking for `replace_all` where another run recovered. No
  tool call came back as plain text from either model; the 7B wrote an emotion tag in 15 of 27 runs.
- Both models sometimes ended a reply with a stray `[demo]`, which in the app starts the show-off sequence (2 of 29 and 2 of 27 replies).
- **Found in the app, fixed on `dev`:** `read_file`'s own cut at 12,000 characters, with its "ask again with a later `start_line`" note, was
  itself cut at 8,000 characters by the provider, so the model never saw how to read on and took the first part for the whole file (one
  30B run missed a value on line 380 this way). The provider's cap now sits above every tool's own limit (`RESULT_SAFETY_CAP`).
- Open: a session in the real app with the 30B (`COMPANION_PROVIDER=ollama OLLAMA_MODEL=qwen3-coder:30b`); the plan-mode and stray `[demo]`
  behaviour; the README's Ollama section could say what was seen (a 30B-class model works on small tasks, a 7B mostly does not); whether
  to widen the tool set (nothing seen so far asks for it); memory use of the 18 GB model with 16384 context was not measured.

## 2. Splitting `server.ts` and `app.js` (in progress)

Written 2026-10-13, paused for the day. An outside review (issue #1) found the two files too big: `src/server.ts` was 1,815 lines and
`public/app.js` is 1,916. Nothing about behaviour changes in this work; it is only moving code, and the tests decide whether it was safe.

**Where it stands**

- `server.ts` is 1,268 lines. Seven pieces are out, each a module that is *given* what it needs: `memory-service.ts`, `card-service.ts`,
  `skills-service.ts`, `queue-service.ts`, `http-routes.ts`, `notes.ts`, `turn-service.ts` (and `server-types.ts` for `Say` and `Broadcast`).
- The net: `test/server.test.ts` (26 tests, `test/helpers/server.ts`) starts a throwaway copy of the app on a random port with a stand-in
  `claude` and a fake Ollama, and drives it over the websocket. Four deliberate breakages of the old code each failed a test, and so did
  breaking the content-security policy and the cold-cache decision after they moved.
- `npm run typecheck` also checks the page's JavaScript loosely (`tsconfig.frontend.json`). `npm test` runs 288 tests in about 10 seconds.
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

**`public/app.js` (1,916 lines), after the server**

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

`git checkout dev` in `../anime_ai_companion-dev` (the worktree; your live checkout stays on `main`), run `npm run
typecheck && npm test` (expect 288 passing), then start with step A: write the `/resume` test, watch it pass, move the code.

## 3. A demo that runs in the browser

Added 2026-10-13. Idea: a page people can open and try without installing anything, like the Godot web exports in `tank_tactics_2d`:
a static folder on GitHub Pages (where the docs site already lives), no server and no running cost. The chat never leaves the visitor's browser.

**Why it looked feasible (as first built, and since changed).** `anime-character-creator` shipped a static web tool (`web/`, deployed to GitHub
Pages) in which the visitor's browser ran the real Python through Pyodide and got an SVG back from `render_character`; the demo started the
same way, with our `python/render_worker.py` turned into one function that takes a request and returns a reply. **Now** (2026-10, the creator's
TypeScript port): the demo has no Python and no Pyodide. The creator's `ts/src` is compiled to browser JavaScript by `demo/stage.mjs` (the creator's
own `ts/tsconfig.web.json`, run with this repo's `tsc`) and so is the app's own request handling, `src/render-ops.ts`, which the server's worker
thread also runs. The bridge builds the creator from those modules (`creatorFromModules`) and the page downloads about 0.7 MB instead of about
6.5 MB. That keeps her whole redraw (hair, glasses, hats, expression, blink, mouth) without a picture pack, and with the server's exact bytes.

**The architecture, to be confirmed by the spike.** `public/app.js` creates its WebSocket in one place and, as far as I can read, uses a
handful of members of it (`send`, `onmessage`, `readyState`, `close`). A small stand-in object with those members, living in the page,
could answer the messages the server answers today, so the real page (menus, bubbles, drawing, history) runs almost unmodified:

- `demo/` (plain JavaScript that is copied as it is; only the renderer is compiled, at staging): `index.html`, `local-socket.js` (the stand-in for
  the server), `render-bridge.js` (the compiled drawing code; at first a Pyodide worker with the ported render function), `script.js` (the
  scripted conversation), later `model.js`.
- `public/` is copied into the demo at build time, so the demo always shows the real UI. The only change to `public/app.js` is that
  `connect()` may be handed a socket (`window.anaicoSocket`) instead of opening a WebSocket.
- The creator's TypeScript is compiled in at build time from the pinned tag in `package.json` (the pages workflow checks the creator out the
  way CI does; the tag that has its TypeScript is still to be cut). Nothing comes from a CDN for drawing (it was Pyodide, at a pinned version).
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
  (`pyodide.asm.wasm` 3.1 MB, the standard library 2.3 MB, both gzip) plus about 1 MB for the demo itself, roughly 6.5 MB (the figures of the
  Pyodide version; see "Drawing moved to the creator's TypeScript" below for today's).
- The server and the demo now share code, so they cannot drift apart: `public/frames.js` (which frames to ask for) and `public/tags.js`
  (how an `[avatar …]` tag is read) are imported by `src/avatar.ts` and `src/avatar-tags.ts`, and `python/render_ops.py` was the one place the
  renderer's requests were answered (`render_worker.py` was only its stdin loop); that is `src/render-ops.ts` now.
- Tests: `test/browser-demo.test.ts` (12) drives the stand-in against a fake renderer and checks the staged folder; the server tests and
  the avatar tests still pass against the shared code.

Found while doing it, to deal with in phase 1:

- The page still shows controls that mean nothing without a server (the brain menu says "Ollama (local)", Work is greyed out, the folder,
  permission and effort menus, the phone link). Hide or replace them for the demo, and say plainly that it is a demo.
- The drawing runs on the page's own thread (it did with Pyodide too), so a draw blocks the page for a moment. Fine so far; a Web Worker is the fix if it ever shows.
- A message with two requests ("hair mint green and glasses") only gets the first: the scripted reply is one branch. Phase 1 should handle
  several, and a small rule-based reader for redraw requests (colours, glasses, hats, a few moods) will do more for the feel of it than
  canned buttons.
- Not yet checked: a phone-width window, the speech and dictation buttons (they should be hidden), and what a visitor sees if the CDN is
  blocked (a notice appears, and the page stays "disconnected"; with the drawing code now on the demo's own host, only the optional model's
  downloads can be blocked).

**Phase 1, the scripted demo (no model): done, locally.** `npm run demo` stages it and serves it on http://127.0.0.1:8765. What a visitor
gets, all checked by hand in Chrome with no console errors:

- A banner that says what it is (runs entirely in the browser, nothing sent anywhere, where the real thing is), her greeting streamed in,
  and eight suggested prompts as buttons ("Make your hair mint green", "Become Linnea", "Show me work mode", …); typing works the same.
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

**A picture pack in the demo: done, locally.** Looks… → Packs… offers Risa in a dress (the pack that ships with the app). Choosing it makes
her say that she is a set of pictures now and cannot redraw herself; the suggested prompts swap to ones that do not redraw her (plus "Back to
the drawn avatar"), a redraw request is declined in words, and `/show` shows only what the pictures have (every emotion, a blink, talking, wave
and cheer). `/frames` and `/frames off` work as in the app. The page's gallery thumbnail path became relative (`pack-thumb/<name>`) so it works
under a sub-folder. The pack is 11 MB as lossless WebP (pixel-identical to the PNGs it was made from): about 2.6 MB when it is chosen, the rest as emotions are shown
or on `/show`. That is fine for modern connections, so the demo uses the pack as it is.

**Phone width: checked and fixed.** In a 390, 360 and 320 px wide frame the page stacks the picture over the chat, with no sideways page scroll.
What did not work: the chat log got 96 px (the suggested prompts wrapped into six rows), and the last button over the picture ("Reset look") sat
past the edge. Now: the prompts are one row that scrolls sideways with a fade at its end, the buttons over the picture are tighter (all five fit
down to 360 px), the banner is smaller (the log gets 133 to 143 px at 780 px high), and the model dialog scrolls and has full-width buttons.
Then, on the owner's suggestion: on a phone-sized window the demo starts with her **behind the chat** (the page's own view, remembered in
`localStorage` as `stageView`; a choice the visitor makes with its button is kept), so the chat has the whole screen (the log is 527 px of 780);
the notice at the top folds to one line ("A demo: it runs in your browser, nothing is sent anywhere", about 27 px; on a phone it starts folded,
elsewhere open) and the suggested prompts fold behind an "Ideas" button; both choices are remembered. The Looks menu and her buttons are hidden
in the behind view (the page's design), so on a phone the picture pack is reached with the "Try the picture pack" prompt, or the icon in the chat
header puts her beside the chat again.
The docs site's top bar keeps "Try the demo" on one line and drops the plain GitHub pill below 480 px. Not tested on a real phone (touch,
the on-screen keyboard, WebGPU on mobile).

**CDN blocked: checked and fixed (history: this was the Pyodide address, which the demo no longer uses; the notice now says the drawing code could not be loaded).** With the Pyodide address unreachable (tried with a host that does not resolve) the page stays "connecting…"
with no picture. It used to say only "The demo could not start: could not load <url>", and a message sent after that got a half-working
answer, then a technical error, and left the page on "Thinking…" for good. Now there is one plain notice (what failed, that a content blocker, a
firewall or no connection stops it, reload to try again, where to read about the real thing, the details), every later message gets it again and
ends its turn, and a new chat does not greet. The optional model's own download failing is reported in its dialog ("It could not be loaded: …").

Published: it is live at `/demo/` on the docs site (the pages workflow stages it after the site build, with the creator checked out at the
pinned tag as CI does) and linked from the README and the site (0.5.0). Still to do (small): proofread her lines; decide whether the demo
should say where the real app's screenshots are.

**Drawing moved to the creator's TypeScript: done, locally (2026-10, not yet released).** `src/render-ops.ts` is browser-safe (no `node:` import;
`src/creator-load.ts` is the Node-only loader and `creatorFromModules` builds the creator from imported modules), `tsconfig.demo.json` compiles it
(and `npm run typecheck` checks that it stays so), `demo/stage.mjs` compiles it to `js/` and the creator's `ts/src` to `creator/js/` (the creator's own
`tsconfig.web.json` with `--outDir` and `--typeRoots` overridden: a checkout with no `node_modules` works), and `demo/render-bridge.js` imports them by
relative URL. Python, Pyodide, `creator-files.json` and the jsDelivr address are gone from the demo. The page's files without the picture pack are
about 0.7 MB (the creator's compiled code is 0.55 MB, about a quarter of that compressed), where it was about 6.5 MB. Checked in headless Chrome
at the site root and under a sub-folder: the avatar's `<svg` is in the page, the status is "connected", and a patch and four frames drew in the
browser. `test/demo-stage.test.ts` stages the demo for real: no Python or Pyodide in it, under 2 MB, and its compiled modules load in Node and draw
the same SHA-256 as the server's path. Still to do: a creator release that has its TypeScript (the pin in `package.json` is v0.3.0, which has none,
so the pages workflow and the README's clone commands wait for that tag).

**Phase 2, an optional small model in the browser: done, locally.** A prompt "Chat with a small model…" opens a dialog (`demo/model-dialog.js`)
that says what is downloaded and from where, how big it is, that it is small and a model on the visitor's own computer (Ollama) is the way to a
proper chat, and only then downloads. Chosen with the owner: the smallest usable model, **SmolLM2-360M-Instruct** (Apache-2.0; Hugging Face's
model, the MLC build for WebLLM), about 207 MB, run with WebLLM 0.2.86 (Apache-2.0, pinned, from jsDelivr, about 2 MB). The files come from
`huggingface.co`, the compiled GPU code from `raw.githubusercontent.com`; the dialog names all three hosts and says they see the visitor's IP
address. The build follows the GPU: `q4f16_1` where WebGPU has `shader-f16`, else `q4f32_1` (the same download).

- It answers only what the script cannot ("can we chat?", a joke, anything the reader does not know); every redraw, preset, mood and gesture
  stays with the script, and an `[avatar …]` tag the model might write is applied to nothing. It is told her faces and the two gesture tags,
  gets the last eight turns, and its answer gets an emotion tag at the end when it came without a valid one (`demo/model-prompt.js`).
- A model this small loops and rambles, so answers are capped at 120 tokens with repetition penalties, and an answer is ended as soon as it
  repeats a stretch it has already written (`repeatsItself`). Its answers are simple and often silly; the dialog and her own announcement
  say so and point to Ollama on the visitor's computer.
- Tried in Chrome on an Intel laptop GPU: download and load 19 s (a few seconds from the cache), the first answer 10 to 20 s (the GPU compiles
  its programs), later answers start after about 6 s; the stop button ends an answer; "Turn it off" and "Remove it from this browser" work
  (WebLLM's own delete leaves `tensor-cache.json` files behind, so `remove()` clears those too); without WebGPU the dialog says so and offers
  only "Close". Nothing is fetched before the visitor says yes. No Node test starts a model: the stand-in is tested with a fake one.
- Not done: WebAssembly fallback for browsers without WebGPU; a bigger model option; keeping the model out of the greeting's first-time
  load (it is already lazy).

**Risks and open questions**

- **Model quality.** A ~1B model is weak at persona, tags and long context; the demo must set that expectation, and phase 1 must be good on
  its own so the demo does not depend on it.
- **Browser support.** WebGPU is solid in desktop Chrome and Edge and patchy elsewhere, and on phones. The first load is about 0.7 MB (it was
  about 10 MB with Pyodide and the creator's Python files); a model adds 0.5 to 1 GB.
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

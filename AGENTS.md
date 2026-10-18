# Notes for agents

A local anime companion. The browser talks to a Node server; a provider is the brain
(Claude Code, Cursor, or Ollama); a worker thread running the creator's TypeScript draws her. The README is the product
description; this file is what an agent needs beyond it. Find which of these the user wants:

- **Run it** (use the app): the first section.
- **Customise it** (their own persona, looks, colours, drawing): the second.
- **Change the app** (edit `src/` or `public/`, send a fix back): the third, and its constraints.

## Run it

You need Node 22.18+ and one brain: Claude Code (`claude` installed and signed in),
Cursor (`cursor-agent`), opencode, or Ollama. It runs on the user's own machine with their own login.

Clone both repos **side by side** (the drawing code is a separate repo), the creator at the release this version pins
(`creator.ref` in `package.json`; its `main` may be ahead, and a test keeps these commands in step with the pin):

```bash
git clone --branch v0.3.0 https://github.com/rhedak/anime-character-creator.git
git clone https://github.com/rhedak/anime_ai_companion.git
cd anime_ai_companion
npm install
npm start        # http://127.0.0.1:3737
```

No Python is needed: the creator's TypeScript draws her inside the server. `npm install` refuses an older Node (`engine-strict`);
`nvm install 22 && nvm use 22` fixes that. (Python is only for the optional picture-pack tools in `python/`, which `docs/frame-packs.md` describes.)

- `npm link` puts the `anaico` command on the PATH. `anaico` starts in work mode for the folder it is run
  from and opens the browser; `anaico --chat`, `--daemon`, `--status`, `--stop`, `--restart`, `--doctor` are in the README.
- The server listens on `127.0.0.1` only. `PORT` changes the port; `COMPANION_PROVIDER` is
  `claude`, `cursor`, `opencode` or `ollama` (also switchable in the page). The README has the full table. With `ollama` and no
  `OLLAMA_MODEL`, the first installed model is used (in memory only, never saved as the user's choice). Use a model of about 3B or
  bigger: a 0.5B one chats but does not write her `[emotion:…]` and `[avatar …]` tags.
- Everything personal is in `data/` (settings, chat log, her current look, `custom.css`) and `workspace/`.
  Both are git-ignored and belong to the user: do not delete or reset them without asking.
- If the creator is not found next to this repo, the app clones a pinned copy into `~/.anaico/creator/`.
  Point `CREATOR_SRC` at the creator's `ts/src` folder to use another one (before the creator's TypeScript, `src` held its Python package).

When it does not start: run `anaico --doctor` (or `node bin/anaico.js --doctor`; it only looks and says what is missing, and warns when the creator checkout is not at the pinned release), or check that `CREATOR_SRC` (if set) is the creator's `ts/src` folder with a `render.ts` in it,
that `claude` (or `cursor-agent`) is on the PATH and signed in, and that the port is free. In daemon mode the
log is `data/server.log`.

## Customise it

Keep the user's changes where updates do not overwrite them, and tell them when a change needs a restart.

| To change | Edit | Takes effect |
| --- | --- | --- |
| Her personality and voice | `persona.md` (chat), `persona-work.md` (work-mode rules) | restart the server; for Claude also start a new conversation (`/clear`), because an existing one keeps the prompt it began with |
| Her name | click it, or `/rename Hana` | at once |
| A ready-made character | `/card import <file.png\|.json>` (a V1, V2 or V3 character card); `/card export`, `/card reset` | a new conversation (`/clear`) |
| What she remembers about the user | `data/memory.md` (she proposes notes in chat and you keep or decline them; `/memory`, `/memory ask\|auto\|off`) | with her next message |
| Her look | ask her in chat, or `COMPANION_PRESET` for the starting character. Every starting character is drawn in the creator's soft finish (`finish=soft`; `finish=flat` and `highlight_strength` are hers and yours to change) | at once |
| Her expressions | `emotions.json` | restart the server |
| Pictures instead of the drawn avatar | a folder `data/frames/<name>/` (the file names say what each picture is; `docs/frame-packs.md`), then `/frames <name>` or Looks → Packs… | at once |
| The interface | `data/custom.css` (variables in `public/theme.css`) | reload the page |
| Models, pre-approved tools | `data/settings.json`, `COMPANION_MODEL`, `COMPANION_WORK_MODEL` | restart the server |
| How the body is drawn: shapes, hairstyles, outfits, presets | the **creator repo**, not this one | restart the server (the renderer runs as long as it does) |

- `persona.md` carries the tag protocol (`[emotion:…]`, `[gesture:…]`, `[avatar …]`, `[image …]`) that drives
  her face. Keep it, and keep its emotion list in step with `emotions.json`.
- To change drawing, work in the creator checkout next to this repo (or wherever `CREATOR_SRC` points). Do not
  install it: the renderer imports it by path, so edits are picked up on the next server start, and an
  installed copy would only be a second source of truth. This repo's `package.json` pins a creator tag, and a
  checkout of the creator's `main` may be ahead of it. If the user forks, point that pin at their fork.
- The creator has its own tests and tooling; they are separate from this repo's checks.
- A change to behaviour (`src/`, `public/`) is the next section. It is fine, but the safety rules below
  still hold for a personal fork.

## Change the app

### How it is built

- Node runs the TypeScript directly. There is no build step for the app (only the browser demo's staging compiles, below). `npm start` is `node src/server.ts`;
  the `anaico` command is `src/cli.ts`, which starts (or reuses) that server and opens the browser.
- `src/providers/types.ts` is the brain interface. A new brain implements `Provider` and nothing
  in the page should need to know how that process speaks.
- Her face, voice, and the chat log are driven by plain-text tags in the reply
  (`[emotion:…]`, `[gesture:…]`, `[avatar …]`, `[outfit …]` (another outfit of her picture pack's character; `wearOutfit` in `src/server.ts`), `[image …]`). The server strips them. Keep that
  protocol provider-agnostic.
- **The browser demo** (`demo/`, `demo/README.md`, step 3 of `docs/plan.md`) is the real page running with no server: a stand-in for the
  server (`demo/local-socket.js`) answers the messages the page sends, the character is drawn in the visitor's browser by the creator's TypeScript
  compiled to JavaScript (about half a megabyte) with the app's own `src/render-ops.ts` (`demo/render-bridge.js`), and what she says comes from a small rule-based reader (`demo/script.js`) or, only if the
  visitor opts in, a small model in the browser (`demo/model*.js`). `public/app.js` takes its socket from `window.anaicoSocket` when
  something has set it; that one line is the only change the page needs. `node demo/stage.mjs` builds the static folder; `npm run demo`
  serves it on 8765; `npm run site:preview` builds the docs site with the demo in it at `demo/` (what the pages workflow publishes) and
  serves it on 8766.
- `public/frames.js`, `public/tags.js` and `public/demo.js` are shared by the server and the demo (the server imports
  them from `src/avatar.ts`, `src/avatar-tags.ts`, `src/demo.ts`), so both ask for the same frames and read the same tags and show-off list.
  Do not copy them. The request handling (schema, base, patch, frames) is `src/render-ops.ts` for the server, run in a worker thread by
  `src/render-worker.ts` (`AvatarService` cuts it off after 15 s and starts another), which gets the creator from `src/creator-load.ts` (imports by
  path, Node only). `src/render-ops.ts` itself imports nothing from Node, because the demo compiles it for the browser (`tsconfig.demo.json`,
  checked by `npm run typecheck`, which has no Node types) and builds its `Creator` from modules imported by URL (`creatorFromModules`). `python/render_ops.py` is the Python original
  and is not run by the app or the demo any more: it is only the reference that `scripts/gen-render-ops-fixtures.py` runs to make the oracle
  `test/render-ops.test.ts` checks the TypeScript against (`test/fixtures/render-ops.json`; regenerating it is the one job that still needs Python
  3.13 and the creator's Python package, and the one reason `python/render_ops.py` stays, frozen; the other Python is the optional picture-pack
  tools). Nothing in `src/` may import from `demo/`. The demo's own files are plain JavaScript that is copied as they are (no bundler); the one
  build step is `demo/stage.mjs` compiling the renderer with `tsc` (`js/` and `creator/js/` in the staged folder). Its URLs are relative so it works
  under a sub-folder (`/demo/`): keep it so in `public/` too (`pack-thumb/<name>`).
- **The script has first say in the demo.** A request about her look (hair, eyes, an outfit, "that colour") is answered by the reader, never
  by the model, which only gets what the reader cannot answer. A tag for her look written by the model is applied to nothing.
- **Picture packs** (`src/frame-pack.ts`, `public/avatar.js`, `docs/frame-packs.md`): the file names are the manifest. Besides
  `<emotion>[-blink|-talkN]` a pack can have `<gesture>-<n>` pictures (`wave-1.webp`, `cheer-2.webp`) that alternate while she makes that
  gesture. `python/finish_pack.py` turns an image tool's edits into a consistent pack, with only the face (or, for a pose, only the arm)
  changed; its docstring and the docs say how. Packs that ship are in `packs/`: `risa-dress` (an original character, MIT, made with an image
  model), `franzi-dress` (an original character, made with AI) and `miku` (Crypton's character, not MIT, non-commercial, with its own NOTICE and credit shown on screen): one outfit per character,
  so each works offline. The other outfits (`franzi-casual`, `franzi-pajamas`) are in the sister repository `anime_ai_companion-packs` and are downloaded on request (see Pack archives). Ship lossless WebP.
- **Pack archives** (`src/pack-archive.ts`, `src/pack-index.ts`, `src/pack-install.ts`, `docs/pack-archives.md`): a build tool turns a folder of lossless WebP
  frames into a patch archive (rest and pose frames stored whole, blink and talk frames as a lossless crop of the pixels that changed) and
  restores a folder `readPack` already understands. `packs/index.schema.json` is the download index (`id`, name, version, frame count, sizes,
  sha256, https URL of a GitHub Release asset, thumbnail). `packs/thumbs/<id>.webp` is a 200 px preview (`npm run pack-thumbs`); the gallery
  shows it even when the pack is not installed. The installer fetches the index (`COMPANION_PACK_INDEX`, or a placeholder GitHub Pages URL
  until the sister repo is published), checks size and sha256, and renames a restored folder into `data/frames/<id>/`. Packs already on disk
  are not replaced. Nothing is downloaded until the page has asked and the user said yes: the question (`pack-offer`, `askPackDownload` in `public/app.js`) gives the size and the host,
  and a pack named by `/frames` that is not on disk only raises that question. Each character's default outfit (the `default:` line of `characters/<id>.txt`) is the one that stays bundled; the other outfits can be download-only. `sharp` is a runtime dependency because restoring a pack decodes WebP.
- `../anime-character-creator` is a dependency, not a fork. Drawing changes belong in that repo.
- `data/` and `workspace/` (except `workspace/.gitkeep`) are the user's machine. Do not commit
  them, and do not put API keys, sessions, or account details in the repo.

### Safety

The server can run an agent that edits files and runs commands. These are not optional:

- Listen on `127.0.0.1` only. Reject WebSocket connections from other origins. The one exception is the
  user's own `--lan` flag (`src/lan.ts`): off at every start, never a default, never an env var or a saved
  setting. Behind it, every non-loopback request and WebSocket needs the token cookie and an allowed `Host`
  and `Origin`, and such a socket (`remoteSockets`) may not run `!command`, loosen the permission mode,
  turn on `/setup`, or change the project folder. Any new message type that does one of those must check
  `remote` too, and loopback must keep working unchanged (a local proxy would otherwise be a way in).
- The origin check keeps websites out, not other programs on the machine (a local process can forge `Origin`), and
  there is no stronger boundary on loopback: do not describe it as one. `COMPANION_NO_SHELL=1` turns off `!command`.
- Work mode shows the exact command or file change and waits, unless the user has chosen a
  looser mode. Do not add a skip-permissions flag, and do not make a loose mode the default.
- Permission mode is memory only. Every server start comes back to Ask.
- Home and `/` are refused as a project folder.
- A folder's own hooks, settings, and MCP servers stay unloaded unless the user opts in, and
  that opt-in is off at every start. Do not write hooks into their project or their home config.
  `/skills on` is a narrower opt-in with the same rules (off at every start, refused from a phone): it
  loads only the user's own settings source (`--setting-sources user`) with hooks switched off
  (`--settings {"disableAllHooks":true}`). A folder's own skills still need `/setup on`, because a skill's
  frontmatter can pre-approve tools.
- A character card is text from a stranger that ends up in her prompt (`src/card.ts`). Strip markup and our
  own tags, cap lengths, show a preview and ask before it applies. Importing and resetting are not available
  from a phone. Name, description, personality, scenario and example lines are always used; ignore `extensions`.
  Her greeting, the lorebook and the author's own instructions (`system_prompt`, post-history instructions) are
  separate opt-ins at import, and the risk is said once there, not on every use. The orders are off by default,
  apply in chat and work mode once chosen (the strong warning at import says so; the user owns that risk, and every
  tool call still needs approval), sit before the style notes, and must never move after or replace the expression
  protocol. Lorebook entries travel as notes on the user's message, never in the
  system prompt (it is cached), once per conversation with a cap. The expression protocol is never replaced by a
  card, and with no card the prompt is unchanged.
- Her notes about the user (`data/memory.md`, `src/memory.ts`) are delivered as data through
  `notesForModel`, never in the system prompt. She may save a note (`[remember …]`) only in chat mode: in
  work mode a file or page she reads could talk her into writing something that outlives the conversation.
  Keep it a single append-only file the user can see, edit and clear. A note is a proposal: by default (`memorySaving: "ask"`, in
  `data/settings.json`) the page shows a card and nothing is written until the user keeps it. `auto` saves it with an Undo and
  `off` ignores it; `/memory auto` is refused from a phone, like any loosening.
- The desktop shell's update notice (`app/update-check.cjs`) is the one request the shell makes on its own: off until the user says yes in a dialog that names
  GitHub, notify only (never download or run anything), once a day at most. Keep it that way; installing updates would need signing first.
- Speech input is the one place audio leaves the machine (the browser's recognition sends it to the browser
  maker). It stays opt-in, asks first and says who receives it, listens one phrase at a time, and never
  sends the text by itself.
- The demo's optional small model is opt-in and says who is contacted before it does anything: nothing is fetched until the visitor
  presses the button in its dialog, which names the hosts (Hugging Face for the model, jsDelivr for the library, GitHub for its compiled
  code), the size, that those hosts see the IP address, and that it is small and a model on the visitor's own computer is the way to a proper
  chat. It runs in the browser; nothing the visitor types is sent anywhere. It can be turned off and removed. Keep the library at an exact
  version. Tests use a fake model: nothing starts a real one.
- Avatar values are validated per field. The page sanitises SVG. Do not inject HTML from the model.

### Brains

**Claude Code** (`src/providers/claude-code.ts`) is a long-lived `claude -p` process. Tool
approval is `--permission-prompt-tool stdio`. The stream format is not a stable API; pin it
with fixtures in `test/`, the way `claude-stream.ts` does. `--setting-sources ""` unless setup
is opted in.

- Claude Code records the system prompt with the conversation and reuses it on every resume. That
  keeps the prompt cache warm; a cold cache re-sends the whole conversation at full price. So the
  persona text does not change a running conversation: tell her about later changes (work mode, a
  look picked from the menu, a rename) through `notesForModel`, which rides on the next user
  message. Do not put volatile state into a launch flag.
- `--autocompact` caps the context at 200k tokens (`COMPANION_AUTOCOMPACT` changes it). Keep a cap:
  the model window is 1M, and every restart or idle hour makes the next message pay for all of it.
- `server.ts` holds a message back with a card when the cache has gone cold on a big conversation
  (`src/cache-guard.ts`). Do not send around it.

**Cursor** (`src/providers/cursor.ts`) is `cursor-agent acp`, the Agent Client Protocol on
stdin/stdout. Spawn `cursor-agent`. A command named `agent` is not necessarily that binary.

- The headless SDK (`@cursor/sdk`) runs tools with no approval callback. Do not use it for work mode.
- `session/request_permission` blocks until the client answers `allow-once`, `allow-always`, or
  `reject-once`. Those are the existing card buttons. No answer means the tool does not run.
- Chat is ACP mode `ask` (read-only). Plan is `plan`. Anything else in work mode is `agent`.
- **Run Everything** is `cursor-agent --force`, work mode only, chosen in the menu, not saved.
  `--auto-review` is not honoured by ACP, so Auto and Accept edits stay Claude-only. Do not
  pretend they work for Cursor.
- ACP `session/new` has no system-prompt field. The persona is prepended to the user message.
- Model ids come from that session's catalog. Do not hardcode Composer or Grok ids; they change.
- Tests must not need a Cursor login or a live agent. Fake the ACP process, as `test/cursor-acp.test.ts` does.

**opencode** (`src/providers/opencode.ts`) is `opencode acp`, the same Agent Client Protocol
Cursor speaks, so `server.ts` shares the session, model and resume plumbing between both
(`acpBrain`, `resumeAcp`). Spawn `opencode`; `--pure` keeps external plugins out of the run. A
command named `agent` is not necessarily that binary.

- opencode's own permission defaults are permissive, so every start is given an isolated config
  (`opencodeConfig()` in `src/providers/opencode-acp.ts`, sent as `OPENCODE_CONFIG_CONTENT`): Ask
  everywhere, the pre-approved reads allowed, and chat mode asks for every tool and is told to refuse
  (a blanket deny made opencode's free "Big Pickle" model answer that its free tier works only inside
  opencode, so chat mode is `ask` with the refusal on the provider side). Keep the isolation
  env (`OPENCODE_DISABLE_PROJECT_CONFIG=1`) that leaves the project's config, plugins and MCP
  servers unloaded.
- Approvals are the same `session/request_permission` card as Cursor; the permission parser is
  shared (`permissionResult` in `cursor-acp.ts`). Auto and Accept edits stay Claude-only. There is
  no opencode `--force`, so Run Everything is not a flag: the opt-in **Everything** permission mode
  hands opencode a `{"*": "allow"}` permission config (`opencodeConfig()`), stays out of memory
  after a restart, and switches between the modes by restarting the process (the launch key covers
  the config). The menu is Ask, Plan and Everything.
- `session/new` answers `configOptions` (a `model` option with `provider/model` values, plus a
  `mode` option) instead of Cursor's `models`; `parseModels` handles both shapes. Do not hardcode
  opencode model ids; they change.
- opencode authenticates with the credentials it already stores, so `initialize` alone suffices;
  do not start an `authenticate` login flow.
- Tests must not need an opencode login or a live agent. Fake the ACP process, as
  `test/opencode-acp.test.ts` does.
- **One-click install** (`src/install-opencode.ts`: Windows, macOS and Linux, x64 and arm64; the Linux build is the glibc one, so musl systems fall back to the manual install): when opencode is missing the page shows a card (from the Brain menu, and
  on connect in basic mode). It names GitHub, the size and the folder, and fetches nothing until the button is pressed. The install downloads the
  **pinned** release, checks its SHA-256, unpacks it with the system's `tar` (zip on Windows and macOS, tar.gz on Linux), runs it to see the pinned version, and moves it into
  `data/tools/opencode-<version>/`. It never touches the PATH or a copy the user installed; `brainProgram("opencode")` is `OPENCODE_BIN`, then
  that copy, then the plain name. The `install-brain` message is refused from a phone (it fetches and runs a program). Keep it opt-in, keep the
  checksum, and keep the pin out of reach of `latest` (see "Before a release" below). Tests fake the network and the unpacker; nothing is downloaded.

**Ollama** (`src/providers/ollama.ts`, tools in `ollama-tools.ts`) is chat, and work mode for models that take
tool calls. Ollama only runs the model, so the tools and the call loop are ours: `read_file`, `grep`,
`bash`, `write_file` (new files) and `edit_file` (replace exact text once, or all of it with `replace_all`), run in the project folder with paths checked against the folder (symlinks followed).

- `canUseTools` is true only when `/api/show` lists the `tools` capability, the model is a known family
  (an Ollama too old to report capabilities), or the user vouches with `COMPANION_OLLAMA_TOOLS`.
  Check it again when the model changes (`checkTools()`); never assume it.
- Every `bash` command, `write_file` and `edit_file` goes through the approval card (`permission` events); only
  Read and Grep are pre-approved, from the same allow-list as the other brains. The menu is Ask and Plan
  (plan offers the read-only tools only). There is no looser mode for Ollama: do not add one, and do not
  add a skip-approval path. "Allow for this session" covers every later `write_file` or `edit_file` in the same project folder (those tools cannot leave it), but a `bash` command only as written; changing the folder or resetting the conversation ends the grant.
- Keep the turn cap (`MAX_TOOL_ROUNDS`), the result and file size caps, and the experimental warning in
  the README, the site and the work-mode notice: how well a local model uses tools is the user's own
  responsibility, and the app does not vouch for any model.
- A history with a tool call but no answer to it is invalid for Ollama; keep `trimHistory` and the stop
  handling dropping such calls.
- With Ollama as the brain and no model named, the first installed one is used (`refreshOllamaModels`, in memory). A message that cannot be
  sent yet (no model, Ollama not running) is neither sent nor kept in the log (`notReady` in `src/turn-service.ts`).
- Tests fake the Ollama server (`test/ollama-work.test.ts`, `test/server.test.ts`); no real model or install in CI.

**Basic mode** (`src/providers/scripted.ts`) is what runs when the chosen command-line brain is not installed (or, on a first start, none is):
the browser demo's rule-based reader (`public/script.js`, shared with `demo/`) answers with the same tags a model writes. It has no tools, so
no work mode and nothing to approve; it opens with a greeting that says it is a script and how to get a brain (opencode first), and never
passes for a model. It is a state of the server (`basicMode`, in `mode.basic`), not a saved provider: nothing is written to settings for it,
its transcript is saved as `"basic"` and dropped once a real brain runs, and choosing a real brain in the menu ends it. On a first start another
installed brain is used instead, in memory only; a brain the user chose that has since gone missing is not swapped.

Switching brains starts a new conversation. The brains do not share memory.

### Branches and releases

- **`main` is released code and `dev` is where work happens.** Commit to `dev`. Merge `dev` into `main` only
  when the owner says to release and the checks below pass on it. Never push `main` or a tag unasked.
- **Every push to `main` is a release with a new version.** The last commit on `dev` before the merge raises
  `version` in `package.json` (a minor number for a feature, a patch number for a fix or a docs-only change;
  the project is 0.x). The bump goes into `package-lock.json` too (`npm install --package-lock-only`; `test/lockfile.test.ts` and CI fail
  otherwise: a lockfile npm would rewrite makes a fresh clone look modified). After the merge, tag that commit on `main` with an
  annotated `vX.Y.Z` and push `main` and the tag together. Release notes are optional. The tag push builds the installers (`.github/workflows/release.yml`) and attaches them to the release, which stays a draft until the owner publishes it; `app/package.json` needs the same version as the root one.
- **`main` pins only a creator tag that exists** on the creator's remote (`package.json`), because a fresh
  clone gets `main`. The creator has the same `dev` and `main` flow and tags its own releases. Work that needs
  unreleased creator code runs against the creator's `dev` through `CREATOR_SRC`, and the pin moves to the new
  tag in the release commit.
- **Before a release, sanity check the opencode pin** (`OPENCODE_PIN` in `src/install-opencode.ts`: the one version, file names, sizes and SHA-256 the
  one-click install fetches). It is pinned on purpose, so it does not move by itself and nothing checks it for you. Look at whether the pinned release is
  still the one you want: `gh release view v<pinned> -R anomalyco/opencode` (it must still exist and the assets and checksums must still match; compare
  `gh api repos/anomalyco/opencode/releases/tags/v<pinned> --jq '.assets[] | "\(.name) \(.size) \(.digest)"'` with the table), the newest release's notes
  (a breaking change to `opencode acp`, which `src/providers/opencode.ts` speaks, or a security fix is a reason to move the pin), and that the pinned
  program still works with this version of the app (install it through the page on a clean `ANAICO_DATA`, pick opencode, send a message). To move the
  pin: change the version and, for each asset (`win32-*`, `darwin-*`, `linux-*`), the name, `bytes` and `sha256` (the digest GitHub shows for the asset), run
  `node --test test/install-opencode.test.ts`, and do the install by hand once. Never point it at `latest`. A new platform is a new row in the table,
  tried on that platform.
- **The documentation site and the README describe released behaviour.** The site (`site/`) is built from
  `main` by `.github/workflows/pages.yml`, together with the demo (staged into `demo/` with the creator at its pinned release), so write a
  change's documentation on `dev` and let the release publish it. The clone commands in the README and on the getting-started page take the
  pinned creator release (`git clone --branch <ref>`); `test/docs.test.ts` checks them against `package.json`.
- **When the owner's own app runs from a checkout, leave that checkout on `main`.** The server serves `public/`
  from disk, so switching branches under a running app changes the page it serves. Work on `dev` in a second
  worktree (`git worktree add ../anime_ai_companion-dev dev`, then link `node_modules` into it).
- **Pull requests from other people go to `dev`.**

### Checks

```bash
npm run typecheck
npm test
```

`./check.sh` runs both the way CI does (plus the lockfile check) and fails on skipped tests, uncommitted files or a creator that is not at the
pinned tag; `./check.sh --full` is the release set (oldest Node, docs site, staged demo). Run it before every push; `--install-hook` makes
git do so (`.githooks/pre-push`, which runs `--full` for a push to `main`).

`npm run typecheck` also checks the page's JavaScript (`public/*.js`, `tsconfig.frontend.json`, loosely: no strict mode,
and `$("id")` is typed `any`). The `.d.ts` files next to those modules are what the page and the tests import, so keep them
in step. Renderer tests look for `../anime-character-creator/ts/src` (or `CREATOR_SRC`, which is that folder, the creator's TypeScript)
and skip if it is missing. No Python is involved (`pyproject.toml` and `.python-version` are only for the optional picture-pack tools). `test/server.test.ts` runs a throwaway copy of the whole app (its own `data/`, a random port) against a stand-in
`claude` and a fake Ollama (`test/helpers/server.ts`) and drives it over the websocket: queueing, cards, notes, skills,
work mode, the shell opt-out, local tools and the origin check. It is the net for changing `src/server.ts`, and it needs the
creator's TypeScript like the renderer tests (it skips without it). Add a test there when you change what the page is
told. Keep new tests passing without a Claude, Cursor or opencode login. Nothing is skipped on Windows: a fake `claude`, `opencode` or `cursor-agent`
is a Node script written with `writeStandIn` (`test/helpers/standin.ts`; on Windows it becomes a real `.exe` launcher, because a script cannot be
started by name and a `.cmd` cannot carry `claude`'s long multi-line arguments), a test that has to say something in a system's own words
(a shell command, a permission bit, a path) branches on `process.platform` inside the test, and scratch folders are removed with `removeDir`
(`test/helpers/platform.ts`), because Windows will not delete a folder a program has only just left. Edit files with a tool that keeps their
encoding (no byte order mark, no re-encoded characters): `Set-Content` in Windows PowerShell does both. `test/browser-demo.test.ts` drives the demo's stand-in server
against a fake renderer and a fake model and checks the staged folder; `test/demo-stage.test.ts` stages the demo for real and checks that it has no Python, is under 2 MB
and draws the server's bytes from its compiled modules; `test/frame-pack.test.ts` and `test/pack-avatar.test.ts` cover packs and
the pose pictures. Before a release also run the suite against a clean checkout of the pinned creator release (`CREATOR_SRC=<its ts/src> npm test`)
and on the oldest Node (`npx --yes node@22.18 --test "test/**/*.test.ts"`).

To watch a change work without touching anyone's real `data/`, run a copy of the repo with its own
`data/`, a spare `PORT`, and (for the Claude brain) a stand-in `claude` first on the `PATH`.

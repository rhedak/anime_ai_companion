# Notes for agents

A local anime companion. The browser talks to a Node server; a provider is the brain
(Claude Code, Cursor, or Ollama); a Python worker draws her. The README is the product
description; this file is what an agent needs beyond it. Find which of these the user wants:

- **Run it** (use the app): the first section.
- **Customise it** (their own persona, looks, colours, drawing): the second.
- **Change the app** (edit `src/` or `public/`, send a fix back): the third, and its constraints.

## Run it

You need Node 22.18+, Python 3.11+, and one brain: Claude Code (`claude` installed and signed in),
Cursor (`cursor-agent`), opencode, or Ollama. It runs on the user's own machine with their own login.

Clone both repos **side by side** (the drawing code is a separate repo):

```bash
git clone https://github.com/rhedak/anime-character-creator.git
git clone https://github.com/rhedak/anime_ai_companion.git
cd anime_ai_companion
npm install
uv sync          # only if `python3 --version` is older than 3.11: makes .venv, which the app then uses
npm start        # http://127.0.0.1:3737
```

- `npm link` puts the `anaico` command on the PATH. `anaico` starts in work mode for the folder it is run
  from and opens the browser; `anaico --chat`, `--daemon`, `--status`, `--stop`, `--restart`, `--doctor` are in the README.
- The server listens on `127.0.0.1` only. `PORT` changes the port; `COMPANION_PROVIDER` is
  `claude`, `cursor` or `ollama` (also switchable in the page). The README has the full table.
- Everything personal is in `data/` (settings, chat log, her current look, `custom.css`) and `workspace/`.
  Both are git-ignored and belong to the user: do not delete or reset them without asking.
- If the creator is not found next to this repo, the app clones a pinned copy into `~/.anaico/creator/`.
  Point `CREATOR_SRC` at the creator's `src` folder to use another one.

When it does not start: run `anaico --doctor` (or `node bin/anaico.js --doctor`; it only looks and says what is missing), or check `python3 --version` (the creator needs 3.11+; run `uv sync`, or set `PYTHON`),
that `claude` (or `cursor-agent`) is on the PATH and signed in, and that the port is free. In daemon mode the
log is `data/server.log`.

## Customise it

Keep the user's changes where updates do not overwrite them, and tell them when a change needs a restart.

| To change | Edit | Takes effect |
| --- | --- | --- |
| Her personality and voice | `persona.md` (chat), `persona-work.md` (work-mode rules) | restart the server; for Claude also start a new conversation (`/clear`), because an existing one keeps the prompt it began with |
| Her name | click it, or `/rename Hana` | at once |
| A ready-made character | `/card import <file.png\|.json>` (a V1, V2 or V3 character card); `/card export`, `/card reset` | a new conversation (`/clear`) |
| What she remembers about the user | `data/memory.md` (she adds to it herself in chat; `/memory`) | with her next message |
| Her look | ask her in chat, or `COMPANION_PRESET` for the starting character | at once |
| Her expressions | `emotions.json` | restart the server |
| The interface | `data/custom.css` (variables in `public/theme.css`) | reload the page |
| Models, pre-approved tools | `data/settings.json`, `COMPANION_MODEL`, `COMPANION_WORK_MODEL` | restart the server |
| How the body is drawn: shapes, hairstyles, outfits, presets | the **creator repo**, not this one | restart the server (the renderer runs as long as it does) |

- `persona.md` carries the tag protocol (`[emotion:…]`, `[gesture:…]`, `[avatar …]`, `[image …]`) that drives
  her face. Keep it, and keep its emotion list in step with `emotions.json`.
- To change drawing, work in the creator checkout next to this repo (or wherever `CREATOR_SRC` points). Do not
  install it: the renderer imports it by path, so edits are picked up on the next server start, and an
  installed copy would only be a second source of truth. This repo's `package.json` pins a creator tag, and a
  checkout of the creator's `main` may be ahead of it. If the user forks, point that pin at their fork.
- The creator has its own `uv` environment for its tests and linting; that is separate from this repo's `.venv`.
- A change to behaviour (`src/`, `public/`) is the next section. It is fine, but the safety rules below
  still hold for a personal fork.

## Change the app

### How it is built

- Node runs the TypeScript directly. There is no build step. `npm start` is `node src/server.ts`;
  the `anaico` command is `src/cli.ts`, which starts (or reuses) that server and opens the browser.
- `src/providers/types.ts` is the brain interface. A new brain implements `Provider` and nothing
  in the page should need to know how that process speaks.
- Her face, voice, and the chat log are driven by plain-text tags in the reply
  (`[emotion:…]`, `[gesture:…]`, `[avatar …]`, `[image …]`). The server strips them. Keep that
  protocol provider-agnostic.
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
  Keep it a single append-only file the user can see, edit and clear.
- Speech input is the one place audio leaves the machine (the browser's recognition sends it to the browser
  maker). It stays opt-in, asks first and says who receives it, listens one phrase at a time, and never
  sends the text by itself.
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

**Ollama** (`src/providers/ollama.ts`, tools in `ollama-tools.ts`) is chat, and work mode for models that take
tool calls. Ollama only runs the model, so the tools and the call loop are ours: `read_file`, `grep`,
`bash`, `write_file` (new files) and `edit_file` (replace exact text once, or all of it with `replace_all`), run in the project folder with paths checked against the folder (symlinks followed).

- `canUseTools` is true only when `/api/show` lists the `tools` capability, the model is a known family
  (an Ollama too old to report capabilities), or the user vouches with `COMPANION_OLLAMA_TOOLS`.
  Check it again when the model changes (`checkTools()`); never assume it.
- Every `bash` command, `write_file` and `edit_file` goes through the approval card (`permission` events); only
  Read and Grep are pre-approved, from the same allow-list as the other brains. The menu is Ask and Plan
  (plan offers the read-only tools only). There is no looser mode for Ollama: do not add one, and do not
  add a skip-approval path. "Allow for this session" covers that exact call only.
- Keep the turn cap (`MAX_TOOL_ROUNDS`), the result and file size caps, and the experimental warning in
  the README, the site and the work-mode notice: how well a local model uses tools is the user's own
  responsibility, and the app does not vouch for any model.
- A history with a tool call but no answer to it is invalid for Ollama; keep `trimHistory` and the stop
  handling dropping such calls.
- Tests fake the Ollama server (`test/ollama-work.test.ts`); no real model or install in CI.

Switching brains starts a new conversation. The brains do not share memory.

### Branches and releases

- **`main` is released code and `dev` is where work happens.** Commit to `dev`. Merge `dev` into `main` only
  when the owner says to release and the checks below pass on it. Never push `main` or a tag unasked.
- **Every push to `main` is a release with a new version.** The last commit on `dev` before the merge raises
  `version` in `package.json` (a minor number for a feature, a patch number for a fix or a docs-only change;
  the project is 0.x). After the merge, tag that commit on `main` with an annotated `vX.Y.Z` and push `main`
  and the tag together. Release notes are optional.
- **`main` pins only a creator tag that exists** on the creator's remote (`package.json`), because a fresh
  clone gets `main`. The creator has the same `dev` and `main` flow and tags its own releases. Work that needs
  unreleased creator code runs against the creator's `dev` through `CREATOR_SRC`, and the pin moves to the new
  tag in the release commit.
- **The documentation site and the README describe released behaviour.** The site (`site/`) is built from
  `main` by `.github/workflows/pages.yml`, so write a change's documentation on `dev` and let the release
  publish it.
- **When the owner's own app runs from a checkout, leave that checkout on `main`.** The server serves `public/`
  from disk, so switching branches under a running app changes the page it serves. Work on `dev` in a second
  worktree (`git worktree add ../anime_ai_companion-dev dev`, then link `node_modules` and `.venv` into it).
- **Pull requests from other people go to `dev`.**

### Checks

```bash
npm run typecheck
npm test
```

`npm run typecheck` also checks the page's JavaScript (`public/*.js`, `tsconfig.frontend.json`, loosely: no strict mode,
and `$("id")` is typed `any`). The `.d.ts` files next to those modules are what the page and the tests import, so keep them
in step. Renderer tests look for `../anime-character-creator` (or `CREATOR_SRC`, which is that repo's `src`
folder) and skip if it is missing. The creator needs Python 3.11 or newer. `uv sync` creates `.venv`
(`pyproject.toml`, `.python-version`), and `src/python.ts` uses it when it exists, unless `PYTHON` is set;
on an older `python3` the four avatar and render tests fail even though the code is fine. `test/server.test.ts` runs a throwaway copy of the whole app (its own `data/`, a random port) against a stand-in
`claude` and a fake Ollama (`test/helpers/server.ts`) and drives it over the websocket: queueing, cards, notes, skills,
work mode, the shell opt-out, local tools and the origin check. It is the net for changing `src/server.ts`, and it needs the
creator and Python 3.11+ like the renderer tests (it skips without them). Add a test there when you change what the page is
told. Keep new tests passing without a Claude, Cursor or opencode login.

To watch a change work without touching anyone's real `data/`, run a copy of the repo with its own
`data/`, a spare `PORT`, and (for the Claude brain) a stand-in `claude` first on the `PATH`.

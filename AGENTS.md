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
  from and opens the browser; `anaico --chat`, `--daemon`, `--status`, `--stop`, `--restart` are in the README.
- The server listens on `127.0.0.1` only. `PORT` changes the port; `COMPANION_PROVIDER` is
  `claude`, `cursor` or `ollama` (also switchable in the page). The README has the full table.
- Everything personal is in `data/` (settings, chat log, her current look, `custom.css`) and `workspace/`.
  Both are git-ignored and belong to the user: do not delete or reset them without asking.
- If the creator is not found next to this repo, the app clones a pinned copy into `~/.anaico/creator/`.
  Point `CREATOR_SRC` at the creator's `src` folder to use another one.

When it does not start: check `python3 --version` (the creator needs 3.11+; run `uv sync`, or set `PYTHON`),
that `claude` (or `cursor-agent`) is on the PATH and signed in, and that the port is free. In daemon mode the
log is `data/server.log`.

## Customise it

Keep the user's changes where updates do not overwrite them, and tell them when a change needs a restart.

| To change | Edit | Takes effect |
| --- | --- | --- |
| Her personality and voice | `persona.md` (chat), `persona-work.md` (work-mode rules) | restart the server; for Claude also start a new conversation (`/clear`), because an existing one keeps the prompt it began with |
| Her name | click it, or `/rename Hana` | at once |
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
- Work mode shows the exact command or file change and waits, unless the user has chosen a
  looser mode. Do not add a skip-permissions flag, and do not make a loose mode the default.
- Permission mode is memory only. Every server start comes back to Ask.
- Home and `/` are refused as a project folder.
- A folder's own hooks, settings, and MCP servers stay unloaded unless the user opts in, and
  that opt-in is off at every start. Do not write hooks into their project or their home config.
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
  everywhere, the pre-approved reads allowed, and chat mode denies every tool. Keep the isolation
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

**Ollama** is chat only (`canUseTools` is false). Work mode stays unavailable.

Switching brains starts a new conversation. The brains do not share memory.

### Checks

```bash
npm run typecheck
npm test
```

Renderer tests look for `../anime-character-creator` (or `CREATOR_SRC`, which is that repo's `src`
folder) and skip if it is missing. The creator needs Python 3.11 or newer. `uv sync` creates `.venv`
(`pyproject.toml`, `.python-version`), and `src/python.ts` uses it when it exists, unless `PYTHON` is set;
on an older `python3` the four avatar and render tests fail even though the code is fine. Keep new tests
passing without a Claude, Cursor or opencode login.

To watch a change work without touching anyone's real `data/`, run a copy of the repo with its own
`data/`, a spare `PORT`, and (for the Claude brain) a stand-in `claude` first on the `PATH`.

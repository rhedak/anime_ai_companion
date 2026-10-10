# Anime AI Companion

A local, browser-based anime companion who is **drawn by code and driven by Claude Code**.
Chat with her, and ask her to redesign herself right in the conversation: new hair, a witch
hat, glasses. Her face is a real vector character whose expression, blinking and mouth are
redrawn as she talks.

```
browser ──ws── Node server ──┬─ `claude -p` (stream-json)   the brain and persona
                             └─ python render_worker.py      draws her, via anime-character-creator
```

It is free to use, change and share (MIT). Everything runs on your machine; the only thing that
leaves it is the conversation your own `claude` sends to Anthropic.

## Requirements

- **Node.js 22.18 or newer** (it runs the TypeScript directly, no build step)
- **Python 3.11 or newer** (the character renderer is pure standard-library Python)
- **[Claude Code](https://code.claude.com)**, installed and signed in (`claude` on your PATH)
- A checkout of **[anime-character-creator](https://github.com/rhedak/anime-character-creator)**
  next to this repo, or point `CREATOR_SRC` at its `src` folder

## Quick start

```bash
git clone https://github.com/rhedak/anime-character-creator.git
git clone https://github.com/rhedak/anime_ai_companion.git
cd anime_ai_companion
npm install
npm start          # then open http://127.0.0.1:3737
```

Try: *"Hi! Could you change your hair to mint green and put on a black witch hat?"*

## Configuration

| Env var | Default | |
| --- | --- | --- |
| `COMPANION_MODEL` | `haiku` | model used for chat |
| `COMPANION_WORK_MODEL` | `sonnet` | model used in work mode |
| `COMPANION_PROVIDER` | `claude` | `claude` (Claude Code) or `ollama` (local models); also switchable in the UI |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | where Ollama is listening |
| `OLLAMA_MODEL` | first installed | model to use with Ollama |
| `COMPANION_PRESET` | `linnea` | starting character (any preset of the creator) |
| `CREATOR_SRC` | `../anime-character-creator/src` | where the creator package lives |
| `PORT` | `3737` | |
| `COMPANION_NO_NUDGE` | unset | set to `1` to silence the friendly reminder below |

## Voice

The **Voice** button makes her read her replies aloud with your browser's own speech synthesis:
local voices, nothing is uploaded. She speaks sentence by sentence while the reply streams, and her
mouth moves while she speaks. Speech *recognition* is deliberately not included: Chrome's version sends
your audio to Google, which would break the "stays on your machine" promise.

## Looks: undo, save, load

She can redesign herself at any time, so it is reversible: **Undo** steps back through her recent
changes, **Save look** stores the current look by name, and the **Looks** menu loads one. She can load
a saved look herself too (`[avatar load=name]`). Saved looks are plain files in `data/looks/`; delete a
file to delete a look.

## Local models with Ollama

Pick **Ollama (local)** under *Brain* and she is powered by a model on your own machine: nothing
leaves it at all. Install [Ollama](https://ollama.com), `ollama pull llama3.2` (or any chat model),
and choose the model in the dropdown. The same persona and the same `[emotion:...]` / `[avatar ...]`
tags drive the avatar, though small models follow the tag protocol less reliably. Ollama is chat
only: no tools, so Work mode is unavailable with it. Switching brains starts a fresh conversation.

## Work mode

Flip the **Work** switch, pick a project folder, and she can read and edit files and run commands
there, like a regular Claude Code session. She asks first:

- Every action that is not pre-approved shows an approval card with the **exact** command or file
  content. Choose *Allow once*, *Allow for this session*, or *Deny*; a denial is not retried.
- The **Permissions** menu changes how approvals work: *Ask for each action* (the default),
  *Plan first* (she reads and proposes a plan; nothing changes until you approve it), *Accept edits*
  (file edits no longer ask; commands still do), and *Auto* (Claude Code's own classifier approves
  routine actions and blocks risky ones, so fewer cards reach you). It resets to *Ask* on every start
  and cannot be changed mid-reply; changing it keeps the conversation.
- Pre-approved without asking: `Read`, `Grep`, `Glob` (edit in `data/settings.json`).
- Your folder's own `.claude/settings*.json` hooks and rules are **not** loaded in this mode, and
  the home directory or `/` cannot be chosen as a folder.
- Work mode uses a stronger model (`COMPANION_WORK_MODEL`, default `sonnet`) and counts against your
  plan limits faster than chatting.
- The bar under the header shows `claude --resume <session id>`: you can continue the same
  conversation in a terminal. Only one side should write at a time.

`anaico` starts in work mode for the folder you ran it from (a home directory or `/` falls back to
chat). `anaico --chat` starts in chat mode instead; the folder is still pre-filled, so the **Work**
switch is one click. A server started another way (`npm start`) begins in work mode only if it has a
saved folder, and in chat mode otherwise. A server that is already running keeps its mode and folder.

## Pro mode: your own terminal session

Prefer your normal terminal? Keep the server running (`npm start`), then start Claude Code *with the
companion attached*, in whatever project you like:

```bash
cd ~/my-project
npm --prefix ~/anime_ai_companion run attach -- --permission-mode auto   # extra args go to `claude`
```

The browser now talks to **that** session: your messages arrive in it as `<channel>` events, and she
answers through a `reply` tool, so she speaks, emotes and changes her look in the browser while you
keep the full terminal UI. Permissions are handled in the terminal, exactly as in any Claude Code
session (including auto mode). Close the session and the browser returns to chat mode.

What to expect: it uses Claude Code's *channels*, a research-preview feature, so Claude Code asks you
once per start to confirm the development channel (choose "I am using this for local development") and
shows a harmless "no MCP server configured with that name" line. It needs a claude.ai login (Pro is
fine) and an interactive session, not `-p`. Replies arrive whole instead of streaming. The channel is
a local shim (`src/channel-shim.ts`) that talks to the server over `127.0.0.1` with a random token in
`data/attach-token`; only one terminal can attach at a time.

## How it works

- **Gestures:** `[gesture:wave]` and `[gesture:cheer]` raise an arm for a moment (two pose frames).
- **Emotions:** she starts replies with tags like `[emotion:happy]`; `emotions.json` maps each to
  face settings. The server renders a few mouth openings and a blink per emotion and the browser
  flips between them while text streams.
- **Looks:** she writes `[avatar hair_color=#ff88cc outfit.hat_color=#222 glasses=true]`.
  `python/render_worker.py` validates every key; rejected ones are reported back to her on her next
  turn. Your current look is saved in `data/avatar.json` (git-ignored).
- **Providers:** `src/providers/types.ts` is the interface and Claude Code is the first
  implementation. The tags are plain text, so other backends (for example Ollama) can reuse them.
- The server listens on `127.0.0.1` only and rejects WebSocket connections from other origins.

The roadmap is in [docs/plan.md](docs/plan.md).

## Using it with your Claude account

This project runs **on your own computer, with your own unmodified `claude` and your own login**.
Please keep it that way:

- Do not host it as a service for other people, and do not build anything that collects, stores
  or relays Claude credentials. Anthropic's terms do not allow routing other people's requests
  through a subscription. See the
  [Claude Code legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance).
- Plan limits assume ordinary individual use; a companion who chats all day uses them up faster
  than you might expect.
- Prefer an API key? Claude Code supports `ANTHROPIC_API_KEY`; this project does not change that.
- This is an independent project, **not affiliated with or endorsed by Anthropic**.

## Sharing improvements (a friendly request, never a requirement)

The licence lets you do anything with this code, and that is the point. If you improve it, or fix
something in your checkout of [anime-character-creator](https://github.com/rhedak/anime-character-creator),
a pull request would make it better for everyone, and it is very welcome. Small ones are great.
See [CONTRIBUTING.md](CONTRIBUTING.md). If either checkout has local changes, the server mentions
this once a week at startup (local check only, no network); `COMPANION_NO_NUDGE=1` turns it off.

## Security model

Because the server can run Claude Code, it is built to be reachable only by you:

- It listens on `127.0.0.1` and accepts WebSocket connections only from its own origin; the terminal
  link needs a random token (`data/attach-token`, mode 0600) and refuses anything that looks like a browser.
- The page ships a strict Content-Security-Policy (no inline or foreign scripts, no framing, so nobody can
  click the approval buttons for you).
- Everything the model chooses is validated: avatar values are coerced per field (hex colours, numbers,
  plain-text only for free text), even though the character renderer now escapes text itself (older
  checkouts of it did not). The SVG is also sanitised in the browser before it is shown.
- Work mode never skips permissions (even *Auto* leaves risky actions to Claude Code's safety checks), shows the exact command or content you approve, and does not load a
  folder's own hooks or settings.

Found something? Please open an issue, or report it privately if it is serious.

## Credits

- Characters are drawn by **[anime-character-creator](https://github.com/rhedak/anime-character-creator)**
  (MIT), a program that draws them from parametric shapes, not by hand and not by image generation.
  Please keep saying so if you share what it makes.
- [`ws`](https://github.com/websockets/ws) for WebSockets.

## Licence

[MIT](LICENSE).

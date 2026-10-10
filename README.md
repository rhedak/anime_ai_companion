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
changes, **Save look** stores the current look by name, and the **Looks** menu loads one, or opens **Presets…**, a gallery with a preview of each of the 19 built-in characters (Undo brings the old look back). She can load
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
  and can be changed at any time, even while an approval card is waiting; the conversation carries on.
  Approval cards also offer *Allow, and accept all edits* (for file edits) and *Allow, and switch to
  Auto*, like the terminal's "yes, and don't ask again".
- Pre-approved without asking: `Read`, `Grep`, `Glob` (edit in `data/settings.json`).
- By default your own Claude Code setup is **not** loaded: a folder's `.claude/settings*.json` hooks
  and allow rules, your user settings and MCP servers do not apply, so opening an unfamiliar folder
  runs nothing of its own. The **Use my Claude Code setup** checkbox (or `/setup on`) loads them, as
  in a terminal; hooks run commands, so it is off at every start. The home directory or `/` cannot be
  chosen as a folder.
- Work mode uses a stronger model (`COMPANION_WORK_MODEL`, default `sonnet`) and counts against your
  plan limits faster than chatting.
- The bar under the header shows `claude --resume <session id>`: you can continue the same
  conversation in a terminal. Only one side should write at a time.

`anaico` starts in work mode for the folder you ran it from (a home directory or `/` falls back to
chat). `anaico --chat` starts in chat mode instead; the folder is still pre-filled, so the **Work**
switch is one click. A server started another way (`npm start`) begins in work mode only if it has a
saved folder, and in chat mode otherwise. A server that is already running keeps its mode and folder.

### Running it in the background

`anaico --daemon` starts the server in the background and returns; it keeps running after you close the
terminal (its output goes to `data/server.log`). Take the same `--chat` and `--no-open` as usual.
`anaico --status` says whether it is running, `anaico --stop` stops it, and `anaico --restart` stops and
starts it again in the folder you run it from (use it after an update, or to change folder or mode).
Only a server started with `--daemon` is managed this way: `--stop` and `--restart` will not touch one
that is running in another terminal. The server only listens on `127.0.0.1`, and a background server is
no different.

## Changing how it looks

All colours, fonts, corner radii and sizes of the interface are CSS variables at the top of
[`public/theme.css`](public/theme.css), with a comment on each. `public/style.css` only uses them.
To restyle it, put your changes in **`data/custom.css`** (create it; it is yours, git ignores it, updates
never overwrite it, and deleting it restores the default look). It loads last and a page reload shows
the change, so you can simply ask an AI assistant: "edit `data/custom.css` to make the chat panel light
with a blue accent and rounded corners; the variables are documented in `public/theme.css`".

```css
:root { --accent: #4f9d69; --surface: #22302a; --panel: #17201c; --radius-lg: 6px; --font-heading: "Courier New", monospace; }
```

Anything the variables do not cover can be restyled with ordinary CSS rules in the same file. Mio's own
appearance (hair, clothes, face) is separate: ask her to change it in chat.

## How her replies are shown

Her replies render a small, safe Markdown subset: paragraphs, headings, **bold**, *italic*, `code`,
code blocks, lists, quotes and http(s) links. It is built from plain DOM nodes, never HTML, so
nothing she writes can inject markup. `/copy` and `/export` keep the Markdown source. The speech bubble
over her head and spoken replies stay plain text.

## The usage line

Under the message box a small line shows the model and its effort, e.g. `Sonnet 5.5 (high)`, your Claude **session** (five-hour) and **week**
usage with their reset times, and **ctx**, how full her memory of this conversation is (`/compact` frees
it up). Numbers turn amber above 80% and red above 95%. The limits come from Claude Code after each
reply, so they are shown dimmed when they are over ten minutes old, and only for a Claude subscription;
with Ollama only the model is shown. Colours are theme variables (`--warn-text`, `--error-text`).

## Effort

The **Effort** menu (or `/effort low|medium|high|xhigh|max|default`) sets how hard Claude thinks; more
is slower and uses more of your limits. Her sessions do not load your Claude Code settings (so a
folder's hooks and rules never run), with one exception: for *Default* the effort level in your own
`~/.claude/settings.json` (`effortLevel` and `modelSettings`) is read, so she thinks as hard as your
terminal does, and the footer shows it. Changing it restarts her process and the conversation carries on.

## Images

The **📎** button next to the message box attaches up to 5 pictures (PNG, JPEG, GIF or WebP, up to 5 MB
each); you can also paste an image or drop files onto the chat. The browser shrinks anything bigger
than 1568 px on its long edge first (a resized GIF or WebP loses its animation), and the server checks
the type, the real file contents and the sizes again. Pictures go to the model as they are and a picture
without text works too. Only a count is kept in the saved chat log, so after a reload the thumbnails give
way to "🖼 2 images". With Ollama they need
a vision model (e.g. `llava`), and only the message that carries them sees them.

## Slash commands

Type these in the chat box (`/help` lists them):

| Command | |
| --- | --- |
| `/compact [focus]` | summarise the conversation to free up context; she keeps the gist |
| `/clear`, `/new` | start a fresh conversation, like **New chat** |
| `/resume [number]` | list earlier conversations in the current folder (newest first), or continue one; the chat log is rebuilt from Claude Code's own session file |
| `/cost` | what the conversation has used: an API-price estimate and how full the context is |
| `/model [name]` | show or set the model for the current mode (`/model opus`), until the server restarts |
| `/chat`, `/work [folder]` | switch modes |
| `/permissions [ask\|plan\|accept\|auto]`, `/plan` | the Permissions menu, from the keyboard |
| `/rc`, `/remote-control` | not built in: explains why and prints the terminal command to use it yourself |
| `/rewind` | not available in the companion: prints the terminal command to continue there and rewind |
| `/effort [level]` | show or set how hard she thinks (restarts her process; the conversation continues) |
| `/setup [on\|off]` | work mode: load your own Claude Code settings, hooks and MCP servers (off at every start) |
| `/status` | brain, model, mode, folder and session id |
| `/copy` | copy her last reply to the clipboard |
| `/export` | download the conversation as a Markdown file |
| `/voice` | turn spoken replies on or off |

`/resume` looks in the folder she is working in (the project folder in work mode, her own `workspace/`
in chat mode), so it also finds sessions you started in a terminal there; switch modes first to look
elsewhere. It is refused mid-reply and with Ollama.

Anything else that looks like `/word` is reported as unknown instead of being sent to her; paths like
`/etc/hosts` are sent as usual. Commands that change settings are refused mid-reply. Commands that
need Claude Code (`/compact`, `/cost`, `/resume`, `/work`, `/permissions`, `/plan`, `/rc`, `/rewind`) say
so plainly when another brain, such as Ollama, is active, instead of pretending to work.


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

- It listens on `127.0.0.1` and accepts WebSocket connections only from its own origin.
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

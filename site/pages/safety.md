---
description: What the server can do, how it is locked down, and what leaves your computer.
---

# Safety and privacy

The server can run an agent that edits files and runs commands, so it is built to be reachable only by you.

## What leaves your computer

Only the conversation your own brain sends to its provider: for Claude Code, to Anthropic; for Cursor, to Cursor;
for opencode, to whatever model it uses. With Ollama nothing leaves at all. Files stay on this machine. The app has
no analytics and makes no network call of its own, except fetching the creator once if it is missing, and talking to
your Ollama host if you use one (by default on your own machine).

The one opt-in exception is **speaking to her**: the browser's speech recognition sends your recording to the browser
maker (Google, Microsoft or Apple) to be turned into text. It asks first, says who receives it, listens only while the
microphone button is lit, and this app's own server never receives audio.

## How the server is locked down

- **Local only.** It listens on `127.0.0.1` and accepts WebSocket connections only from its own origin. That stops any
  website you visit in your browser from talking to it. It does **not** stop other software on the same computer: a local
  program can send any `Origin` header, and on a shared computer another user could reach the port. So run it on a
  computer only you use. If you cannot, set `COMPANION_NO_SHELL=1` to turn off `!command` (the one way to run a command
  without a card), and remember that anyone who can reach the port can also answer approval cards, so do not use work
  mode there.
- **Phone access is the one exception**, opt-in at every start (`--lan`). Then every page, file and WebSocket from
  another device needs the secret token (a cookie, checked in constant time), a `Host` that is a local address or
  `.local` name (against DNS rebinding), and, for the WebSocket, a matching `Origin`. Such a device still cannot run
  `!commands`, loosen the permission mode, load your Claude Code setup or your skills, change her character, or choose another folder.
- **The page** ships a strict Content-Security-Policy: no inline or foreign scripts and no framing, so nobody can
  click the approval buttons for you.
- **Everything the model chooses is validated.** Avatar values are coerced field by field (hex colours, numbers,
  plain text only for free text), and the SVG is sanitised in the browser before it is shown. Nothing she writes is
  inserted as HTML.
- **Work mode never skips permissions.** Even *Auto* leaves risky actions to Claude Code's own safety checks. Cards
  show the exact command or content you approve. A folder's own hooks, settings and MCP servers stay unloaded unless
  you opt in. The home folder and `/` are refused as project folders.
- **Character cards are text from a stranger.** Her description, personality, scenario and examples are cleaned (markup and our own
  tags removed, lengths capped) and shown before they apply. Her greeting, the lorebook and the card author's own instructions
  are separate choices at import; the instructions are off by default, apply in chat and work mode once you choose them, and the
  import warns strongly, once. The expression protocol is never replaced by a card. Importing works from the computer only.
- **Her notes about you stay yours.** `data/memory.md` is one plain file you can read and edit. She proposes a note only in chat, never
  in work mode, and by default it is saved only when you keep it (a file or page she reads there could talk her into writing something that outlives the conversation), and the
  notes reach her as information, never as instructions.
- **Local models with tools are on you.** With Ollama, work mode (experimental) asks before every command, file write and
  edit, and has no looser mode. How well a local model behaves is up to the model and to you: the app does not vouch for any.
- **Loose modes are off at every start.** The permission mode, `/setup`, `/skills` and `--lan` all come back to the safe
  setting each time the server starts.

## Reporting a problem

Found something? Please open an [issue](https://github.com/rhedak/anime_ai_companion/issues), or report it
privately if it is serious.

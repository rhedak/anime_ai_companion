---
description: Every slash command you can type in the chat box.
---

# Slash commands

Type these in the chat box. `/help` lists them. Anything else that looks like `/word` is reported as unknown
instead of being sent to her, while paths like `/etc/hosts` are sent as usual.

| Command | What it does |
| --- | --- |
| `/help` | list the commands |
| `/compact [focus]` | summarise the conversation to free up context; she keeps the gist |
| `/clear`, `/new` | start a fresh conversation, like **New chat** |
| `/resume [number]` | list earlier conversations in the current folder (newest first), or continue one |
| `/cost` | what the conversation has used: an API-price estimate and how full the context is |
| `/model [name]` | show or set the model for the current mode, until the server restarts |
| `/chat`, `/work [folder]` | switch modes |
| `/permissions [ask\|plan\|accept\|auto\|everything]`, `/plan` | the permissions menu, from the keyboard |
| `/effort [level]` | show or set how hard she thinks (restarts her process; the conversation continues) |
| `/setup [on\|off]` | work mode: load your own Claude Code settings, hooks and MCP servers (off at every start) |
| `/chrome [on\|off]` | work mode: let her use your Chrome through the Claude in Chrome extension (off at every start; the extension must already be installed and signed into the same account) |
| `/persona [show \| edit \| reset]` | whose voice she speaks in (your own persona, the character of the pack that is on, or the default); `edit` opens your own `data/persona.md`, `reset` removes it (kept as `persona.md.bak`); both only on the computer |
| `/memory [add <note> \| forget <number\|all> \| edit \| ask \| auto \| off]` | her notes about you (`data/memory.md`); in chat she asks before saving one (`auto` saves with an Undo, `off` saves nothing), never in work mode |
| `/card import <file>` \| `apply` \| `cancel` \| `export` \| `reset` | character cards: use a card's personality, or export hers (`/card import` shows a preview first) |
| `/skills [on\|off]` | work mode: let her use your own skills by name; your user settings apply, hooks stay off (off at every start) |
| `/studio [on \| off \| backend <address> \| budget <dollars>]` | make a picture pack of your own with an image model (the pack studio, a draft maker; off at every start, only on the computer). `backend` sets the model's address (plain http on this computer, or `grok-web` / `gemini-web` / `chatgpt-web` for the Grok Imagine, Google Gemini or ChatGPT website driven through Claude in Chrome (it uses Claude Code and your Chrome), or `xai`, `gemini` or `openai` for a paid service, which needs `XAI_API_KEY`, `GEMINI_API_KEY` or `OPENAI_API_KEY` and counts every picture against `budget`); `on` checks it and opens the panel |
| `/rename [name \| reset]` | give her a name of your own (it wins over the name of a pack's character); `reset`, or the reset beside her name, goes back to the character's name, or Risa |
| `/frames [name\|off]` | show her with a [picture pack](picture-packs.html); alone, lists the packs |
| `/play [name] [end]` | play a short scene in chat (`/play` lists them; `/play key` is The spare key; `/play room` is a short story you are both trapped in, and the page asks you to wait while she writes it; `/play room 5 1 3 1` sets steps, hints, herrings and traps; a trap starts that room over; she explains the thread when you finish or `/play end`). In work mode, `/play` switches to chat |
| `/show` | she plays every emotion, a blink, talking and her gestures, naming each |
| `/phone [new\|off]` | the link and QR code for your [phone](phone.html); with phone access off it asks whether to turn it on (until the next start); `new` makes a new token, `off` turns it off |
| `/status` | brain, model, mode, folder and session id |
| `/restart` | restart the server. The page reconnects, and the conversation stays. Phone access and permissions go back to how they are at every start. Not from a phone |
| `/doctor` | check what the app needs (Node, the character creator, the brains, which opencode it uses, her data folder) and say what is missing and how to fix it; it only looks, changes nothing and is not available from a phone. Paste its output into a bug report |
| `/claude-login` | sign in to Claude Code again: it runs Claude Code's own `claude auth login`, which opens your browser (the app never sees your credentials), then checks `claude auth status`. When her login has expired the error says to use it; not available from a phone |
| `/install-opencode` | install the opencode this app was made for (a fixed version, checked against a known checksum) into the app's own folder, for the app only: it asks first, is used instead of any other opencode on the computer, and leaves yours untouched |
| `/copy` | copy her last reply to the clipboard |
| `/export` | download the conversation as a Markdown file |
| `/voice` | turn spoken replies on or off |
| `/rc`, `/remote-control` | not built in: explains why and prints the terminal command to use it yourself |
| `/rewind` | not available in the companion: prints the terminal command to continue there and rewind |

## Good to know

- `/resume` looks in the folder she is working in (the project folder in work mode, her own `workspace/` in chat
  mode), so it also finds sessions you started in a terminal there. It is refused mid-reply and with Ollama.
- Commands that change settings are refused mid-reply.
- Commands that need Claude Code (`/compact`, `/cost`, `/resume`, `/work`, `/permissions`, `/plan`, `/rc`,
  `/rewind`) say so plainly when another brain is active, instead of pretending to work.
- Some commands are refused from a phone: see [From your phone](phone.html).

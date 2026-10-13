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
| `/card import <file>` \| `apply` \| `cancel` \| `export` \| `reset` | character cards: use a card's personality, or export hers (`/card import` shows a preview first) |
| `/skills [on\|off]` | work mode: let her use your own skills by name; your user settings apply, hooks stay off (off at every start) |
| `/rename [name]` | change her name |
| `/frames [name\|off]` | show her with a [picture pack](picture-packs.html); alone, lists the packs |
| `/show` | she plays every emotion, a blink, talking and her gestures, naming each |
| `/phone [new]` | the link and QR code for your [phone](phone.html) (needs `--lan`); `new` makes a new token |
| `/status` | brain, model, mode, folder and session id |
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

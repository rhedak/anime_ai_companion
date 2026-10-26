---
description: Requirements, installation, the anaico command, configuration, and what to check when it does not start.
---

# Getting started

This page is the route from source. For a ready-made app with its own window, [download it](download.html) instead.

## What you need

- **Node.js 22.18 or newer.** It runs the TypeScript directly: there is no build step. Many systems ship an older Node, and
  `npm install` itself refuses it; with [nvm](https://github.com/nvm-sh/nvm): `nvm install 22 && nvm use 22`.
- **One brain.** Claude Code (`claude` installed and signed in), Cursor (`cursor-agent`), opencode, or Ollama.
  See [Brains](brains.html) for what each one can do.
- **A checkout of [anime-character-creator](https://github.com/rhedak/anime-character-creator)** next to this repo, at the release
  this version pins (the commands below do that), or `CREATOR_SRC` pointing at its `ts/src` folder (its TypeScript draws her; no Python is needed). If it is missing, the app clones the
  pinned release into `~/.anaico/creator/` by itself.

## Install and run

```bash
git clone --branch v0.7.2 https://github.com/rhedak/anime-character-creator.git
git clone https://github.com/rhedak/anime_ai_companion.git
cd anime_ai_companion
npm install
npm start          # http://127.0.0.1:3737
```

The first line takes the creator release this version was made for; its `main` may be ahead of it. Nothing else needs installing: there is
no Python to set up.

Open the address in a browser and say hello. Her first look is Risa; the **Looks** menu has the rest.

## The `anaico` command

`npm link` puts an `anaico` command on your PATH. It starts the server, opens the browser, and starts in
[work mode](work-mode.html) for the folder you ran it from.

| Command | What it does |
| --- | --- |
| `anaico` | start in work mode for the current folder (a home folder or `/` falls back to chat) |
| `anaico --chat` | start in chat mode; the folder is still filled in, so Work is one click away |
| `anaico --no-open` | do not open the browser |
| `anaico --lan` | also let your phone in, see [From your phone](phone.html) (off again at every start; `/phone` in the chat can turn it on too) |
| `anaico --daemon` | run in the background; output goes to `data/server.log` |
| `anaico --status`, `--stop`, `--restart` | look at, stop or restart that background server |
| `anaico --doctor` | check what it needs (Node, a brain, the creator, the port) and say what is missing; it changes nothing |

## Configuration

Everything has a default. Set these as environment variables when you start the server.

| Variable | Default | Meaning |
| --- | --- | --- |
| `COMPANION_MODEL` | `haiku` | model used for chat |
| `COMPANION_WORK_MODEL` | `sonnet` | model used in work mode |
| `COMPANION_PROVIDER` | `claude` | `claude` (Claude Code), `cursor` (Cursor agent), `opencode` or `ollama` (local models); also switchable in the UI |
| `COMPANION_OPENCODE_MODEL` | `opencode/big-pickle` (free) | model for opencode, `provider/model`; with none chosen the app uses opencode's free Big Pickle, whatever else opencode or your environment would pick |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | where Ollama is listening |
| `COMPANION_OLLAMA_TOOLS` | unset | model names (comma separated) or `all` that you vouch can use tools, when your Ollama cannot report it |
| `COMPANION_OLLAMA_CTX` | `16384` | context size asked of Ollama in work mode with tools |
| `OLLAMA_MODEL` | first installed | model to use with Ollama. A model you name here is saved to `data/settings.json` like a pick in the menu; the first-installed default is only used, never saved |
| `COMPANION_PRESET` | `risa` | starting character (any preset of the creator) |
| `CREATOR_SRC` | `../anime-character-creator/ts/src` | the creator's TypeScript folder (its `ts/src`), which draws her |
| `ANAICO_HOME` | `~/.anaico` | where the pinned creator copy is cloned when none is found next to this repo |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Claude Code's own folder, which she reads sessions and skills from |
| `CURSOR_AGENT` | `cursor-agent` | the command that starts the Cursor agent |
| `OPENCODE_BIN` | `opencode` | the command that starts opencode |
| `PORT` | `3737` | |
| `COMPANION_NO_SHELL` | unset | set to `1` to turn off the `!command` box ([safety](safety.html)) |
| `COMPANION_NO_NUDGE` | unset | set to `1` to silence the friendly reminder below |
| `COMPANION_PACK_INDEX` | the packs repository's list on GitHub Pages | https address of `packs/index.json` for packs that can be downloaded; `off` skips it. See [picture packs](picture-packs.html) |

Your own data lives in `data/` (settings, chat log, current look, saved looks, `custom.css`) and `workspace/`.
Both are git-ignored and belong to you.

## When it does not start

First, run `anaico --doctor` (or `node bin/anaico.js --doctor` before you have linked the command), or, when the page opens, type `/doctor` in the chat (the desktop app has no terminal). It checks everything below and
prints what is missing and how to fix it. Nothing is installed or changed, and it exits with 1 when something must be fixed. By hand:


1. **Check the version.** `node --version` should say 22.18 or newer. The creator's `ts/src` folder (`CREATOR_SRC`) must have
   `render.ts` in it.
2. **Check the brain.** `claude` (or `cursor-agent`, or `opencode`) must be on your PATH and signed in.
3. **Check the port.** Something else may be using 3737: set `PORT`.
4. **Read the log.** In the background mode it is `data/server.log`. Problems in the page itself also show as an
   orange line in the chat.

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
| `COMPANION_MODEL` | `haiku` | model alias passed to `claude --model` |
| `COMPANION_TOOLS` | `""` | Claude Code tools she may use (`""` = chat only) |
| `COMPANION_PRESET` | `linnea` | starting character (any preset of the creator) |
| `CREATOR_SRC` | `../anime-character-creator/src` | where the creator package lives |
| `PORT` | `3737` | |
| `COMPANION_NO_NUDGE` | unset | set to `1` to silence the friendly reminder below |

## How it works

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

## Credits

- Characters are drawn by **[anime-character-creator](https://github.com/rhedak/anime-character-creator)**
  (MIT), a program that draws them from parametric shapes, not by hand and not by image generation.
  Please keep saying so if you share what it makes.
- [`ws`](https://github.com/websockets/ws) for WebSockets.

## Licence

[MIT](LICENSE).

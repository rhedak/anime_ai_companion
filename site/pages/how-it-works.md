---
description: The pieces, the tag protocol that drives her face, and where her data lives.
---

# How it works

```
browser ──ws── Node server ──┬─ the brain (Claude Code, Cursor, opencode, or Ollama)
                             └─ python render_worker.py      draws her, via anime-character-creator
```

- **The browser** shows her and the chat. It talks to the server over a WebSocket.
- **The Node server** runs TypeScript directly (no build step), starts the brain, and keeps the conversation, her
  current look and your settings.
- **The brain** is the model that answers. Each brain implements one small interface, `Provider`, so the page never
  needs to know how a particular brain speaks. A new brain only has to implement it.
- **The renderer** is a Python worker that imports the [creator](https://github.com/rhedak/anime-character-creator)
  and returns her as SVG.

## Tags: how a reply drives her face

Her replies carry small plain-text tags, which the server strips before you see them. They are provider-agnostic, so
any brain can use them.

| Tag | What it does |
| --- | --- |
| `[emotion:happy]` | sets her face. `emotions.json` maps each emotion to face settings; the server renders a few mouth openings and a blink for it, and the page flips between them while text streams |
| `[gesture:wave]`, `[gesture:cheer]` | raise an arm for a moment (two pose frames) |
| `[avatar hair_color=#ff88cc glasses=true]` | changes her look; every key is validated, and rejected ones are reported back to her on her next turn |
| `[image path/to/file.png]` | shows a picture from the project folder under her message |
| `[demo]` | starts the same sequence as `/show`; the page plays it, because tags in a streaming reply would all fire at once |

Her current look is saved in `data/avatar.json`. With a picture pack on, `[avatar ...]` tags are
ignored, and so are gestures unless the pack has pose pictures for them; she is told which.

## What is saved where

| Place | What |
| --- | --- |
| `data/settings.json` | name, brain, models, pre-approved tools, work folder, picture pack |
| `data/avatar.json` | her current look |
| `data/looks/` | your saved looks, one file each |
| `data/frames/` | your own [picture packs](picture-packs.html) |
| `data/custom.css` | your interface changes |
| `data/lan-token` | the phone access token, readable only by you |
| `workspace/` | her own folder in chat mode |

All of it is git-ignored and yours. Permission modes and phone access are deliberately **not** saved: they are off at
every start.

---
description: Credits, the licence (including the exception for the Hatsune Miku pack), and how to contribute.
---

# About, credits, licence

## Licence

[MIT](https://github.com/rhedak/anime_ai_companion/blob/main/LICENSE), **except `packs/miku/`**. That folder shows a
character that belongs to Crypton Future Media and may only be used non-commercially under the terms in its
[NOTICE](../packs/miku/NOTICE.md). Delete that folder if you build something commercial from this code.

## The Hatsune Miku pack

A picture pack of Hatsune Miku comes with the app. It is **unofficial fan art**, used under the
[Piapro Character License](https://piapro.net/license/pcl) for **non-commercial** use only. The pictures were made
with Grok Imagine from a base design, then lined up and assembled with a script so that only the face changes
between pictures. While the pack is on, the credit
"Hatsune Miku © Crypton Future Media, INC. www.piapro.net" stays on screen and the terms are said in the chat.

Read the [NOTICE](../packs/miku/NOTICE.md) before you use or share it, and follow its terms yourself: this project
cannot grant you the right to use the character. The repository's owner has asked Crypton about AI-made fan art
and about distributing it in an open-source repository, and had no answer when this was written; the NOTICE says
so openly.

## Credits

- Characters are drawn by **[anime-character-creator](https://github.com/rhedak/anime-character-creator)** (MIT),
  which draws them from parametric shapes in code, not by hand and not by image generation. Please keep saying so if
  you share what it makes. The picture packs you load can come from anywhere, including image generators; the Miku
  pack did.
- [`ws`](https://github.com/websockets/ws) for WebSockets and [`qrcode-generator`](https://github.com/kazuhikoarase/qrcode-generator)
  for the phone QR code.
- This documentation is built with [`marked`](https://github.com/markedjs/marked).
- Not affiliated with or endorsed by Anthropic, Cursor, opencode, Ollama, Crypton Future Media or any other company
  named here.

## Contributing

You do not have to share anything: the licence lets you do whatever you like. But if you improve this project, or fix
something in your checkout of the creator, a pull request makes it better for everyone and is very welcome. Small
ones are great. See [CONTRIBUTING.md](../CONTRIBUTING.md). If either checkout has local changes, the server mentions
it once a week at startup (a local check only, no network); `COMPANION_NO_NUDGE=1` turns that off.

The source, the issue tracker and the releases are on [GitHub](https://github.com/rhedak/anime_ai_companion).

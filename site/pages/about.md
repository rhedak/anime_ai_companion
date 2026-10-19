---
description: Credits, the licence (including the notes on the downloadable Hatsune Miku and Draconia packs), and how to contribute.
---

# About, credits, licence

## Licence

[MIT](https://github.com/rhedak/anime_ai_companion/blob/main/LICENSE): everything in this repository, except the gallery preview of Draconia
(`packs/thumbs/draconia-uniform.webp`; see its [NOTICE](../../packs/thumbs/draconia-uniform.NOTICE.md)). Two packs you can download are not
part of this repository and are not MIT either. The Hatsune Miku pictures show a character that belongs to Crypton Future Media and may only be used non-commercially, under the terms in the
pack's own NOTICE. The Draconia Malfoid pictures are unofficial fan art, non-commercial, and will be taken down on request (see below).

## The Risa (dress) pack

A second picture pack comes with the app: **Risa in a dress**, an original character (the same as the drawn Risa preset).
Its pictures were made with Grok Imagine from a design by the repository's owner, then lined up and assembled with a
script so that only the face changes between pictures. It is MIT-licensed like the rest of the repository, with one
caveat said openly in its [NOTICE](../../packs/risa-dress/NOTICE.md): whether AI-made pictures can be copyrighted is not
settled everywhere, and the image tool's own terms apply too.

## The Franzi pack

**Franzi** is another original character, with four outfits (dirndl, casual, pajamas, bikini). Her pictures were made with Grok Imagine from a design by the
repository's owner and are MIT-licensed like the rest, with the same caveat about AI-made pictures in each pack's NOTICE. The dirndl comes with the
app; the other three are downloaded on request from the [packs repository](https://github.com/rhedak/anime_ai_companion-packs).

## The Draconia pack

A picture pack of **Draconia Malfoid** is available as a download (from the [packs repository](https://github.com/rhedak/anime_ai_companion-packs); the page asks first). She is her own character, not one of Franzi's outfits: an **unofficial** fan character loosely inspired by Draco Malfoy (a girl version), with long platinum-blonde hair in a side braid, teal-green eyes, and a Slytherin-style uniform. The pictures were made with Grok Imagine. The pack is **not MIT** and is for **non-commercial** use only. She is not affiliated with or endorsed by Warner Bros. or Wizarding World.

The gallery preview in this repository (`packs/thumbs/draconia-uniform.webp`) is under the same terms. Read the [NOTICE](../../packs/thumbs/draconia-uniform.NOTICE.md) before you use or share it. The pack's own NOTICE travels with the pictures (`NOTICE.md` in `data/frames/draconia-uniform/` once downloaded, and in the [packs repository](https://github.com/rhedak/anime_ai_companion-packs)). This project cannot grant you the right to use the character. The pictures will be taken down on request: rhedak00@yahoo.de.

## The Hatsune Miku pack

A picture pack of Hatsune Miku is available as a download (from the [packs repository](https://github.com/rhedak/anime_ai_companion-packs); the page asks first). It is **unofficial fan art**, used under the
[Piapro Character License](https://piapro.net/license/pcl) for **non-commercial** use only. The pictures were made
with Grok Imagine from a base design, then lined up and assembled with a script so that only the face changes
between pictures. While the pack is on, the credit
"Hatsune Miku © Crypton Future Media, INC. www.piapro.net" stays on screen and the terms are said in the chat.

Read the NOTICE that comes with the pack (`NOTICE.md` in `data/frames/miku/`, or [in the packs repository](https://github.com/rhedak/anime_ai_companion-packs/blob/main/packs-src/miku/NOTICE.md)) before you use or share it, and follow its terms yourself: this project
cannot grant you the right to use the character. The repository's owner has asked Crypton about AI-made fan art
and about distributing it in an open-source repository, and had no answer when this was written; the NOTICE says
so openly.

## How this was made

**This project was built with AI, and you should know that.** The code of this repository and the code of the
[character creator](https://github.com/rhedak/anime-character-creator) behind it were written with AI coding agents,
directed by their owner: mostly **Claude Code** (Anthropic), with some work done with **Cursor** (using Grok models)
and **opencode** (using the free "Big Pickle" model). AI-written code can be wrong. There is an automated test suite
and safety rules written into the code (see [Safety and privacy](safety.html)), but treat this as you would any
software you have not read line by line.

- **The documentation** (this site, the README and the other documents in the repository) was written by Claude Code,
  from the code.
- **The drawing** is ordinary code: when a character is drawn, no image generator runs. But the characters' designs
  began from AI-generated reference images (some made with Grok, kept in the creator's `ref/` folder), which set the
  style and the first roster, and several characters, Katherina and Risa among them, were traced from such
  references.
- **The Hatsune Miku pictures, the Risa (dress) pictures and the Draconia pictures** were made with Grok Imagine (see above).
- **The commits** made by Claude Code in this repository carry a `Co-Authored-By` trailer. The creator's commits do
  not, so its history does not show which were AI-written: assume most of its code was.

## Credits

- Characters are drawn by **[anime-character-creator](https://github.com/rhedak/anime-character-creator)** (MIT),
  which draws them from parametric shapes in code, not by hand and not by image generation (but see
  [how this was made](#how-this-was-made): the designs began from AI-generated references, and the code is
  AI-written). The picture packs you load can come from anywhere, including image generators; the Miku and Risa (dress) packs did.
- [`ws`](https://github.com/websockets/ws) for WebSockets and [`qrcode-generator`](https://github.com/kazuhikoarase/qrcode-generator)
  for the phone QR code.
- This documentation is built with [`marked`](https://github.com/markedjs/marked).
- Not affiliated with or endorsed by Anthropic, Cursor, opencode, Ollama, Crypton Future Media, Warner Bros., Wizarding World or any other company
  named here.

## Contributing

You do not have to share anything: the licence lets you do whatever you like. But if you improve this project, or fix
something in your checkout of the creator, a pull request makes it better for everyone and is very welcome. Small
ones are great. See [CONTRIBUTING.md](../../CONTRIBUTING.md). If either checkout has local changes, the server mentions
it once a week at startup (a local check only, no network); `COMPANION_NO_NUDGE=1` turns that off.

The source, the issue tracker and the releases are on [GitHub](https://github.com/rhedak/anime_ai_companion).

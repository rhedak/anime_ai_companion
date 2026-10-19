# Picture packs: your own pictures instead of the drawn avatar

A picture pack (a "frame pack" in the code and in file names) is a folder of pictures she is shown with, in place of the body the character creator draws.
Make the pictures with any image tool (or draw them), put them in `data/frames/<name>/`, and type
`/frames <name>`, or pick it from **Looks → Packs…**, a gallery that shows each pack's neutral picture next to
the drawn avatar. `/frames off` (or choosing the drawn avatar there) brings it back, and so does choosing a
saved look or a preset from the Looks menu; `/frames` lists the packs.

The pictures are only ever shown from your own machine. Nothing is uploaded, and no Python is needed to
*show* a pack (the drawn avatar's renderer still starts with the server).

## Where packs live

Your own packs go in `data/frames/<name>/`. Packs that come with the app are in `packs/<name>/`; a pack of the
same name in `data/frames` wins, so you can override one. `/frames` lists both.

## The files

The names say what each picture is. There is no manifest.

| File | Shown |
| --- | --- |
| `neutral.png` | her face at rest. **The only file that must exist.** |
| `neutral-blink.png` | for about a tenth of a second every few seconds |
| `neutral-talk1.png`, `neutral-talk2.png`, `neutral-talk3.png` | while she speaks, in a changing order together with the rest picture. 1 is the smallest mouth opening, a higher number opens wider |
| `happy.png`, `happy-blink.png`, `happy-talk1.png` ... | the same for any other emotion |
| `wave-1.png`, `wave-2.png`, `cheer-1.png`, `cheer-2.png` ... | optional: while she makes that gesture (`[gesture:wave]`, `[gesture:cheer]`) these alternate about three times a second for a couple of seconds, instead of her face. Make them from the picture she is most often in when she gestures (the happy one), keep her face as it is there and move only the arms. One picture is also fine; a gesture with no pictures does nothing |

The emotions are the keys of `emotions.json`: `neutral`, `happy`, `sad`, `angry`, `surprised`, `shy`,
`thinking`. Two optional text files describe where the pictures come from:

- `credit.txt`: its first line (up to 300 characters, and the shorter the better: it is on screen the whole time the
  pack is on) is the credit. Use it when the character belongs to someone who asks for credit. Any lines after the
  first are the terms (up to 600 characters): a short statement said once in the chat when the pack is chosen or
  the page opens with it.
- `look.txt`: what she wears in these pictures, in a few plain sentences (up to 600 characters), in the second person ("You wear…", "Your hair is up…").
  She cannot see the pictures, and her prompt describes the drawn character, so without this she keeps describing the wrong look. Its first line may be
  `character: <id>`: the shared description of that character (build, apparent age, face, hair colour, eyes) is then `characters/<id>.txt` beside the
  packs (or in `data/frames/characters/`): the first line is the name, the rest the description (up to 600 characters), and an optional line `default: <pack>` names the outfit whose picture stands for the character in the gallery (the one she wears, once she wears one of them). Outfits of one character share
  that file, so they cannot drift apart. Both are told to her when the pack is chosen and at the start of every new conversation while it is on, as a
  note with her next message (never in the system prompt). Brackets are dropped, so a text cannot carry one of her tags. A brain that reads pictures
  (Claude Code, and an Ollama model that reports vision) also gets the resting picture with that message, once. Neither text is shown on the page or served. She can change outfit herself: while a pack of a character that has several outfits is on, she is told the outfits and writes `[outfit casual]` (the name is the folder name without the character in front: `franzi-casual` is `casual`) when she decides to, or when the user asks her to. The tag can only name an outfit of the same character. An outfit that is on this computer is shown at once; one that is not raises the download question (size and server) and nothing is fetched until the user says yes, and then she wears it. Only the first `[outfit …]` of a reply counts. The `character:` line also groups the packs gallery: a character with one pack is a single tile, and one with several outfits is a tile that opens a row of them.
- `NOTICE.md`: terms of use. `/frames <name>` points to it. A pack of someone else's character needs one, and
  anyone who shares such a pack should read the licence of that character first.

When she shows an emotion the pack has no picture for, she shows `neutral`. A missing blink means
she does not blink in that emotion; missing talk pictures mean she only bobs while she speaks. PNG, WebP and
JPEG work, each up to 8 MB. (SVG is refused on purpose: a picture the server hands out must not be able to
run script.)

A pack is a fixed set of pictures, so with one active:

- `[avatar ...]` tags do nothing, and gestures (`wave`, `cheer`) do something only if the pack has pose pictures for them (above). She is told which;
- the **Full body** button is hidden (there is one framing);
- the Looks menu still changes the drawn character in the background, and you see that again after `/frames off`.

`/frames <name>` reads the folder again and tells you what it found, including pictures it did not
understand and pictures whose size differs from `neutral.png` (they would jump when they swap). Reloading the
page picks up pictures you replaced on disk.

## The sample pack: Linnea

The character creator can draw a pack for you. It is the quickest way to see the format, and the reference for
what an AI-made set has to contain: 7 emotions, each with a rest picture, a blink and three mouth openings.

```bash
# from this repo, with the creator checked out next to it (or CREATOR_SRC set)
uv run --with cairosvg python python/make_sample_pack.py data/frames/linnea
# --preset mio, --width 800, --full (whole body instead of the close-up)
```

`cairosvg` needs the cairo library (`brew install cairo` on a Mac). Then `/frames linnea` in the chat.

## Making a pack with an AI image tool

What makes or breaks it is **consistency**: every picture must be the same drawing with only the face changed.
If the head sits a few pixels differently, or the hair or the lighting changes, she twitches every time the
picture swaps. So:

1. **Make one base picture first** and be happy with it: front-facing, head and shoulders down to the chest,
   plain or transparent background. This becomes `neutral.png`. A portrait shape a little taller than wide
   works well; the sample is 580 × 660.
2. **Make every other picture by editing the base**, not by generating again. Use a tool that takes an input
   image and changes it ("edit" or "reference image" modes), and give it the base each time. Ask for exactly
   one change, and say everything else must stay identical:

   > Keep this image exactly as it is: same framing, same pose, same hair, clothes, lighting and background,
   > same pixel size. Change only the eyes: close them, as in a relaxed blink. Nothing else moves.

   > Same instructions, but only the mouth: open slightly, as when speaking softly.

   Other pictures: mouth open wider (`-talk2`, `-talk3`), then the emotions (`happy.png`: smiling and a little
   flushed; `sad.png`; `angry.png`; `surprised.png`; `shy.png`: looking away, blushing; `thinking.png`: looking
   up and to the side). Each emotion can then get its own blink and talk pictures from *that* picture.
3. **Keep one size.** Export every picture at exactly the same width and height. `/frames <name>` tells you
   about any that differ.
4. **Background.** Transparent PNGs sit on the page's dark background like the drawn avatar does. If your tool
   cannot make a transparent background, generate on one flat colour and remove it the same way for every
   picture, or the edge of the hair will differ from frame to frame. An opaque picture also works; it just shows as
   a rectangle.
5. **Let only the face change.** Even good edit tools move the hair or the outline by a pixel or two. Once
   you have the edits, line each one up with `neutral.png` and copy over only the part that is meant to change: the
   eyes for a blink, the mouth for a talk picture, the face for an emotion. Everything else then stays
   identical across all pictures and she never twitches. `python/finish_pack.py` does it (its docstring says how to
   name the edits and what to adjust); the Miku pack was made with it:
   `uv run --with pillow --with numpy python python/finish_pack.py <folder> --white`.
6. **Check it before making the rest.** Open `neutral.png` and `neutral-blink.png` in an image viewer and
   flip between them: only the eyelids should move. If the whole head shifts, redo the blink first.
   `/frames <name>` then shows it in the page.

Start small. `neutral.png` alone already works; add `neutral-blink.png` and a `neutral-talk1.png` next, then the
emotions you use most (`happy`, `thinking`). Names are case-insensitive, and files she does not recognise are
listed and ignored.

## The Risa (dress) pack

`packs/risa-dress/` is an original character, so it is MIT like the rest of the repository (`NOTICE.md` says what is and is
not settled about AI-made pictures). It was made the same way as the Miku pack, from a cropped base (940 × 1070, transparent
background, hair to hem so that raised arms fit), with the prompts and `python/finish_pack.py` run as
`--white --mouth-diff --cheek 0.42,0.37 --face-box 0.34,0.2,0.66,0.43 --seam 0.36 --mouth-box 0.43,0.35,0.55,0.42`. `--face-box` keeps the
neck and arms out of the face search for a taller crop, and `--mouth-diff` pastes only what changed, which stops a wide-open
mouth near the chin leaving a smear. The pictures are lossless WebP at full size (940 × 1070, about 11 MB for all 39; the PNGs they were made from were 16.5 MB, and the pixels are identical, transparent areas included). Its wave and cheer are two pictures each, edited from the happy picture and made as full-body pictures with a transparent background, then cropped like the base; `finish_pack.py` takes only the skin that appeared or went away from the edit (`wave-1` and the like; `--pose-face` names the picture they came from, `--pose-align body` lines an edit up on her body instead of her head, `--pose-scale 1` keeps its pixels unresampled and so sharp, `--pose-sharpen` softens less, `--pose-keep` keeps a part such as the neck from the base picture when no arm touches it, `--pose-take` takes everything that differs clearly in a box (the straps and hair around a hand at the shoulder, which a skin-only comparison misses); `pose-mask-<name>.png` shows what was taken from the edit) and leaves everything else, hair and dress included, as in the happy picture.

## The Miku pack

The Miku pack (`packs-src/miku/` in the [packs repository](https://github.com/rhedak/anime_ai_companion-packs); it is downloaded on request, not shipped) was made from a base picture of the character cropped to the same framing as the Linnea sample
(900 × 1024, the 580 × 660 ratio), then one edit per picture with Grok Imagine (35 pictures, about $2.50 in
all). Each edit got the picture to change as its only reference and an instruction of this shape, which worked
well: *"Edit Image 1. Output the same picture again with one change only. Keep everything else identical: same
framing and crop, head position, pose, hair, outfit, colours, line weight and plain white background. The one
change: <what changes>."* Blinks and mouth openings were edited from that emotion's own picture. The character
is Crypton's, so the pack is not MIT: see its `NOTICE.md`. The pictures are lossless WebP at 720 × 819
(about 350 KB each): lossy encoding would put faint noise back into the parts that are meant to be identical.

## The Draconia pack

The Draconia pack (`packs-src/draconia-uniform/` in the [packs repository](https://github.com/rhedak/anime_ai_companion-packs); it is downloaded on request, not shipped) is her own character, `character: draconia` in its `look.txt`, not an outfit of Franzi. Draconia Malfoid is unofficial fan art loosely inspired by Draco Malfoy (a girl version). The pictures were made with Grok Imagine. The pack is not MIT: non-commercial use only, not affiliated with or endorsed by Warner Bros. or Wizarding World, and taken down on request (rhedak00@yahoo.de). The gallery preview in this repository, `packs/thumbs/draconia-uniform.webp`, is under the same terms: see `packs/thumbs/draconia-uniform.NOTICE.md`. Her shared description is `packs/characters/draconia.txt` (the name the gallery shows is Draconia Malfoid, the same as the download index), so once the pack is installed the gallery and `[outfit …]` treat her separately from Franzi.

## How it is built

`src/frame-pack.ts` reads and checks a folder (only files whose names it understands are ever served, from
`/frames/<pack>/<file>`, and only for the chosen pack); `createPackAvatar` in `public/avatar.js` shows it. The
chosen pack's name is in `data/settings.json` as `framePack`. It is a look, not a permission, so unlike
`--lan` or a looser permission mode it is kept across restarts.

## Packs hosted outside the repository

The folders in `packs/` are still the pictures the app reads, and a pack you put in `data/frames/<name>/` wins over
one of the same name. A pack that is not on this computer can be downloaded from **Looks → Packs…** (its preview is
shown, with **Download**) or with `/frames <name>`. It is restored into `data/frames/<name>/` and from then on it is
an ordinary pack. If the list cannot be reached, packs that are already installed keep working.

The list's address is `COMPANION_PACK_INDEX`. Until the packs site is published, the built-in address is a placeholder
and nothing extra is offered. The archive, the preview pictures (`packs/thumbs/<id>.webp`) and the installer are
described in [pack archives](pack-archives.md).

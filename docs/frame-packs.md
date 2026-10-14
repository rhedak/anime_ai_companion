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
mouth near the chin leaving a smear. The pictures are lossless PNG at full size (about 15 MB for the 35 faces). Its wave and cheer are two pictures each, edited from the happy picture and made as full-body pictures with a transparent background, then cropped like the base; `finish_pack.py` takes only the skin that appeared or went away from the edit (`wave-1` and the like; `--pose-face` names the picture they came from, `--pose-align body` lines an edit up on her body instead of her head) and leaves everything else, hair and dress included, as in the happy picture.

## The Miku pack

`packs/miku/` was made from a base picture of the character cropped to the same framing as the Linnea sample
(900 × 1024, the 580 × 660 ratio), then one edit per picture with Grok Imagine (35 pictures, about $2.50 in
all). Each edit got the picture to change as its only reference and an instruction of this shape, which worked
well: *"Edit Image 1. Output the same picture again with one change only. Keep everything else identical: same
framing and crop, head position, pose, hair, outfit, colours, line weight and plain white background. The one
change: <what changes>."* Blinks and mouth openings were edited from that emotion's own picture. The character
is Crypton's, so the pack is not MIT: see `packs/miku/NOTICE.md`. The pictures are lossless WebP at 720 × 819
(about 350 KB each): lossy encoding would put faint noise back into the parts that are meant to be identical.

## How it is built

`src/frame-pack.ts` reads and checks a folder (only files whose names it understands are ever served, from
`/frames/<pack>/<file>`, and only for the chosen pack); `createPackAvatar` in `public/avatar.js` shows it. The
chosen pack's name is in `data/settings.json` as `framePack`. It is a look, not a permission, so unlike
`--lan` or a looser permission mode it is kept across restarts.

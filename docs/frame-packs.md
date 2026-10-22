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
| `activity-swimming-1.webp`, `-2` ..., `activity-swimming-talk-1.webp` ... | optional: pictures that loop for as long as an **activity** lasts, instead of her face (see [Activities](#activities)) |

The emotions are the keys of `emotions.json`: `neutral`, `happy`, `sad`, `angry`, `surprised`, `shy`,
`thinking`. Two optional text files describe where the pictures come from:

- `credit.txt`: its first line (up to 300 characters, and the shorter the better: it is on screen the whole time the
  pack is on) is the credit. Use it when the character belongs to someone who asks for credit. Any lines after the
  first are the terms (up to 600 characters): a short statement said once in the chat when the pack is chosen or
  the page opens with it.
- `look.txt`: what she wears in these pictures, in a few plain sentences (up to 600 characters), in the second person ("You wear…", "Your hair is up…").
  She cannot see the pictures, and her prompt describes the drawn character, so without this she keeps describing the wrong look. Its first line may be
  `character: <id>`: the shared description of that character (build, apparent age, face, hair colour, eyes) is then `characters/<id>.txt` beside the
  packs (or in `data/frames/characters/`): the first line is the name, the rest the description (up to 600 characters), and an optional line `voice: <how she speaks>` makes her speak as that character while a pack of hers is on (it outranks the default `persona.md`, not the user's own persona; `src/persona.ts`), and an optional line `default: <pack>` names the outfit whose picture stands for the character in the gallery (the one she wears, once she wears one of them). Outfits of one character share
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

## Activities

An **activity** is something she does with you for a while (swimming, cooking, a walk). She starts one with `[activity swimming]` when you ask for one or agree to her suggestion, and it lasts until she writes `[activity end]` (when you say you are done), you press **End swimming** under the picture, you start a new chat (`/clear`), or the app restarts. Activities are in memory only, and they are for chat mode: in work mode the tag is ignored, like `[remember …]`.

Any activity works with no pictures at all: she describes it in her own words and shows a fitting emotion. **An activity has an animation when a pack has pictures for it**, and then it loops for as long as it lasts. Her prompt lists the animated ones, so she prefers suggesting them ("let's do something with water" can become swimming). Ask her "how do I add my own activities?" and she points here.

**Adding your own**

1. Make the pictures for the activity in the outfit that suits it (a swimming activity in the bikini, say). Use the same canvas size and framing as the pack's other pictures (a different size jumps when it swaps), and make the last picture lead back into the first, because the loop never stops until the activity ends. Two to four pictures are enough; they play about three times a second. For real motion use a longer loop: **more than eight pictures play twelve a second**, so a two-second cycle is about 24 to 27 pictures (cut from a few seconds of video, picking the stretch where the last picture leads back into the first).
2. Put them in that outfit's pack folder (`data/frames/<pack>/`) with these names: `activity-<name>-1.webp`, `activity-<name>-2.webp` ... The name is one lower-case word (`a-z`, digits, `_`), such as `cooking` or `stargazing`. PNG and JPEG work too, and a pack made for downloading uses lossless WebP, except for the pictures of an activity: a long loop may be **lossy WebP** (quality 90, lossless transparency), about a quarter of the size, and the archive tool accepts that for `activity-*` files only (they are stored whole, not as patches).
3. Optional: the same poses with her mouth open, `activity-<name>-talk-1.webp`, `-2` ... with the same number of pictures. They play while she speaks, from the same step as the silent loop, so nothing jumps. Without them the silent loop just goes on while she speaks. A talking picture should differ from its silent partner only around the mouth: in a downloadable pack it is then stored as a small patch of that picture.
4. Run `/frames <pack>` (or reload the pack from Looks → Packs…), then ask her to do it.

Which outfit goes with an activity is simply which pack holds its pictures. When she starts an activity whose pictures are in another outfit of the same character (`look.txt`'s `character:` line) that is on this computer, she changes into that outfit first, unless the same reply names another one. If the outfit is a download that is not on this computer yet, the page asks first (size and server), and the activity runs with no loop until you say yes. A pack of a character that has a character file can also say it in that file (`characters/<id>.txt`), one line per activity, `activity: swimming = bikini` (the outfit's short name, the folder name without the character in front): that is how she knows about an animation of an outfit you have not downloaded, and Risa's file says it for her swimming.

While she is **drawn** (no pack on) and the drawn character is one that has a character file with such a line (Risa's does), she is told the same, and starting such an activity opens a card that asks whether to switch to that outfit's pack. Animations for the drawn body itself do not exist yet, so without a yes the activity just goes on.

The limits are those of every pack: 8 MB per picture and 120 files per pack (a long loop and its talking set use 54 of them). Pictures a pack carries are served by the app only while it is on.

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

## The Risa packs

`packs/risa-dress/` is an original character, so it is MIT like the rest of the repository (`NOTICE.md` says what is and is
not settled about AI-made pictures). It shows her adult look and was made the same way as her bikini and school uniform
(its `PROCESS.md` has the details). The neutral base is a Grok Imagine edit of her adult reference (`ref/risa-adult/00-bikini`
in the character creator) with only the outfit changed to the green dress. The six other emotions and the four pose pictures
(`wave-1`, `wave-2`, `cheer-1`, `cheer-2`) are edits of that base, one change each, used as they came, so the hair and outline
can move a pixel or two between emotions. `cheer-2` came back at 944 × 1088 and was enlarged to 1312 × 1504 first, so it is
a little softer. The blinks and the three mouth openings of every emotion were made by a script over the emotion picture,
every other pixel left identical. For six emotions the script drew the open mouths. Her `happy` picture is a toothy grin, so
its mouths come from one more Grok Imagine edit of `happy` with her mouth open: the script lined it up on the face, pasted
its mouth in for `happy-talk3`, and squashed that mouth to about 65% and 35% of its height (anchored at the upper lip) for
`happy-talk2` and `happy-talk1`. The black background was made transparent by a script. None of the pictures was
retouched by hand, and `python/finish_pack.py` was not used. The pictures are lossless WebP at 940 × 1070 (about 12.5 MB for
all 39). The first version of the pack, from her earlier design, was made with `finish_pack.py` from a hand-cleaned base.

Risa has two more outfits, the bikini and the school uniform (`packs-src/risa-bikini/` and `packs-src/risa-uniform/` in the [packs repository](https://github.com/rhedak/anime_ai_companion-packs); they are downloaded on request, not shipped). They are the same character: `character: risa` in each `look.txt`, and the shared description is `packs/characters/risa.txt` (`default: risa-dress`, so the gallery's tile is the dress that ships). The gallery previews are `packs/thumbs/risa-bikini.webp` and `packs/thumbs/risa-uniform.webp` in this repository, because she is MIT (Draconia's and Miku's previews stay on the packs site). The short names are `bikini`, the same short name as Franzi's bikini, and `uniform`, the same short name as Draconia's uniform. `[outfit …]` only names an outfit of the character she is already wearing, so while she is wearing Risa `[outfit bikini]` selects `risa-bikini` and `[outfit uniform]` selects `risa-uniform`, while she is wearing Franzi `[outfit bikini]` selects `franzi-bikini`, and while she is wearing Draconia `[outfit uniform]` selects `draconia-uniform`.

## The Miku pack

The Miku pack (`packs-src/miku/` in the [packs repository](https://github.com/rhedak/anime_ai_companion-packs); it is downloaded on request, not shipped) was made from a base picture of the character cropped to the same framing as the Linnea sample
(900 × 1024, the 580 × 660 ratio), then one edit per picture with Grok Imagine (35 pictures, about $2.50 in
all). Each edit got the picture to change as its only reference and an instruction of this shape, which worked
well: *"Edit Image 1. Output the same picture again with one change only. Keep everything else identical: same
framing and crop, head position, pose, hair, outfit, colours, line weight and plain white background. The one
change: <what changes>."* Blinks and mouth openings were edited from that emotion's own picture. The character
is Crypton's, so the pack is not MIT: see its `NOTICE.md`. The pictures are lossless WebP at 720 × 819
(about 350 KB each): lossy encoding would put faint noise back into the parts that are meant to be identical.

## The Draconia packs

The Draconia packs (`packs-src/draconia-uniform/`, `packs-src/draconia-vest/` and `packs-src/draconia-gown/` in the [packs repository](https://github.com/rhedak/anime_ai_companion-packs); they are downloaded on request, not shipped) are her own character, `character: draconia` in each `look.txt`, not outfits of Franzi. The vest is the uniform with the robe off. The gown is an emerald and silver Yule Ball gown. Draconia Malfoid is unofficial fan art loosely inspired by Draco Malfoy (a girl version). The pictures were made with Grok Imagine. The packs are not MIT: non-commercial use only, not affiliated with or endorsed by Warner Bros. or Wizarding World, and taken down on request (rhedak00@yahoo.de). Nothing of hers but this text is in the app's repository (her gallery previews are the index's, shown from the packs repository, as Miku's is). Her shared description is `packs/characters/draconia.txt` (the name the gallery shows is Draconia Malfoid, the same as the download index), so once a pack is installed the gallery and `[outfit …]` treat her separately from Franzi.

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

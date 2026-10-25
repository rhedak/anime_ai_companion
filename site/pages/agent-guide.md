---
description: A guide written for AI agents: how to make a picture pack for the anime companion app, the files it needs, how to edit pictures consistently, how to check them, and what to hand back.
---

# Making a picture pack: a guide for AI agents

**If you are an AI agent:** a person gave you a short prompt that links here. They want a **picture pack** of a character in a new outfit, for a local app that shows the character from pictures. Read this page, do what it says, and hand the files back. Do not guess at what is missing: ask. The person may be using a chat website, so read what you can actually do (make and edit pictures, remove a background, hand over files) and say plainly what you cannot.

**If you are the person:** you do not need to read this. Copy the prompt (`/studio handover` in the app, or **Hand over to an AI agent…** in the pack studio) into your agent, attach the neutral picture of the pack you start from, and put what you get back into `data/frames/<name>/`. See [Make her an outfit](pack-studio.html) for the other ways to make a pack.

## What a pack is

A pack is a folder of pictures of **one character in one outfit**. The app shows one picture at a time and swaps between them: her resting face, a blink every few seconds, a few mouth shapes while she speaks, another expression when she feels something, and arms-up pictures for a wave or a cheer. The pictures must therefore look like **the same picture with one small thing changed**: same size, same framing, same position, same drawing style, same colours. If a picture shifts or redraws her hair, the app visibly jumps.

## What you are given

- **A neutral picture** of the character: her face at rest, in her current outfit, transparent or on a plain background. This is the reference for everything: the face, the hair, the body, the style, the canvas size and the framing.
- **An outfit** in the person's own words.
- **A folder name** for the new pack.

If you were given none of these, ask for the picture and the outfit before you start.

## What to make

All files are named in lower case. Only `neutral` is required; every other picture makes her livelier, and a missing one is simply skipped. Make them in this order, and show the person the neutral picture first.

| File | What it is |
| --- | --- |
| `neutral.png` | **Required.** The reference picture in the new outfit. Only the outfit changes. |
| `happy.png`, `sad.png`, `angry.png`, `surprised.png`, `shy.png`, `thinking.png` | The other six expressions, each made **from the new neutral picture**, changing only the face (eyes, brows, mouth, blush). |
| `<expression>-blink.png` | The same picture with her eyes closed, for each expression you made (at least `neutral-blink.png`). Nothing else changes. |
| `<expression>-talk1.png`, `-talk2.png`, `-talk3.png` | The same picture with her mouth open: 1 a little, 2 medium, 3 wide. Nothing else changes. At least for `neutral`. |
| `wave-1.png`, `wave-2.png` | Optional. Made from the happy picture: her face stays, one arm raised in two positions of a wave. |
| `cheer-1.png`, `cheer-2.png` | Optional. Made from the happy picture: both arms up in two positions, **keeping both hands fully inside the picture**. |

PNG or lossless WebP, **up to 8 MB per picture**. JPEG cannot be transparent, so do not use it for the final files. The app also shows a pack with only some pictures, so tell the person what you did not make rather than faking it.

## Rules that decide whether the pack works

1. **Same canvas.** Every picture has the same width and height as the neutral picture you were given, and the figure sits in the same place. Do not crop, rescale or recentre individual pictures.
2. **Transparent background.** The character is cut out. If you can only produce a flat background, use **one plain colour that nothing of the character contains** (a magenta or a green, never white for a character with white in her clothes) in every picture, say which colour it is, and ask the person to remove it (the app's studio does this) or remove it yourself with a background-removal tool and check the edges on a dark and a light backdrop.
3. **Start every edit from the same base, never from another edit.** Expression pictures come from the new neutral picture, poses from the happy picture. Chaining edits (an edit of an edit) drifts: the face slowly changes.
4. **Change one thing per picture, and say what stays.** A prompt that works: "Same character, same outfit, same framing, same plain background, same art style. Only change <one thing>. Keep everything else identical." For props, say which hand holds what.
5. **Adults only, adult proportions.** The characters are adults. Keep adult proportions in every picture, whatever the outfit. Do not make pictures of a child or that sexualise one; stop and say so.
6. **A picture cropped at the thigh stays cropped.** Many packs end at the thigh. Ask for an outfit that fits that framing (no shoes, no lower legs). If your tool draws her full length, say so and re-ask with "keep the bottom edge of the picture exactly where it is".
7. **Faces change, bodies do not.** An expression or mouth picture that moves her head, changes her hair, or changes the outfit is wrong.

## Check before you hand over

Look at every picture, side by side with the neutral one, at full size:

- Same size, same position, same outfit in every picture? (Overlay them or flip between them.)
- Is the outfit as described, in the same colours in every picture?
- Does each expression actually read (a happy one that looks the same as neutral is too weak: redo it once with a clearer description of the eyebrows, eyes and mouth)?
- Blinks: eyes closed, nothing else moved. Mouths: open, nothing else moved.
- Poses: hands and arms complete and inside the picture, the same number of fingers, the same props in the same hands.
- No stray specks, haze, or leftover background colour around the edges.
- Redo a bad picture **once** with the fix in the prompt. If it is still wrong, keep the better one and tell the person which picture is weak and why. Do not loop.

## What to hand back

1. The pictures as files the person can download (a zip is fine), named exactly as above and all in one folder named as asked.
2. A short `look.txt` in that folder: what she wears in these pictures, in the second person, in a few plain sentences ("You wear a dark green hooded winter coat over a white sweater."). The app reads it to her so she can talk about her outfit. Keep it under 600 characters.
3. A `credit.txt` only if the person asks for one.
4. A message that says: which pictures you made, which you did not, which ones are weak, and which image tool or model made them (the person is responsible for what it made and for that tool's terms; say what you know).

## What the person does next

They put the folder into the app's `data/frames/<name>/` and type `/frames <name>`; the app reads the folder, reports any picture whose size differs from the neutral one, and shows her in the new outfit. The full list of file names and what the app does with them is in [Picture packs](picture-packs.html).

## Honesty

Do not claim a picture exists that you did not make, do not describe a picture you did not look at, and do not claim an edit kept everything identical without having compared it. If your environment cannot make or edit pictures, or cannot hand over files, say so at once and suggest what the person can do instead: another agent, an image website they already use, or one of the image makers built into the studio.

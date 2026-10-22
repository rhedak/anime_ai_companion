# How the Franzi (dirndl) pack was made

**Franzi is an original character.** She does not belong to any company or franchise, and no real person is shown.
Like the rest of this repository and the `risa-dress` pack, these pictures are under the **MIT licence**
(see `NOTICE.md` and the repository's `LICENSE`, including the caveat there about AI-made pictures).

## The process

1. **Design and base picture.** The repository's owner designed Franzi (black hair in a low ponytail, amber eyes,
   a green dirndl with a red apron) and made the neutral base picture with xAI's Grok Imagine. The pictures came out on a plain black background.
2. **Emotions and poses.** Each of the six other emotions (`happy`, `sad`, `angry`, `surprised`, `shy`,
   `thinking`) and the four poses (`wave-1`, `wave-2`, `cheer-1`, `cheer-2`) was made by editing that same base
   picture in Grok Imagine, one change at a time. Every edit started again from the base, never from a previous
   result, with a prompt of the form: "Same character, same outfit, same framing, same black background, same art
   style. Only change <the expression or pose>. Keep everything else identical." One picture was kept per edit.
3. **Blinks and mouths.** The blink (`<emotion>-blink`) and three mouth openings (`<emotion>-talk1` to `-talk3`)
   for all seven emotions were not made with an image tool. A script drew closed eyes or an open mouth over the
   face of each emotion picture and left every other pixel identical. They are simpler than hand-drawn
   eyes and mouths.
4. **Transparent background.** A script made the black background transparent: near-black pixels connected to the
   picture's edge, plus the enclosed black gaps between arms and body, with a 1 px soft edge and the dark fringe
   removed. Her black hair and outlines are kept. Blinks and mouths reuse their emotion picture's mask.
5. **Packaging.** All pictures were scaled to 940 × 1070 (the size of `risa-dress`) and saved as lossless WebP,
   with the same file names as `risa-dress`: 39 pictures, plus `NOTICE.md`, `credit.txt` and this file.

## Dancing activity frames

The pack has two 4-frame loops, `activity-dancing-1` to `-4` (silent) and `activity-dancing-talk-1` to `-4` (talking, the same poses with her
mouth open), 940 × 1070 lossless WebP, meant to play at about 3 frames a second.

1. **A video, then pictures.** A key picture was made with xAI's Grok Imagine from the `neutral` picture (on white): she holds the sides of her
   apron and skirt out and sways her hips, with her mouth closed (a first try came back with an open smile, which the talking set cannot use, so
   it was redone asking for a closed mouth). Grok Imagine then made a six-second video from that picture (she dances in place, same face and
   outfit, static camera), and three distinct poses were picked from its frames: a symmetric sway, a sway to the other side with the skirt swinging,
   and a stride with one hand lifted. Frame 4 is a copy of frame 2.
2. **Transparent background.** Each picked frame went through Grok Imagine's *Remove Background* (a full-size RGBA cutout, with a faint light edge on the
   skirt hem and the lace). A script then scaled each frame so her eyes match the `neutral` picture's (the eye finder picked a hair blob for the third
   frame, so its eyes were set by hand), and removed stray flecks of transparent haze.
3. **Talking loop.** The open mouths were made by script, from the open mouth of `franzi-bikini`'s `cheer-1`, pasted over each frame's own closed
   mouth (erased), 24 × 15, 30 × 21, 24 × 15 and 18 × 10 pixels (frames 1 to 4); every other pixel is the same as the silent frame.
4. **Faults left.** Her dress and lacing differ slightly from the `neutral` picture (the video redraws them), the video's frames were 896 × 1024, so they are
   a little softer than the other pictures, and the third frame's leg ends in a flat cut at the picture's bottom edge.

## Licence

MIT, the same as the repository and the `risa-dress` pack. The pictures were made with AI, so whether and by whom
they can be copyrighted is not settled everywhere; see the caveat in `NOTICE.md`.

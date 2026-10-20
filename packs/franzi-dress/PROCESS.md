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

## Licence

MIT, the same as the repository and the `risa-dress` pack. The pictures were made with AI, so whether and by whom
they can be copyrighted is not settled everywhere; see the caveat in `NOTICE.md`.

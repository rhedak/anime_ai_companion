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

The pack has a 27-frame dancing loop, `activity-dancing-1` to `-27`, and the same 27 poses with her mouth open (`activity-dancing-talk-1` to `-27`),
940 × 1070, played at 12 frames a second (2.25 s, a seamless cycle). Unlike the other pictures these are **lossy WebP** (quality 90, lossless
transparency): the lossless versions are about 420 KB each, these about 100 KB. The lossless masters are kept in the packs repository (`ref/franzi-dancing/lossless/`).

1. **Key picture and videos.** A key picture was made with xAI's Grok Imagine from the `neutral` picture: she holds the sides of her apron and skirt
   out and sways her hips, mouth closed (a first try came back with an open smile, which the talking set cannot use, so it was redone). Its background was then
   changed to flat green, and Grok Imagine made six-second videos from that picture (she dances in place, static camera, same face and outfit).
   A first video had her talking, so a second was made asking her to stay silent with her lips together; that one is the quiet loop.
2. **A loop from the video.** The frames where the picture comes back to itself (frames 49 to 103 of the 24-frames-a-second video, a 54-frame cycle)
   were found by comparing frames, and every second one was kept: 27 pictures.
3. **Transparent background.** The flat green was keyed out by a script (alpha from how green a pixel is, its colour unmixed from the green, a little green
   spill removed within 3 pixels of the edge); the video's frames are 896 × 1024. All frames were scaled by one factor and moved by one offset so that her eyes
   sit where they do in the `neutral` picture on average: the head still bobs with the dance by about ±15 pixels.
4. **Talking loop.** The open mouths were made by script, from the open mouth of `franzi-bikini`'s `cheer-1`, pasted over each frame's own closed mouth
   (erased), in the openings 24 × 15, 30 × 21 and 18 × 10 pixels in a repeating pattern of two frames each, so the mouth moves about six times a second. Every other pixel
   is the same as the silent frame before the lossy encode. A second video where she talks was also made, and not used: it did not come back to its starting pose, and
   its poses would have jumped against the silent loop.
5. **Faults left.** Her dress and lacing differ slightly from the `neutral` picture (the video redraws them), the pictures are a little softer than the others,
   the tips of the widest skirt swings touch the picture's side edges in about nine frames, and the lossy encode adds faint noise that differs between a
   silent picture and its talking partner.

## Licence

MIT, the same as the repository and the `risa-dress` pack. The pictures were made with AI, so whether and by whom
they can be copyrighted is not settled everywhere; see the caveat in `NOTICE.md`.

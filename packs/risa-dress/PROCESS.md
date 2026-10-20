# How the Risa (dress) pack was made

**Risa is an original character.** She does not belong to any company or franchise, and no real person is shown.
Like the rest of this repository and the `risa-bikini`, `risa-uniform`, `franzi-dress`, `franzi-casual`, `franzi-pajamas` and `franzi-bikini` packs, these pictures are under the **MIT licence**
(see `NOTICE.md` and the repository's `LICENSE`, including the caveat there about AI-made pictures).

This is the second version of the pack. The first was made from Risa's earlier design, and its base picture was cleaned up
by hand. This one shows her adult look, and none of its pictures was retouched by hand.

## The process

1. **Base picture.** The neutral base picture was made with xAI's Grok Imagine by editing Risa's adult reference picture
   (`ref/risa-adult/00-bikini` in the `anime-character-creator` repository, which is also the base of the `risa-bikini`
   pack), changing only her outfit to a simple green sleeveless dress with square straps. It keeps her long straight dark red
   hair with bangs, green eyes and gold hair clip, and the head-to-knee framing, on a plain black background at 1312 × 1504.
2. **Emotions and poses.** Each of the six other emotions (`happy`, `sad`, `angry`, `surprised`, `shy`,
   `thinking`) and the four poses (`wave-1`, `wave-2`, `cheer-1`, `cheer-2`) was made by editing that same dress base
   picture in Grok Imagine, one change at a time. Every edit started again from the base, never from a previous
   result, with a prompt of the form: "Same character, same outfit, same framing, same black background, same art
   style. Only change <the expression or pose>. Keep everything else identical." One picture was kept per edit.
   The tool returned `cheer-2` at 944 × 1088 instead of 1312 × 1504, so it was enlarged to 1312 × 1504 (Lanczos) before
   anything else; it is a little softer than the others. The tool also zoomed out on it, so her figure is smaller in that
   picture and her raised fists are close to the top edge. Otherwise it was kept as it came.
3. **Blinks and mouths.** The blink (`<emotion>-blink`) and three mouth openings (`<emotion>-talk1` to `-talk3`)
   for all seven emotions were made by a script over the face of each emotion picture, which left every other pixel
   identical. Only the `happy` mouths started from an image-tool picture (see below); the rest were drawn by the script. The eye and mouth positions were measured on each
   emotion picture. For the blinks, the script finds each open eye (the lashes, white and green iris connected to the
   iris) inside a box around it, paints it over with the surrounding skin colour, and draws a closed-eye line across it;
   red hair pixels are never painted, so her bangs, her eyebrows and the hair beside her eyes are left untouched. The `happy`
   blink closes her eyes with a gently upward-curved line. For the mouths of six emotions the script paints the closed mouth
   over with skin and draws an open mouth in three sizes. Her `happy` picture is a toothy grin, so its mouths come from one more Grok Imagine
   edit of the `happy` picture with her mouth open (same prompt form), which was not used as a picture of its own. The script
   lined it up with `happy` on the face around the mouth and pasted only the mouth, with a few pixels of skin and a soft
   edge, into the `happy` picture: that is `happy-talk3`. For `happy-talk2` and `happy-talk1` the same open mouth was
   squashed to about 65% and 35% of its height below the upper teeth (and a little narrower), anchored at the upper lip so
   the lower lip moves up, over the skin of that picture with the mouth painted out. So the three read as the same mouth
   opening wider.
4. **Transparent background.** A script made the black background transparent, with the method used for Risa's adult
   reference cut-out: near-black pixels connected to the picture's edge, plus the enclosed black gaps between arms and body
   (and between hair and arms, between her raised arms and head in `cheer-2`) that survive a small opening, the narrow gaps
   between her hair strands near her outline, and the gaps between her fingers. The near-black shadow of the hair strands
   that hang between her arms and the dress is kept. The soft edge is matted from the colour of the nearby hair or skin and
   un-premultiplied, so there is no dark fringe and her fine red hair strands are kept. Blinks and mouths reuse their
   emotion picture's mask.
5. **Packaging.** All pictures were scaled to 940 × 1070 (premultiplied Lanczos, the size of the first version) and saved
   as lossless WebP, with the same file names as before and as the other Risa and Franzi packs: 39 pictures, plus
   `NOTICE.md`, `credit.txt`, `look.txt` and this file.

## Licence

MIT, the same as the repository. The pictures were made with AI, so whether and by whom
they can be copyrighted is not settled everywhere; see the caveat in `NOTICE.md`.

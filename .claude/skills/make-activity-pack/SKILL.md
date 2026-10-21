---
name: make-activity-pack
description: Make a picture-pack outfit or an activity animation (swimming, cooking, dancing) for a character, using Grok Imagine in Chrome and the bundled scripts, then package it for the packs repo. Use when the owner wants a new outfit pack, a new activity loop for an existing outfit, or asks to drive Grok Imagine through the browser.
---

# Making an outfit pack or an activity loop

The app side already exists (`docs/frame-packs.md`, "Activities"): files `activity-<name>-1..4.webp` and `activity-<name>-talk-1..4.webp` in the outfit's pack, plus an `activity: <name> = <outfit>` line in `packs-src/characters/<id>.txt` (both repos' copies; a test in `test/frame-pack.test.ts` pins the app's copy). This skill is the picture work. Pack frames are 940 × 1070 lossless WebP, filenames as in the other packs (7 emotions with `-blink` and `-talk1..3`, `wave-1/2`, `cheer-1/2`).

Safety and manners: ask before spending the owner's Grok allowance beyond what was agreed, one retry per bad picture, never loop. Characters are adults (Risa 21, Draconia 21): keep adult proportions in every frame and say so in the prompts when a swimsuit is involved. Draconia packs are **not MIT** (copy `NOTICE.md` from a sibling and change the pack name); Risa and Franzi are MIT. Say honestly in `PROCESS.md` what the tool made and what a script made, including the faults left.

## 1. Driving Grok Imagine in Chrome

Load the tools in one call (`tabs_context_mcp, navigate, computer, find, file_upload, read_page`, plus `form_input`). `tabs_context_mcp {createIfEmpty:true}` first; a tab id from an earlier session is invalid. The owner is signed in; never enter credentials.

- **Reference picture.** Prefer selecting the base from the generation history (the "+" in the prompt box, Generations tab) over re-uploading: the owner found it works better. When uploading, `file_upload` only reads files this session may read, so copy the picture to the scratchpad first (the packs repo is not readable). Composite a transparent pack frame on white (`PIL`) before upload.
- **Every edit starts again from the base**, never from an earlier result: `navigate` to the base post URL (`https://grok.com/imagine/post/<id>`), wait 8 s, click the edit box under the image (about 700,628), **`cmd+a`** (the box comes prefilled with the last prompt), type the prompt, click send (about 1036,628), wait 10 + 8 s (`wait` is capped at 10 s). The post id in the new URL is the result's id.
- **Prompt shape** that worked: "Same character, same outfit, same framing, same plain white background, same anime art style. Only change <one thing>. Keep everything else identical." For props add which hand holds what: "Keep the pan in the SAME hand (the hand on the left side of the image holds the pan handle) and the spatula in the SAME other hand. Do not swap the hands."
- **Remove Background** (right panel, about 1260,426) returns a **full-size RGBA PNG** with a clean edge even on near-white hair, so no colour key is needed and the base can stay on white. It takes the pool of a swimming picture for background too (see 3).
- **Downloading.** `find "Download button for the full image (not a segment), after Copy image"`, click the ref, wait 3 s. Files land in `~/Downloads` as `grok-image-<postid>.jpg` (the picture) or `.png` (a cutout); move them straight into the working folder and rename (`1-original.jpg`, `1-cutout.png`, `emotions/happy.jpg`). Refs go stale after each navigation: find again. The "Download All" button gives a `segments.zip`; check its names before unpacking.
- **Read every result** (zoom on the picture) before downloading: hands swapped between frames, props that appear or vanish (an empty pan that fills in the toss frame, redo the key frame with the contents), a head turned or an arm that moves in an emotion edit, proportions that drift (a slim figure, a leg cut too high). Retry once with the fix in the prompt; otherwise tell the owner what the picture is and let them choose.

## 2. What to generate

- Base (neutral) from the character's existing pack picture; then happy, sad, angry, surprised, shy, thinking from the base. If an emotion is too weak to read, redo it once with a clearer cue ("eyes looking sharply up and to the left, one eyebrow clearly raised"); a hand-on-chin version of thinking was chosen by the owner even though it moves her arm.
- Poses wave-1/2 and cheer-1/2 from the **happy** picture (so the face carries over), cheer-2 with "keep both hands fully inside the picture".
- Activity: a key frame, a rest variant, a toss/lively variant; frame 4 is a copy of frame 2 (loop key, rest, lively, rest). Four frames at about 3 per second. Close the loop visually.
- Swimming: waist-deep in calm water, "the water forms a soft rounded pool around her that fades out softly into the white background", arms in four different poses; her face stays the base's.

## 3. Processing (scripts in `scripts/`, Python with Pillow and numpy, run with `python3 -I`)

Working folder layout: `$PACK_SRC/cutouts/<emotion>.png` (7), `$PACK_SRC/poses/<name>.png` (4), `$PACK_SRC/swimming/<n>-original.jpg` and `-cutout.png` for a water scene; for a non-water activity put cutouts in `cook-raw` style instead and skip `compose_swim`.

1. `prep.py`: fills the figure's deep interior to opaque (Grok's cutout leaves dark cloth 40 to 60 % transparent), resizes with premultiplied alpha to 940 × 1070 into `frames-raw/`. **Do not run the fill on a water scene**: it would turn the translucent pool opaque; `compose_swim.py` does its own fill.
2. `compose_swim.py` (water scenes): figure from the cutout, water from the original with white turned into alpha, dry skin/suit opaque, a per-frame `y_dry_override` and `soften_column=True` when the cutout kept her submerged body as a pale column (check the waist of every frame on a dark and a white backdrop).
3. **Align to the outfit's existing pack**: measure `face.measure(...)` irises on the existing `neutral` and on the new frames and shift (`dx, dy`, a few pixels) so the eyes match within 1 to 2 px. The eye finder only looks at `y < 0.26 H` (a green tie or other teal props are not eyes).
4. `blink.py`: erases each eye inside an ellipse (skin vertical-gradient fill from the skin above and below, so blush carries on) and draws one closed lid; pass `rx=47, top_margin=19` for `surprised`. Check all seven at zoom; a faint smudge where bangs cross an eye is the known fault, say so in `PROCESS.md`.
5. `mouth.py`: cuts the open mouth out of the `cheer-1` frame, erases each frame's closed mouth (anything darker than the skin around it, so a smile line goes), pastes three openings (18 × 10, 24 × 15, 30 × 21) rotated by the head tilt (`src_angle - ang`; the sign matters). Activity talking frames use the pattern talk2, talk3, talk2, talk1.
6. `build.py`: all frames as lossless WebP (`exact=True`) into `out/`; with `ACTIVITIES=swimming,cooking` for several. It takes minutes: run it in the background.
7. `inventory.py` `scan()` for specks, haze and white edge on each frame (stray specks 0 and haze under about 10 px is clean).

Make a **contact sheet** at every step and read it; make a GIF of the loop (quiet x3, talking x3, quiet x2, 333 ms) with PIL and send it to the owner (`SendUserFile`; the preview shows a still, so say to open it in a browser).


## Characters that differ from Risa and Draconia (Franzi: black hair, amber eyes, a white swimsuit)

The scripts have switches for them; set them in the environment of every script that reads the face:

- `IRIS=amber`: brown or amber irises (the default finder looks for teal/green). The iris rim comes in pieces, so the two biggest blobs are the eyes. Measure the new frames against the pack's own `neutral` with it before shifting anything.
- `HAIR=dark`: black hair. The default hair test is for blonde hair and calls light skin hair, which leaves no skin to fill from, and the mouth/eye erase then paints **black**.
- `MOUTH_THRESH=4`: a faint smile line (the default 9 only finds its middle). Pieces of a line that sit close together are merged into one mouth; the nose mark above it is not.
- `compose_swim(..., water_min_blue=18)`: for a **white swimsuit**. The default treats any pale pixel below the waterline as water and cuts holes in a white bikini bottom.
- Use the character's **own** `cheer-1.webp` as `frames-raw/cheer-1.png` so the open mouth is hers; a plain white `neutral` from the pack is the Grok reference.
- A base that was **uploaded** has no page of its own: after the first generation click its thumbnail in the strip (the first one) to get the base's post URL, and use that for every later edit.
- A pose that fails twice (hands clasped at the chest, arms crossed over it) is not worth a third prompt of the same idea: change the idea (a freestyle stroke: one arm forward over the water, the other back) and tell the owner what the two failures were; keep the failed pictures in `other-frame2/`.

## 4. Package, verify, hand over

- Folder `packs-src/<pack>/` in `../anime_ai_companion-packs` on a branch: frames, `look.txt` (`character: <id>` then what she wears, in second person), `credit.txt`, `NOTICE.md`, `PROCESS.md`, and `packs-src/<pack>.publish.json` (`description` **at most 400 characters**, `credit`, `aiMade`, `thumbnail: thumbs/<pack>.webp`, `character`). Thumbnail: `node src/pack-thumb-cli.ts <dir with the pack's neutral> -o <out>` in the app repo, copy to `site/thumbs/`.
- Character files: add `activity: <name> = <outfit>` in the packs repo's `packs-src/characters/<id>.txt` and the app's `packs/characters/<id>.txt` (and its test).
- Verify with the app's own tools in the app repo: `readPack` (the activities and no size notes), `node src/pack-archive-cli.ts build <folder> -o x.tar` then `restore` and compare visible pixels (colour under fully transparent pixels does not matter). Expect about 5 to 8 MB for 47 frames; talk frames are about 1 KB patches.
- Install it into the dev app (`cp -R` into `~/.anaico-dev/data/frames/`), restart `shell/dev-app.sh`, and let the owner try it (see `record-app-demo` for a video). Open the packs PR only when asked; **publishing** belongs to `release-companion` and waits for the app release.
- Keep the Grok originals and cutouts in an untracked `ref/` folder of the packs repo (do not commit them; they are the owner's working files).

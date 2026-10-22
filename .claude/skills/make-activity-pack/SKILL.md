---
name: make-activity-pack
description: Make a picture-pack outfit or an activity animation (swimming, cooking, dancing) for a character, using Grok Imagine in Chrome and the bundled scripts, then package it for the packs repo. Use when the owner wants a new outfit pack, a new activity loop for an existing outfit, or asks to drive Grok Imagine through the browser.
---

# Making an outfit pack or an activity loop

The app side already exists (`docs/frame-packs.md`, "Activities"): files `activity-<name>-1..4.webp` and `activity-<name>-talk-1..4.webp` in the outfit's pack, plus an `activity: <name> = <outfit>` line in `packs-src/characters/<id>.txt` (both repos' copies; a test in `test/frame-pack.test.ts` pins the app's copy). This skill is the picture work. Pack frames are 940 × 1070 lossless WebP (the pictures of a long activity loop are lossy q90, see the last two sections), filenames as in the other packs (7 emotions with `-blink` and `-talk1..3`, `wave-1/2`, `cheer-1/2`).

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

## Motion from a Grok video (worked for Franzi's dancing)

For a lively loop (dancing) a video beats four separate edits: the poses are consistent and the motion is real.

- Make the key picture first (closed mouth: **an open smile cannot take the talking set**). On its post: right panel "Make Video" > "Add Prompt", set the resolution chip to 720p (the video is 896 x 1024, 6 s, 24 fps), prompt "she dances ... in place, static camera, plain white background, mouth stays closed, same face and outfit". Download the video (find "Download", it lands as `grok-video-<conversation>.mp4`).
- `ffmpeg -i v.mp4 -vf fps=4 all/f%02d.png`, tile a contact sheet, pick three distinct, front-facing poses with the face the size of the base. Upload each to `grok.com/imagine` (file input ref, then wait 9 s for the post), **Remove Background**, wait for it to finish (15 s), download the full image.
- Scale each cutout so the eye spacing matches the pack's `neutral` and place the eye midpoint on it (`align.py` pattern: `face.measure` on both). The eye finder can pick a hair blob on a tilted head: set that frame's eyes by hand, and give `mouth.head_geometry` the same eyes (monkeypatch it in the build script). Then `despeck` (drop alpha components under 200 px), talk frames from a **neutral-sized** `cheer-1` of the same character (the dress pack's own cheer-1 is tilted 30 degrees and gives a broken patch: use the bikini pack's).
- Python here has no Pillow: `uv run --with pillow --with numpy python -I script.py`.

### Green screen and a 27-frame loop (the better route for lively activities)

- Make the key picture on **flat green**: in image mode (the prompt box remembers video mode: click the image icon first), "replace the plain white background with a perfectly flat, solid, pure bright green (#00FF00) background, keep everything else identical". Then Make Video from that post, prompt with the motion plus "she is silent, her lips stay pressed together in a closed gentle smile, never opening her mouth ... a smooth seamless cycle ... static camera ... background stays flat bright green". Asking for a talking video gives a mouth that opens and a cycle that does not close: use scripted mouths instead.
- Key it locally (`key.py` pattern: alpha from `g - max(r, b)` between 40 and the background's 211, colour unmixed from the background, spill capped within 3 px of the edge), find the cycle by comparing frames (`loops.py`: the best pair 30 to 96 frames apart should score about half of a one-frame step), keep every second frame (27 at 12 fps), scale and offset all frames by one transform from the mean eye position (do not align frame by frame: the head bob is the motion), then the usual mouths. The scripts used for Franzi's dance are in the packs repo's `ref/franzi-dancing/`.
- The app plays a loop of more than 8 pictures at 12 a second. Encode such loops as lossy q90 (`alpha_quality=100`, `method=6`): about 100 KB a frame against 420 KB, and the archive tool accepts lossy for `activity-*` only. Keep the lossless masters in `ref/`. A pack may hold 120 files: one long loop and its talking set use 54.
- A **hair bow** (Franzi's casual outfit) is read as an eye by the amber finder: `IRIS_YMIN=0.15` skips the top of the picture, `IRIS_RG_MAX=90` skips red. In a small video figure the finder may split one eye into pieces: read both iris centres off a magnified crop and use constants (and give `mouth.head_geometry` the same, by monkeypatch). A prop activity (cooking) needs the **hands spelled out** in the video prompt ("her right hand keeps gripping the handle", "exactly ONE spatula, only in her other hand"): the first video had two spatulas and no grip. Closure score: only a 93-frame cycle closed tightly, a 47-frame one scored 1.4x a step, which at 12 fps (two frames per step) is smaller than a normal step: take the shortest cycle scoring under about one 12-fps step.

## Which route, and what it costs (learned over Draconia's and Franzi's activities)

- **Short loop (4 frames, 3 a second)**: one edit per frame from the base on white, Remove Background for each (water scenes: `compose_swim`). About 5 to 8 Grok generations. Fine for slow things (swimming).
- **Long loop (24 to 27 frames, 12 a second)**: the green-screen video route above. About 4 generations in all (key picture on green, one or two videos; no Remove Background at all, the key is local), the smoothest result, and the quiet and talking sets stay in sync because the mouths are scripted onto the same frames. Use it for anything lively. It needs the lossy q90 encode (about 100 KB a frame) and the archive tool's activity exception; keep the lossless masters and the videos in the packs repo's untracked `ref/<pack>/`.
- Budget: Grok allowance and the weekly Claude limit both ran low after three activities in one week. Do one activity per sitting, and read each video's contact sheet before spending a retry (one retry per bad video; the fix goes into the prompt, not a third try of the same prompt).
- Chrome driving: batch every sequence in `browser_batch` where the tool offers it (navigate, wait, click, type, send, wait, screenshot in one call), and wait 10 + 10 + 8 s for a 6-second video at 720p before the download button exists. Downloads land as `grok-video-<conversation>.mp4` with ` (1)`, ` (2)` suffixes: take the newest with `ls -t`.
- Python needs `uv run --with pillow --with numpy python -I script.py` (system python has no Pillow); `-I` drops the script folder from the import path, so `sys.path.insert` the helpers.
- Check **packs repo and app repo tests after adding frames**: the `franzi-dress` archive test pins the pack's text sizes and its emotion frames (it now copies the pack without `activity-*`), the frame-pack test counts a bundled pack's files, and a pack may hold 120 files (a long loop and its talking set use 48 to 54).


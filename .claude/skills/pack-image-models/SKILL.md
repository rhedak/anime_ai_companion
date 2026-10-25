---
name: pack-image-models
description: Benchmark or add a local image model for picture packs (text-to-image and edit tests, one model in memory at a time), using tools/image-model-bench. Use when the owner asks to compare image models, test a new model for packs, re-run the benchmark, or check whether a model's edits stay inside their box.
---

# Benchmarking an image model for packs

The decision and the numbers are in `docs/pack-image-models.md`. Read it first: it says which model is chosen (FLUX.2 klein 4B), why, and what each test showed. This skill is how to run the tool, and how to add a model without repeating the mistakes already made.

## The rules

- **One model in memory at a time.** `bench.py run` makes the pictures and exits; the exit is what frees Metal memory. `score.py` runs afterwards and loads only DINOv2. `run_all.sh` does this in order. Never start a second generator while one is running.
- **Pin the revision.** Every model in `config.json` has a `revision` (a commit hash). Loaders use it with `local_files_only=True`. Do not use `HF_HUB_OFFLINE=1`: diffusers then fails even when the files are cached.
- **Check the card before the first run.** Pipeline class, steps, guidance and any negative-prompt rule come from the model card. Put what you checked in the model's `verify` field.
- **Ask before downloading.** Show the size from the Hugging Face API (`/api/models/<repo>?blobs=true`, sum the siblings) and the licence, then wait for a yes. The approval covers that model only, not the next one.
- **Licence first.** Apache-2.0 or MIT for the weights. Check the licence of the exact variant (the 9B FLUX.2 sibling is non-commercial; Qwen-Image-2.1 is a research licence).

## Running an existing model

```bash
cd tools/image-model-bench
python3 bench.py plan --model flux2-klein-4b     # lists the jobs, imports no model
./run_all.sh flux2-klein-4b                      # generate, then score
```

Run it in the background for anything longer than a few minutes, and watch the log for `exit=`. Each run writes `runs/<model>-<stamp>/`, with `scores.json` and `scores.csv`. Rate the `blind/` pictures against `blind/key.json` before drawing conclusions from preference.

Expect roughly:
- text-to-image, distilled 4-step models: a few seconds per picture on this Mac;
- edit models with 50 steps and a second pass: about 15 minutes per edit.

## Adding a model

1. Find its Hugging Face repo, licence, pipeline class and recommended steps and guidance from the model card.
2. Add an entry to `config.json` under `models`. Use `kind: "generate"` for text-to-image only, or `kind: "edit"` for models that take an input picture. Set `pipeline` to the class name, and set either `guidance` (generate) or `guidance_scale` / `true_cfg_scale` plus `negative_prompt` (edit).
3. Pin `revision` to the current commit, and record the download size in `download_gib` if you want the plan to show it.
4. Download with `snapshot_download(repo_id=..., revision=...)`. Include `*.json`, `*.safetensors`, `*.txt`, `*.model` **and `*.jinja`**: a missing chat template makes the snapshot incomplete and the load fails.
5. `python3 bench.py plan --model <name>`, then run it.

## Pitfalls already hit

- **Model-specific arguments.** Qwen-Image-Edit takes `true_cfg_scale` and `negative_prompt`; FLUX.2 klein takes `guidance_scale` and no negative prompt. A pipeline rejects arguments it does not accept, so the edit path builds its arguments from the config for each model.
- **Results record.** `bench_edit.py` writes `results.json` before generating. Any key it reads from the model config must use `.get()` if only some models have it. A `KeyError` there stops the run before the model loads.
- **Output size.** Qwen-Image-Edit returned 960×1088 for a request of 896×1024; the harness resizes and logs a `note:` line. Check the note before reading the outside-box numbers.
- **Memory.** Use `mps_driver_gb` from `results.json`. The process RSS does not count Metal memory, so it looks tiny for the big models.
- **Queued runs.** Queue a run behind another with a script that waits for the earlier log's `exit=` line. Do not edit a running shell script: bash reads it as it goes.

## Reading the scores

- **Outside the edit box** (`outside_mean_diff`, `outside_changed_share`): should be near zero for a pack. Every model tested changed pixels outside its box, so pack edits must be pasted back inside the box only. Paste-back is not implemented yet.
- **Inside the box** (`inside_mean_diff`): low values mean the edit may be too weak; check the blind pictures.
- **Identity** (`vs_base`): DINOv2 on whole pictures is rough. Outfit edits score lower by design.
- **Drift**: the five chained face edits; a slow slide in identity is the warning sign.
- **Timing**: the median of the timed runs, which exclude the warm-up.

Always state which settings a number was measured with (steps, guidance, pipeline), and that the blind rating is a visual check, not a scored study.

## Building a pack from an approved base

Used for the Risa casual pack. The base is a neutral picture the owner has approved by eye; everything else is an edit of it, with the same seed unless a retry is needed.

**Face pictures** (emotions, blinks, three mouth openings):
- Edit the base, not the previous picture, so the errors don't compound. Blinks of a non-neutral emotion are the exception: edit that emotion's picture so the eyes change only.
- Paste back only inside the face box (the `face` box from `config.json`, scaled to the picture, padded by about 12 px, feathered with a Gaussian blur of 6). Anything the model draws outside the box is dropped.
- **Check for clipping** after every paste-back: count changed pixels (difference from the base above 40) that sit on the box's edge. Anything above a handful means the paste-back cut something. An open mouth that reaches the chin is the usual cause: extend the box for that picture (for example, down to y 345 at 896×1024) and regenerate it.
- **Check for changes outside the box**: the largest difference outside should stay small (about 20 or below). Changes outside the box mean the paste-back isn't doing its job.

**Gesture pictures** (wave, cheer, thinking with a hand at the face):
- Do **not** paste back. A limb that leaves the box gets cut off at the box edge, so the picture ends up with a stub of arm. The whole-picture output is the right result.
- Say the other arm explicitly, or the model drops it. Use: "her other arm (the one on the right side of the picture) hangs relaxed at her side with the hand visible". Without it, the lowered hand disappears (measured: skin pixels in that region fell from about 3150 to about 115).
- Check the lowered hand by counting skin pixels in the same region of the neutral and each pose. A value far below the neutral means the arm is gone.

**Defects only a person can see**, so check them by eye at zoom (crop around the hand or face, 2–3×):
- finger count on open hands (the model has produced four-finger hands and a hand with a finger merged into a ghost stroke);
- a cut-off finger or limb at the edge of the picture;
- the hair clip and outfit still present and in place.

**Retrying**: the same prompt with the same seed gives the same picture, so a retry changes the seed (1, 2, 3, 4, …), not the prompt. Check each new candidate at zoom. Cap it at three tries per picture. If none passes, flag that picture for a person and keep the best candidate in the folder, named as such. Don't claim a picture is clean when the check hasn't been done.

**A hand near the mouth** (thinking, finger on the chin): a wide-open mouth asked for from the closed-mouth base made the model move the finger into the lip (nine tries over three prompts, all of it). What worked: start from the previous open-mouth frame (`thinking-talk2`), ask only for "a little wider", paste back only the mouth (a box from just below the nose to just above the finger, here y 250–322 at 896×1024, feathered), and check the box edge for clipping (zero changed pixels above 40). A paste box that includes the eyes lets the model's changed gaze through: the first `thinking-talk3` had one.

**Keeping the old versions**: move a replaced picture to `poses/old/` (or the matching folder) rather than deleting it, so the owner can compare.

## Cutting the figure out (transparent background)

FLUX.2 klein outputs RGB only. Pictures are made on flat white (stills) or magenta (video loops), and `tools/pack-crop` cuts them out. Method and numbers: `tools/pack-crop/README.md`.

- **Do not threshold.** A hard on/off key leaves a stair-step edge and a pale outline on every strand (that was the first Risa casual pack). Use `cutout.py`: rough mask → unknown band → closed-form matting → edge colours with the background removed.
- **Magenta only for video.** For the stills, white worked once the gaps were handled: pale neutral gaps between hair and shoulder or fingers are background too (`PALE`), but eye whites must be kept (`EYES` box).
- **One alpha per pose.** A face edit pasted back changes nothing outside the face, so `build_pack.py` gives all of a pose's face frames the same alpha. Do not matte them separately.
- **Run `check.py` on the pack and on a Grok pack.** Compare edge tint, soft-edge share and specks; the target is at or better than Grok's. Then look at 3× crops on dark and white (hair edge, hands, chin, chair).
- **Seam score** (printed by `build_pack.py`) above 16 means look at the picture. It once caught a face frame whose eyes had changed direction (a generation fault, not a crop one): regenerate by seed.

## Putting the pack into the packs repository

Done for Risa (casual); the generic steps are in `make-activity-pack` (section 4) and the packs repository's README. What is specific to a pack made this way:

1. Build the final pictures with `tools/pack-crop/build_pack.py` (stills) and `build_loop.py` (a loop). Face frames of a pose copy the base's saved colours outside the face, so the archive stores them as small patches; without that the thinking frames were whole-picture patches (15.4 MB against 13.1 MB).
2. Work on a branch from `origin/main` (a `git worktree` keeps the owner's checkout alone). Put the frames, `look.txt`, `credit.txt`, `NOTICE.md`, `PROCESS.md` (say what each tool made and the faults left) in `packs-src/<id>/`, `packs-src/<id>.publish.json` beside it, the outfit's line in `packs-src/characters/<character>.txt` (and the app's `packs/characters/<character>.txt`), and the thumbnail from `node src/pack-thumb-cli.ts <dir with the pack> -o <packs repo>/site/thumbs`.
3. Keep the lossless masters, the white-background 896×1024 pictures, the video and the scripts in the untracked `ref/<id>/` of the packs repository.
4. Verify: `pack-archive-cli.ts build`, `restore`, compare the visible pixels of every picture (a lossy loop picture must also match, because the archive stores it whole), `readPack` on the folder and on the restored one, `scripts/write-index-entry.mjs` for the entry the workflow will write, and a build with the tool at the workflow's `COMPANION_REF` (same SHA-256 means the workflow publishes what was checked). `npm run typecheck && npm test` in the app repository.
5. Do not push, tag or edit `site/index.json`: the publish workflow does that from the tag, and it waits for the app release (`release-companion`).

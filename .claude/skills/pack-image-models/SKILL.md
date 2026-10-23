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

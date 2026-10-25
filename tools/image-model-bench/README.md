# Image-model benchmark for picture packs

Benchmarks one image model at a time on the tests in [`docs/pack-image-models.md`](../../docs/pack-image-models.md).
It is a development tool: nothing here is part of the running app, and it is not run by CI.

## Files

- `config.json`: models (repo, pinned `revision`, licence, pipeline class, steps, guidance), prompts, seeds, sizes, the edit boxes and drift prompts. The reference is the Risa uniform pack in the packs repository (`packs-src/risa-uniform`); change `reference` if your packs live elsewhere.
- `bench.py`: `plan` lists the jobs, `run` loads one model, makes every picture and exits. Models with kind `edit` are handed to `bench_edit.py`.
- `bench_edit.py`: the edit tests (single edits inside a box, and a five-step drift chain).
- `score.py`: run after `run` has exited. Loads only DINOv2-small (`facebook/dinov2-small`, Apache-2.0) and writes `scores.json` and `scores.csv`.
- `run_all.sh`: plan, generate and score for each model named, one after another.

## Running

Use Python 3.12 with `torch` (MPS build), `diffusers` (0.41 or newer, which has `ZImagePipeline`, `QwenImageEditPipeline` and `Flux2KleinPipeline`), `transformers`, `pillow` and `numpy`.

```bash
python3 bench.py plan --model flux2-klein-4b
./run_all.sh flux2-klein-4b
```

Download the weights first. The loaders use `local_files_only=True` and the pinned `revision`, so a model that isn't fully downloaded fails at load time instead of silently fetching. Download with `snapshot_download(repo_id=..., revision=...)`; for Qwen-Image-Edit include `*.jinja` in the patterns or the snapshot is incomplete.

Each run folder is `runs/<model>-<stamp>/` and contains `timing/`, `identity/`, `quality/` (or `edit/`, `drift/`, `masks/`), `blind/` (shuffled copies with `key.json`), `results.json`, and after scoring `scores.json` and `scores.csv`. `runs/` and the virtualenv are not part of the repository.

## What is not measured

- Blind ratings are not automated. Rate the `blind/` pictures against `key.json` before reading any preference into the numbers.
- DINOv2 on whole pictures is a rough identity check; values near 0.9 are hard to tell apart.
- Peak memory is the Metal driver figure in `results.json` (`mps_driver_gb`). The process RSS does not include Metal memory.

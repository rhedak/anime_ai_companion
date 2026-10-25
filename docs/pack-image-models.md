# Image models for making packs

Which local image model to use for making picture packs (`docs/frame-packs.md`), and how we chose it.
The benchmark tool is in `tools/image-model-bench/`; the procedure is in `.claude/skills/pack-image-models/SKILL.md`.

## Decision

**FLUX.2 [klein] 4B** (`black-forest-labs/FLUX.2-klein-4B`, distilled, Apache-2.0), run with 4 steps and guidance 1.0.

It is the only tested model that does both jobs we need (new pictures from text, and edits of an existing picture) at a speed where a re-run is cheap. Its edits kept the rest of the picture much more still than the other models did, and its anime style was judged comparable to the others.

Live generation inside the app is **not** built. This decision is for making packs offline with the tool. Any live use would be a separate change with its own approval steps (`AGENTS.md`, "Safety").

## Candidates and licences

| Model | Licence | Edits | Notes |
| --- | --- | --- | --- |
| FLUX.2 [klein] 4B (distilled) | Apache-2.0 | yes | Chosen. The 9B sibling is non-commercial and excluded. |
| Qwen-Image-Edit (20B) | Apache-2.0 | yes | Works, but slow and changes much of the picture outside the edit. The newer Qwen-Image-2.1 uses a research licence. |
| Z-Image-Turbo (6B) | Apache-2.0 | no | Text-to-image only. Z-Image-Edit and Z-Image-Omni-Base were listed as "to be released" in the card. |
| Boogu-Image-0.1 (Turbo, Edit-Turbo) | Apache-2.0 | yes (1 reference) | Not benchmarked. Separate checkpoints for text-to-image and editing; the edit model takes one reference picture. |
| Anime SDXL checkpoints (Illustrious, NoobAI, Nova) | mixed, some non-commercial | no | Not used: licence terms for outputs are unclear. |

Evaluation model: DINOv2-small (`facebook/dinov2-small`, Apache-2.0). The InsightFace face models are not used because their pretrained weights are non-commercial.

## Measurements

All runs on an Apple M5 Max (128 GB), Metal (MPS), bf16, one model in memory at a time. Pictures at 896×1024. Times are medians.

| Run | Time per picture | Peak Metal memory | Identity | Outside the edit box |
| --- | --- | --- | --- | --- |
| Z-Image-Turbo, text-to-image (9 steps) | 15.4 s | 26 GB | mean 0.89, lowest 0.71 | n/a |
| FLUX.2 klein 4B, text-to-image (4 steps) | 3.9 s | 22 GB | mean 0.90, lowest 0.68 | n/a |
| FLUX.2 klein 4B, edit (4 steps) | 12.2 s | 23 GB | face and arm 0.95–0.99 | median change 5.4, at most 8% of pixels changed by more than 16 |
| Qwen-Image-Edit, edit (50 steps, true CFG 4.0) | 882 s | 72 GB | face and arm 0.94–0.97 | median change 21.8, 13–28% of pixels changed |
| Qwen-Image-Edit, edit (20 steps, no second pass) | 160 s | 73 GB | face and arm 0.95–0.97 | median change 22.9, 13–27% of pixels changed |

"Outside the edit box" is the mean change, on a 0–255 scale, of pixels outside the rectangle the edit was allowed to change. A pack needs this near zero, so the model's output is pasted back only inside the box (see below).

Drift (five face edits in a row, each from the previous one): FLUX.2 kept identity 0.994 → 0.985, with the outside-box change growing from 2.7 to 8.5. Qwen 0.971 → 0.925 (default) and 0.977 → 0.929 (fast).

Blind visual check, by the owner: Qwen fast and Qwen default were comparable in quality; both sometimes produced artifacts that ruin a picture. FLUX.2 drifted a little in hair colour over a chain of edits, which is cheap to fix by re-running a step. Anime style was comparable across the candidates.

## What this means for the pack workflow

- **Edits must be pasted back.** Even FLUX.2 changes pixels outside the box. Keep the model's output only inside the allowed rectangle and take everything else from the base picture, as `python/finish_pack.py` already does for hand-made edits. This paste-back is not yet implemented or tested in the tool.
- **Use the 4-step distilled model.** The base FLUX.2 klein (about 50 steps) is slower and was not measured here.
- **Re-running is the fix for failures.** A failed picture costs about 12 seconds with FLUX.2, so regenerate rather than hand-fix.
- **Expressions are subtle.** The FLUX.2 face edits changed fewer pixels inside their box than the Qwen edits did. Check that the expression is clearly different before using it.

## Cutting the figure out

The model makes no transparency. The first cut (a threshold on a white or magenta key) left white and magenta fragments and a stair-step edge. The second (`tools/pack-crop`, closed-form matting with a soft alpha) measured at or better than a Grok pack on edge tint and soft edges (table in that folder's README). A face frame that differs from its base only inside the face shares the base's alpha, so the outline cannot change between frames.

## Caveats

- One seed per prompt in the edit tests; the quality tests used three seeds.
- Qwen-Image-Edit returned 960×1088 pictures for the requested 896×1024. The harness resized them, which blurs the outside-box comparison slightly.
- Identity is a whole-picture embedding (DINOv2-small), a rough check. The outfit edits score lower by design, because the outfit changes.
- Only Apple Silicon (MPS) was measured. An NVIDIA GPU would give different times.
- The blind rating was a visual check by the owner, not a scored study.

## Pitfalls found on the way

- A download that skips `*.jinja` leaves the Qwen-Image-Edit snapshot incomplete; the loader then refuses to load it.
- Loading with a pinned commit hash needs `revision=<sha>` and `local_files_only=True`. `HF_HUB_OFFLINE=1` makes diffusers fail even when the files are cached.
- Qwen-Image-Edit uses a second, unconditioned pass when `true_cfg_scale` is above 1. Setting it to 1.0 with no negative prompt skips that pass.
- The process RSS does not include Metal memory; read `mps_driver_gb` instead.
- Keep one model in memory: a process exit is what frees its Metal memory, so the harness runs each model in its own process.

## Licences and pins

Revisions used: FLUX.2 klein 4B `e7b7dc2`, Qwen-Image-Edit `ac7f931`, Z-Image-Turbo `f332072`, DINOv2-small `ed25f3a`. Check each model's licence file in the pinned revision before shipping any picture made with it.

## Safety and responsibility

What the weights do, as far as the files show:

- The pinned FLUX.2 klein 4B download has no safety-checker component. Its pipeline (`Flux2KleinPipeline`) lists only the text encoder, transformer, VAE and scheduler, so nothing in the pipeline refuses or blocks an output.
- The model card says the pre-training data was filtered for NSFW and CSAM, and that the repository includes inference filters for NSFW and protected content. The downloaded files don't include those filters, and the card asks deployers to add their own mitigations for the 4B model.
- We have not tested whether the model refuses explicit prompts, and the benchmark prompts were chosen to avoid that. Do not read a refusal, or the lack of one, as a property of the model.

Position for the app:

- **Users bring their own model.** Image generation in the app, if it is built, runs against a local model the user has installed and chosen. The app does not download or ship generation weights for that path.
- **No content refusals from the app.** The app adds no filter of its own on what the user's model produces, and it does not tune any character toward explicit output.
- **Warn, and ask first.** Before generation is turned on, show a notice that the user is responsible for what they generate and for which image model they use, and say which model is set up. Turning it on is opt-in, off at every start, and refused from a phone, like the other opt-ins in `AGENTS.md`.
- **Shipped packs stay SFW.** The packs in this repository, and any pack the app downloads, are not made for explicit content, and the notice does not change that.

Decided by the owner: the project's SFW policy is the default. The maintainers control what is committed and pushed. Users can only change their own local checkout or install, or fork the repository, and what they do there is their own responsibility. The app does not add a content filter for the user's own model.

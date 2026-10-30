---
description: Run an image model on your own computer for the pack studio: what you need, how to download the reference model, start its server and point the app at it.
---

# Running an image model on your computer

The [pack studio](pack-studio.html) can draw with a model that runs **on your own computer**: nothing is sent anywhere, nothing is paid per picture, and the cost is time and memory. The app does not bundle a model or Python. You start a small server, and the app talks to it on `127.0.0.1` only.

If you would rather not, pick another image maker in the studio's list: an API with your own key, or a website you already use through Chrome. This page is only for the first one.

## What you need

- **A computer with a lot of memory.** The reference model needs about **22 GB** of graphics or unified memory while it draws, and about 8 GB of disk. It was measured on an Apple M5 Max with 128 GB, and nothing else: a smaller machine may be too slow or fail.
- **[uv](https://docs.astral.sh/uv/)**, which fetches the Python packages when you run the commands below. Nothing is installed system-wide.
- The app's own folder (the one you cloned), because the server is the file `python/pack_studio/server.py` in it.

## 1. Download the model once

The reference model is FLUX.2 klein 4B (Apache-2.0). The server never downloads anything by itself, so fetch it first, into the Hugging Face cache:

```bash
uv run --with huggingface_hub python -c "from huggingface_hub import snapshot_download as d; d('black-forest-labs/FLUX.2-klein-4B', revision='e7b7dc27f91deacad38e78976d1f2b499d76a294', allow_patterns=['*.json','*.safetensors','*.txt','*.model','*.jinja'])"
```

## 2. Start the server

From the app's folder:

```bash
uv run --with torch --with diffusers --with transformers --with accelerate --with sentencepiece --with pillow python python/pack_studio/server.py
```

It listens on `http://127.0.0.1:7861` (`--port` changes it, `--device mps|cuda|cpu` picks the hardware). It loads the model on the first picture, so the first one is slow. Leave it running while you use the studio.

## 3. Tell the app

Choose **A model on this computer** in the studio's **Image maker** list, or type:

```
/studio backend http://127.0.0.1:7861
/studio on
```

If the server is not running, or is running without the model, the studio says so and shows these steps instead of failing a picture.

## Use your own Python environment

The commands above use `uv`, which makes a throwaway environment on each run. If you already have a Python environment for image models (a venv, conda, the one of your other projects), use that instead. It is the same server, started with your Python:

```bash
/path/to/your/venv/bin/python /path/to/anime_ai_companion/python/pack_studio/server.py --port 7861
```

The environment needs `torch` (the build for your graphics card), `diffusers`, `transformers`, `accelerate`, `sentencepiece` and `pillow`, and `huggingface_hub` for the download in step 1. On a Mac `--device mps` is the default; on an NVIDIA card pass `--device cuda`.

You can tell the app which Python and which script are yours, so it shows you the exact command whenever the model is not answering:

```
/studio python /path/to/your/venv/bin/python
/studio server /path/to/anime_ai_companion/python/pack_studio/server.py
```

Both are saved as whole paths in `data/settings.json`. The app starts nothing from them: it only prints the command for you to run, in your own terminal.

## Start it from the app

Instead of a terminal you can start the server from the studio. Open **Start my own image server** in the panel, enter the two whole paths (your Python and the server script), pick the device (`mps` for a Mac, `cuda` for an NVIDIA card, `cpu` is very slow) and press **Start the server**. A card shows the exact command, the port and the folder it reads models from, and nothing starts until you press **Start it**. The panel then shows what the server prints, so a missing package is visible there. **Stop it** ends it, and so does turning the studio off.

The server runs as you, with your own Python and your own script, so only point it at files you trust. The app gives it its environment without keys, tokens, secrets or passwords. It is never started by itself: not at launch, not by the chat, not from a phone. The address is the one the studio uses for **A model on this computer** (`http://127.0.0.1:7861` unless you changed it with `/studio backend`), and only an address on this computer works for this.

## Which models have a server

Only one: **FLUX.2 klein 4B**, the model the reference server `python/pack_studio/server.py` loads, and the one the pack studio was measured with ([the numbers](https://github.com/rhedak/anime_ai_companion/blob/main/docs/pack-image-models.md)). The studio's model list also notices some other image models in your Hugging Face cache (Qwen-Image, Z-Image-Turbo, Pony Diffusion), so you know what is on your computer, but **there is no server for them in this app**. To use one, you or your agent has to write a server that speaks the same small protocol (below). We have not tested those models for packs, so we do not say they work.

## If you want an AI agent to do the setup

Copy this to your agent (Claude Code, Cursor or any other that can run commands on your computer) and let it ask you what it needs:

> I want to run an image model on this computer for the pack studio of the anime companion app. Read https://rhedak.github.io/anime_ai_companion/local-model.html and set it up: make or find a Python environment for me, install what the page lists for my hardware, download the FLUX.2 klein 4B weights as step 1 says (about 8 GB: tell me before you start the download), and start `python/pack_studio/server.py` from my copy of the app. Check `http://127.0.0.1:7861/health` and tell me the result. Do not change anything outside the environment and the Hugging Face cache, do not expose the server beyond 127.0.0.1, and tell me the exact command to start it again later.

The agent runs on your authority, so read what it is about to run, as with any tool that works on your computer.

## Using a model the app did not find

The list of detected models is only a hint; the app never needs a model to be in it. Any image model you run yourself works if a small server in front of it speaks the app's protocol, on `127.0.0.1`:

- `GET /health` answers `{"ok": true, "name": …, "model": …, "edit": true, "generate": true}` (add `"weights": false` while the files are not downloaded).
- `POST /edit` takes `{"image": <base64 PNG>, "prompt", "seed", "width", "height", "steps"?}` and answers `{"image": <base64 PNG>}`. The studio needs this one for outfits and expressions.
- `POST /generate` takes the same without `image`.

The complete description is at the top of `python/pack_studio/server.py`, which you can copy and change to load your model. Then, in the app:

1. **Where the server is:** type `/studio backend http://127.0.0.1:<port>` (the studio's **Image maker** list then shows it as **A model on this computer**).
2. **Which Python and script start it:** `/studio python <path>` and `/studio server <path>`, as above, so the app can show the start command when it is not answering. Your server's own options (device, precision, model folder, port) are its command-line arguments or its code: the app has no form for them yet and passes only what the protocol carries (the prompt, the seed, the size, and the number of steps).
3. **Check it** with `/studio on`: the app asks `/health` and says what it found.

An agent can write the server for you. Give it this page and the protocol above, and the name of the model. What a model draws is your responsibility, and its own terms apply. We have not tested models other than FLUX.2 klein 4B for packs.

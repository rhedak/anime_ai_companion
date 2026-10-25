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

## Using another model

Anything that speaks the same small protocol works in its place: `GET /health`, `POST /edit` and `POST /generate`, on `127.0.0.1`. The protocol is described at the top of `python/pack_studio/server.py`. Give its address with `/studio backend <address>`. The model's own terms apply, and what it draws is your responsibility.

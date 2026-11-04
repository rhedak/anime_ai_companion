"""A local image backend for the app's pack studio: FLUX.2 [klein] behind the studio's small JSON protocol.

    # reference 4B (default):
    uv run --with torch --with diffusers --with transformers --with accelerate --with sentencepiece --with pillow \
        python python/pack_studio/server.py [--port 7861] [--device mps|cuda|cpu]

    # 9B + optional LoRA (e.g. diroverflo klein-nsfw from a sibling local_models checkout):
    /path/to/.venv/bin/python python/pack_studio/server.py --model flux-9b \
        --lora /path/to/models/loras/klein-nsfw/Flux_Klein_NSFW_v2.safetensors --lora-scale 0.8

This is a reference, not part of the app (the app bundles no Python and no weights). Anything that speaks the same protocol works in its place;
the protocol is documented in src/studio/backend.ts:

    GET  /health    -> {"ok": true, "name", "model", "revision", "licence", "edit": true, "generate": true, "weights"?: false when the files are not downloaded}
    POST /edit      {"image": <base64 PNG>, "references"?: [<base64 PNG>, …], "prompt", "seed", "width", "height", "steps"?} -> {"image": <base64 PNG>}
                    (the references are image 2, image 3, … after the base; the model may take an outfit or a look from them)
    POST /generate  {"prompt", "seed", "width", "height", "steps"?}                        -> {"image": <base64 PNG>}

What it does, and what it does not:
  * It listens on 127.0.0.1 only and refuses a request whose Host header is not this computer's, like the app's own server.
  * The model is loaded on the first request, from the Hugging Face cache, at a pinned revision, with local_files_only=True: it never downloads anything.
  * Settings are the ones measured in docs/pack-image-models.md for 4B: 4 steps, guidance 1.0, bfloat16. One picture at a time (a lock), but /health answers while a picture is being drawn.
  * The model's own terms apply (Apache-2.0 for the 4B model; the 9B sibling is not). What gets drawn is the user's responsibility.
"""
import argparse
import base64
import io
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MODELS = {
    "flux-4b": {
        "repo": "black-forest-labs/FLUX.2-klein-4B",
        "revision": "e7b7dc27f91deacad38e78976d1f2b499d76a294",
        "name": "FLUX.2 klein 4B (reference backend)",
        "licence": "Apache-2.0",
        "default_steps": 4,
    },
    "flux-9b": {
        "repo": "black-forest-labs/FLUX.2-klein-9B",
        "revision": "92196c8e11f7b6cf2b7493e037d8c5345c559216",
        "name": "FLUX.2 klein 9B",
        "licence": "FLUX.2-dev Non-Commercial License",
        "default_steps": 8,
    },
}
# short aliases
MODELS["4b"] = MODELS["flux-4b"]
MODELS["9b"] = MODELS["flux-9b"]

MAX_BODY = 60 * 1024 * 1024

state = {
    "pipe": None,
    "device": "mps",
    "model_key": "flux-4b",
    "lora": None,
    "lora_scale": 0.8,
}
lock = threading.Lock()


def model_cfg():
    return MODELS[state["model_key"]]


def apply_lora(pipe, lora_path: Path, scale: float):
    print(f"[studio-backend] loading LoRA {lora_path} (scale={scale})", flush=True)
    try:
        pipe.load_lora_weights(str(lora_path), adapter_name="user")
    except TypeError:
        pipe.load_lora_weights(str(lora_path))
    if hasattr(pipe, "set_adapters"):
        try:
            pipe.set_adapters(["user"], adapter_weights=[float(scale)])
            return
        except Exception:
            try:
                pipe.set_adapters(["default"], adapter_weights=[float(scale)])
                return
            except Exception:
                pass
    if hasattr(pipe, "fuse_lora"):
        try:
            pipe.fuse_lora(lora_scale=float(scale))
        except TypeError:
            pipe.fuse_lora()


def load():
    if state["pipe"] is None:
        import torch
        from diffusers import Flux2KleinPipeline

        cfg = model_cfg()
        print(f"[studio-backend] loading {cfg['repo']} @ {cfg['revision']}…", flush=True)
        pipe = Flux2KleinPipeline.from_pretrained(
            cfg["repo"], revision=cfg["revision"], torch_dtype=torch.bfloat16, local_files_only=True
        )
        pipe.to(state["device"])
        pipe.set_progress_bar_config(disable=True)
        if state["lora"]:
            apply_lora(pipe, Path(state["lora"]), float(state["lora_scale"]))
        state["pipe"] = pipe
        print("[studio-backend] model ready", flush=True)
    return state["pipe"]


def weights_present():
    """Are the model's files in the Hugging Face cache? (Nothing is downloaded.)"""
    try:
        from huggingface_hub import snapshot_download

        cfg = model_cfg()
        snapshot_download(cfg["repo"], revision=cfg["revision"], local_files_only=True, allow_patterns=["model_index.json"])
        return True
    except Exception:
        return False


def health_name():
    cfg = model_cfg()
    name = cfg["name"]
    if state["lora"]:
        name = f"{name} + {Path(state['lora']).stem}@{state['lora_scale']}"
    elif cfg["repo"].endswith("4B"):
        name = "FLUX.2 klein 4B (reference backend)"
    return name


def draw(prompt, seed, width, height, steps, image=None):
    import torch
    from PIL import Image

    pipe = load()
    generator = torch.Generator(state["device"]).manual_seed(int(seed))
    kwargs = dict(prompt=prompt, num_inference_steps=steps, guidance_scale=1.0, generator=generator)
    if image is not None:
        kwargs["image"] = image
    else:
        kwargs["width"], kwargs["height"] = width, height
    with torch.inference_mode():
        out = pipe(**kwargs).images[0]
    if state["device"] == "mps":
        torch.mps.synchronize()
    out = out.convert("RGB")
    if out.size != (width, height):
        out = out.resize((width, height), Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # one line a request, no picture data
        print("[studio-backend]", fmt % args, flush=True)

    def send(self, status, body):
        data = json.dumps(body).encode("utf8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def allowed_host(self):
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
        return host in ("127.0.0.1", "localhost", "::1")

    def do_GET(self):
        if not self.allowed_host():
            return self.send(403, {"message": "Only this computer may ask."})
        if self.path == "/health":
            cfg = model_cfg()
            return self.send(
                200,
                {
                    "ok": True,
                    "name": health_name(),
                    "model": cfg["repo"],
                    "revision": cfg["revision"],
                    "licence": cfg["licence"],
                    "edit": True,
                    "generate": True,
                    "weights": weights_present(),
                },
            )
        self.send(404, {"message": "No such route."})

    def do_POST(self):
        if not self.allowed_host():
            return self.send(403, {"message": "Only this computer may ask."})
        if self.path not in ("/edit", "/generate"):
            return self.send(404, {"message": "No such route."})
        length = int(self.headers.get("content-length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self.send(413, {"message": "The request is empty or too large."})
        try:
            body = json.loads(self.rfile.read(length))
            width, height = int(body["width"]), int(body["height"])
            if width % 16 or height % 16 or not (256 <= width <= 1536) or not (256 <= height <= 1536):
                return self.send(400, {"message": "width and height must be multiples of 16 between 256 and 1536."})
            steps = int(body.get("steps") or model_cfg()["default_steps"])
            image = None
            if self.path == "/edit":
                from PIL import Image

                def decode(text):
                    return Image.open(io.BytesIO(base64.b64decode(text))).convert("RGB")

                image = decode(body["image"])
                references = [decode(text) for text in body.get("references") or []]
                if references:
                    image = [image] + references
            with lock:
                result = draw(str(body["prompt"]), body.get("seed", 0), width, height, max(1, min(steps, 50)), image)
            self.send(200, {"image": result})
        except Exception as error:  # the app shows this text to the user
            self.send(500, {"message": f"{type(error).__name__}: {error}"[:400]})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=7861)
    ap.add_argument("--device", default="mps")
    ap.add_argument("--model", default="flux-4b", choices=sorted(MODELS.keys()), help="flux-4b (default) or flux-9b")
    ap.add_argument("--lora", default=None, help="path to a Diffusers LoRA .safetensors (e.g. klein-nsfw for flux-9b)")
    ap.add_argument("--lora-scale", type=float, default=0.8)
    args = ap.parse_args()
    if args.lora and not Path(args.lora).is_file():
        raise SystemExit(f"LoRA file not found: {args.lora}")
    state["device"] = args.device
    state["model_key"] = args.model
    state["lora"] = args.lora
    state["lora_scale"] = args.lora_scale
    cfg = model_cfg()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    extra = f", lora={Path(args.lora).name}@{args.lora_scale}" if args.lora else ""
    print(
        f"[studio-backend] listening on http://127.0.0.1:{args.port} "
        f"({cfg['repo']}{extra}; model loads on the first request)",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()

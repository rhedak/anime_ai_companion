"""A local image backend for the app's pack studio: FLUX.2 [klein] 4B behind the studio's small JSON protocol.

    uv run --with torch --with diffusers --with transformers --with accelerate --with sentencepiece --with pillow \
        python python/pack_studio/server.py [--port 7861] [--device mps|cuda|cpu]

This is a reference, not part of the app (the app bundles no Python and no weights). Anything that speaks the same protocol works in its place;
the protocol is documented in src/studio/backend.ts:

    GET  /health    -> {"ok": true, "name", "model", "revision", "licence", "edit": true, "generate": true, "weights"?: false when the files are not downloaded}
    POST /edit      {"image": <base64 PNG>, "prompt", "seed", "width", "height", "steps"?} -> {"image": <base64 PNG>}
    POST /generate  {"prompt", "seed", "width", "height", "steps"?}                        -> {"image": <base64 PNG>}

What it does, and what it does not:
  * It listens on 127.0.0.1 only and refuses a request whose Host header is not this computer's, like the app's own server.
  * The model (about 8 GB of weights, 22 GB of GPU memory in use) is loaded on the first request, from the Hugging Face cache, at a pinned
    revision, with local_files_only=True: it never downloads anything. Download it first with
        uv run --with huggingface_hub python -c "from huggingface_hub import snapshot_download as d; d('black-forest-labs/FLUX.2-klein-4B', revision='e7b7dc27f91deacad38e78976d1f2b499d76a294', allow_patterns=['*.json','*.safetensors','*.txt','*.model','*.jinja'])"
  * Settings are the ones measured in docs/pack-image-models.md: 4 steps, guidance 1.0, bfloat16. One request at a time.
  * The model's own terms apply (Apache-2.0 for the 4B model; the 9B sibling is not). What gets drawn is the user's responsibility.
"""
import argparse
import base64
import io
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

REPO = "black-forest-labs/FLUX.2-klein-4B"
REVISION = "e7b7dc27f91deacad38e78976d1f2b499d76a294"
MAX_BODY = 60 * 1024 * 1024

state = {"pipe": None, "device": "mps"}
lock = threading.Lock()


def load():
    if state["pipe"] is None:
        import torch
        from diffusers import Flux2KleinPipeline

        pipe = Flux2KleinPipeline.from_pretrained(REPO, revision=REVISION, torch_dtype=torch.bfloat16, local_files_only=True)
        pipe.to(state["device"])
        pipe.set_progress_bar_config(disable=True)
        state["pipe"] = pipe
    return state["pipe"]


def weights_present():
    """Are the model's files in the Hugging Face cache? (Nothing is downloaded.)"""
    try:
        from huggingface_hub import snapshot_download

        snapshot_download(REPO, revision=REVISION, local_files_only=True, allow_patterns=["model_index.json"])
        return True
    except Exception:
        return False


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
            return self.send(200, {"ok": True, "name": "FLUX.2 klein 4B (reference backend)", "model": REPO, "revision": REVISION, "licence": "Apache-2.0", "edit": True, "generate": True, "weights": weights_present()})
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
            steps = int(body.get("steps") or 4)
            image = None
            if self.path == "/edit":
                from PIL import Image

                image = Image.open(io.BytesIO(base64.b64decode(body["image"]))).convert("RGB")
            with lock:
                result = draw(str(body["prompt"]), body.get("seed", 0), width, height, max(1, min(steps, 50)), image)
            self.send(200, {"image": result})
        except Exception as error:  # the app shows this text to the user
            self.send(500, {"message": f"{type(error).__name__}: {error}"[:400]})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=7861)
    ap.add_argument("--device", default="mps")
    args = ap.parse_args()
    state["device"] = args.device
    server = HTTPServer(("127.0.0.1", args.port), Handler)
    print(f"[studio-backend] listening on http://127.0.0.1:{args.port} (the model loads on the first request)", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

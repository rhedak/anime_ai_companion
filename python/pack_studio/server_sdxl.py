"""A local image backend for the app's pack studio: an SDXL anime checkpoint (WAI-Illustrious and its siblings) behind the studio's JSON protocol.

    python python/pack_studio/server_sdxl.py --checkpoint /path/to/waiIllustriousSDXL_v170.safetensors [--port 7861] [--device mps|cuda|cpu]

The same protocol as server.py (see its header and src/studio/backend.ts), for a single-file SDXL checkpoint:
    POST /generate   text to picture.
    POST /edit       picture to picture at a LOW strength: SDXL has no instruction-following edit, so the picture is redrawn from the prompt while it keeps
                     the shape of the input. It follows an edit far less faithfully than FLUX.2 klein does; the studio's own checks and tries are what catch that.
It listens on 127.0.0.1 only, refuses a request whose Host header is not this computer's, loads from the file you name (never downloads), runs one request
at a time, and the model's own terms apply. `--checkpoint` may also be given as the environment variable PACK_STUDIO_CHECKPOINT, which is how the app's
"Start my own image server" can pass it (the app gives the script only --port and --device).
"""
import argparse
import base64
import io
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MAX_BODY = 60 * 1024 * 1024
PREFIX = "masterpiece, best quality, amazing quality, "
NEGATIVE = "bad quality, worst quality, worst detail, sketch, censor"

state = {"txt": None, "img": None, "device": "mps", "checkpoint": None, "steps": 25, "guidance": 6.0, "strength": 0.55}
lock = threading.Lock()


def load(img2img):
    key = "img" if img2img else "txt"
    if state[key] is None:
        import torch
        from diffusers import StableDiffusionXLImg2ImgPipeline, StableDiffusionXLPipeline

        cls = StableDiffusionXLImg2ImgPipeline if img2img else StableDiffusionXLPipeline
        dtype = torch.float16 if state["device"] != "cpu" else torch.float32
        pipe = cls.from_single_file(str(state["checkpoint"]), torch_dtype=dtype)
        pipe.to(state["device"])
        pipe.set_progress_bar_config(disable=True)
        state[key] = pipe
    return state[key]


def draw(prompt, seed, width, height, steps, image=None):
    import torch
    from PIL import Image

    pipe = load(image is not None)
    full = prompt if prompt.startswith(PREFIX.strip().rstrip(",")) else PREFIX + prompt
    generator = torch.Generator("cpu" if state["device"] == "mps" else state["device"]).manual_seed(int(seed))
    kwargs = dict(prompt=full, negative_prompt=NEGATIVE, num_inference_steps=steps or state["steps"], guidance_scale=state["guidance"], generator=generator)
    if image is not None:
        kwargs["image"] = image.resize((width, height), Image.LANCZOS)
        kwargs["strength"] = state["strength"]
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
    def log_message(self, fmt, *args):
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
            name = Path(state["checkpoint"]).stem
            return self.send(200, {"ok": True, "name": f"{name} (SDXL reference backend)", "model": name, "licence": "see the checkpoint's own terms", "edit": True, "generate": True, "weights": Path(state["checkpoint"]).is_file()})
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
            steps = int(body.get("steps") or 0)
            image = None
            if self.path == "/edit":
                from PIL import Image

                image = Image.open(io.BytesIO(base64.b64decode(body["image"]))).convert("RGB")
            with lock:
                result = draw(str(body["prompt"]), body.get("seed", 0), width, height, max(0, min(steps, 60)), image)
            self.send(200, {"image": result})
        except Exception as error:
            self.send(500, {"message": f"{type(error).__name__}: {error}"[:400]})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=7861)
    ap.add_argument("--device", default="mps")
    ap.add_argument("--checkpoint", default=os.environ.get("PACK_STUDIO_CHECKPOINT"))
    ap.add_argument("--steps", type=int, default=25)
    ap.add_argument("--guidance", type=float, default=6.0)
    ap.add_argument("--strength", type=float, default=0.55, help="how far /edit redraws the picture (0.3 keeps most of it, 0.8 little)")
    args = ap.parse_args()
    if not args.checkpoint or not Path(args.checkpoint).is_file():
        raise SystemExit("Give --checkpoint (or PACK_STUDIO_CHECKPOINT): the whole path of a single-file SDXL .safetensors.")
    state.update(device=args.device, checkpoint=args.checkpoint, steps=args.steps, guidance=args.guidance, strength=args.strength)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"[studio-backend] listening on http://127.0.0.1:{args.port} with {Path(args.checkpoint).name} (it loads on the first request)", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

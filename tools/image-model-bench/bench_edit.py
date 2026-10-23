#!/usr/bin/env python3
"""Edit half of the benchmark, for models that take a picture and an instruction (Qwen-Image-Edit).

Called from bench.py for models whose config kind is "edit". Same rules as bench.py: one model per
process, scoring in score.py after the process exits.

    python3 bench.py plan --model qwen-image-edit
    python3 bench.py run  --model qwen-image-edit

Every edit starts from the same base picture (the Risa uniform neutral, on white, at the benchmark
size). Each edit gets a rectangle it is allowed to change; everything outside it should stay the same.
"""

import json
import random
import shutil
import time
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
CFG = json.loads((HERE / "config.json").read_text())


def ref_path():
    return Path(CFG["reference"]) / "neutral.webp"


def load_white(path):
    img = Image.open(path).convert("RGBA")
    bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
    return Image.alpha_composite(bg, img).convert("RGB")


def base_image(size):
    """The reference neutral on white, resized to the benchmark size (no crop)."""
    return load_white(ref_path()).resize(tuple(size), Image.LANCZOS)


def scaled_box(name, size):
    """A box is written in the reference's pixels (940x1070); scale it to the benchmark size."""
    ref_w, ref_h = Image.open(ref_path()).size
    x0, y0, x1, y1 = CFG["edit"]["boxes"][name]
    sx, sy = size[0] / ref_w, size[1] / ref_h
    return [round(x0 * sx), round(y0 * sy), round(x1 * sx), round(y1 * sy)]


def mask_image(name, size):
    """White inside the allowed rectangle, black outside."""
    m = Image.new("L", tuple(size), 0)
    ImageDraw.Draw(m).rectangle(scaled_box(name, size), fill=255)
    return m


def jobs():
    """(test, name, prompt, box, source). source 'base' starts from the base picture,
    'chain' from the previous drift step."""
    out = [("edit", t["name"], t["prompt"], t["box"], "base") for t in CFG["edit"]["tests"]]
    for i, prompt in enumerate(CFG["edit"]["drift"]["prompts"]):
        out.append(("drift", f"d{i}", prompt, CFG["edit"]["drift"]["box"], "chain"))
    return out


def plan(model):
    m = CFG["models"][model]
    t = m["timing"]
    j = jobs()
    print(f"model: {model}  ({m['repo']}, {m['licence']}, {m['kind']}, download ~{m['download_gib']} GiB)")
    settings = f"true_cfg_scale {m['true_cfg_scale']}" if "true_cfg_scale" in m else f"guidance {m['guidance_scale']}"
    print(f"size: {CFG['size'][0]}x{CFG['size'][1]}, steps {m['steps']}, {settings}")
    print(f"timing: {t['warmup']} warm-up + {t['runs']} timed edits")
    print(f"edits: {sum(1 for x in j if x[0] == 'edit')} single edits, {sum(1 for x in j if x[0] == 'drift')} drift steps")
    missing = [] if ref_path().exists() else [str(ref_path())]
    print(f"reference: {ref_path()} -> {'OK' if not missing else 'MISSING'}")
    print(f"verify before running: {m['verify']}")
    return 0 if not missing else 1


def run(model):
    import gc
    import platform

    import torch
    import diffusers
    import diffusers

    m = CFG["models"][model]
    # Pipeline class per model; Qwen-Image-Edit is the default for configs written before this option.
    Pipeline = getattr(diffusers, m.get("pipeline", "QwenImageEditPipeline"))
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out = HERE / "runs" / f"{model}-{stamp}"
    for sub in ("timing", "edit", "drift", "masks", "blind"):
        (out / sub).mkdir(parents=True, exist_ok=True)

    size = CFG["size"]
    base = base_image(size)
    base.save(out / "edit" / "base.png")
    for name in CFG["edit"]["boxes"]:
        mask_image(name, size).save(out / "masks" / f"{name}.png")

    results = {
        "kind": "edit", "model": model, "repo": m["repo"], "licence": m["licence"], "size": size,
        "steps": m["steps"], "true_cfg_scale": m.get("true_cfg_scale"), "guidance_scale": m.get("guidance_scale"),
        "dtype": m["dtype"],
        "boxes": {n: scaled_box(n, size) for n in CFG["edit"]["boxes"]},
        "versions": {"python": platform.python_version(), "torch": torch.__version__,
                     "diffusers": diffusers.__version__, "macos": platform.mac_ver()[0]},
        "timing": {}, "memory": {}, "files": [],
    }

    def mem(stage):
        results["memory"][stage] = {
            "mps_allocated_gb": round(torch.mps.current_allocated_memory() / 2**30, 2),
            "mps_driver_gb": round(torch.mps.driver_allocated_memory() / 2**30, 2),
        }

    t0 = time.time()
    pipe = Pipeline.from_pretrained(m["repo"], revision=m["revision"],
                                    torch_dtype=getattr(torch, m["dtype"]), local_files_only=True)
    pipe.to(m["device"])
    pipe.set_progress_bar_config(disable=True)
    results["timing"]["load_s"] = round(time.time() - t0, 2)
    mem("after_load")
    print(f"loaded in {results['timing']['load_s']} s", flush=True)

    def edit(image, prompt, seed):
        gen = torch.Generator(m["device"]).manual_seed(seed)
        kwargs = {"image": image, "prompt": prompt, "num_inference_steps": m["steps"], "generator": gen}
        if "true_cfg_scale" in m:  # Qwen-Image-Edit: a second, unconditioned pass when scale > 1
            kwargs.update(true_cfg_scale=m["true_cfg_scale"], negative_prompt=m["negative_prompt"])
        if "guidance_scale" in m:  # FLUX.2 klein: guidance is part of the distilled model's settings
            kwargs.update(guidance_scale=m["guidance_scale"])
        with torch.inference_mode():
            result = pipe(**kwargs).images[0]
        torch.mps.synchronize()
        result = result.convert("RGB")
        if result.size != tuple(size):
            print(f"note: output {result.size} resized to {size}", flush=True)
            result = result.resize(tuple(size), Image.LANCZOS)
        return result

    seed = CFG["seeds"][0]
    timing = m["timing"]
    times = []
    first_prompt = CFG["edit"]["tests"][0]["prompt"]
    for i in range(timing["warmup"] + timing["runs"]):
        t = time.time()
        img = edit(base, first_prompt, seed)
        dt = time.time() - t
        if i >= timing["warmup"]:
            times.append(dt)
            img.save(out / "timing" / f"t{i}.png")
        print(f"timing {i}: {dt:.2f} s", flush=True)
    results["timing"]["per_edit_s"] = [round(x, 2) for x in times]
    results["timing"]["median_s"] = round(sorted(times)[len(times) // 2], 2)
    mem("after_timing")

    chain_img = base
    for test, name, prompt, box, source in jobs():
        if test == "edit":
            img = edit(base, prompt, seed)
            rel = f"edit/{name}.png"
        else:
            img = edit(chain_img, prompt, seed)
            rel = f"drift/{name}.png"
            chain_img = img
        img.save(out / rel)
        results["files"].append({"test": test, "file": rel, "prompt": prompt, "box": box})
        print(rel, flush=True)
    mem("after_all")

    # Blind copies of the single edits and the drift steps, shuffled.
    rng = random.Random(0)
    picked = [f for f in results["files"]]
    rng.shuffle(picked)
    key = {}
    for n, f in enumerate(picked):
        blind = f"b{n:03d}.png"
        shutil.copy(out / f["file"], out / "blind" / blind)
        key[blind] = f["file"]
    (out / "blind" / "key.json").write_text(json.dumps(key, indent=2))

    import resource
    import sys
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    results["memory"]["peak_rss_gb"] = round(rss / 2**30 if sys.platform == "darwin" else rss / 2**20, 2)
    (out / "results.json").write_text(json.dumps(results, indent=2))

    del pipe, img
    gc.collect()
    torch.mps.empty_cache()
    print(f"done: {out}", flush=True)
    return out

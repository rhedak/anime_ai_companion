#!/usr/bin/env python3
"""Generation half of the image-model benchmark. One model per process.

    python3 bench.py plan --model zimage-turbo      # lists the jobs, imports no model library
    python3 bench.py run  --model zimage-turbo      # loads the model, makes every picture, exits

The process exit is what frees the model's memory, so run_all.sh starts one of these per model.
Scoring is in score.py, run after this process has exited, so only one model is ever loaded.
"""

import argparse
import json
import resource
import shutil
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
CFG = json.loads((HERE / "config.json").read_text())


def subject(outfit):
    return CFG["subject"].replace("{outfit}", CFG["outfits"][outfit])


def jobs():
    """Every picture the run makes: (test, name, prompt, seed). Timing runs are separate."""
    seed = CFG["seeds"][0]
    base = f'{subject("uniform")}, {CFG["neutral_clause"]}'
    out = [("identity", "base", base, seed)]
    for key, clause in CFG["emotions"].items():
        out.append(("identity", key, f'{subject("uniform")}, {clause}', seed))
    for key in ("sundress", "hoodie"):
        out.append(("identity", key, f'{subject(key)}, {CFG["neutral_clause"]}', seed))
    for i, prompt in enumerate(CFG["quality_prompts"]):
        for s in CFG["seeds"]:
            out.append(("quality", f"q{i:02d}-s{s}", prompt, s))
    return out


def timing_prompt():
    return f'{subject("uniform")}, {CFG["neutral_clause"]}'


def plan(model):
    m = CFG["models"][model]
    j = jobs()
    t = CFG["timing"]["warmup"] + CFG["timing"]["runs"]
    print(f"model: {model}  ({m['repo']}, {m['licence']}, {m['kind']})")
    print(f"size: {CFG['size'][0]}x{CFG['size'][1]}, steps {m['steps']}, guidance {m['guidance']}")
    print(f"timing: {CFG['timing']['warmup']} warm-up + {CFG['timing']['runs']} timed runs")
    print(f"pictures: {t} timing + {len(j)} planned ({sum(1 for x in j if x[0] == 'identity')} identity, "
          f"{sum(1 for x in j if x[0] == 'quality')} quality)")
    ref = Path(CFG["reference"])
    missing = [n for n in ["neutral.webp"] + [f"{k}.webp" for k in CFG["emotions"]] if not (ref / n).exists()]
    print(f"reference: {ref} -> {'OK' if not missing else 'MISSING ' + ', '.join(missing)}")
    print(f"verify before running: {m['verify']}")
    return 0 if not missing else 1


def run(model):
    import gc
    import platform

    import torch
    import diffusers

    m = CFG["models"][model]
    # Pipeline class per model; Z-Image-Turbo is the default for configs written before this option.
    Pipeline = getattr(diffusers, m.get("pipeline", "ZImagePipeline"))
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out = HERE / "runs" / f"{model}-{stamp}"
    for sub in ("timing", "identity", "quality", "blind"):
        (out / sub).mkdir(parents=True, exist_ok=True)

    results = {
        "model": model, "repo": m["repo"], "licence": m["licence"], "size": CFG["size"],
        "steps": m["steps"], "guidance": m["guidance"], "dtype": m["dtype"],
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
    pipe = Pipeline.from_pretrained(m["repo"], revision=m["revision"], torch_dtype=getattr(torch, m["dtype"]),
                                    local_files_only=True)
    pipe.to(m["device"])
    results["timing"]["load_s"] = round(time.time() - t0, 2)
    mem("after_load")
    print(f"loaded in {results['timing']['load_s']} s", flush=True)

    w, h = CFG["size"]

    def make(prompt, seed):
        gen = torch.Generator(m["device"]).manual_seed(seed)
        image = pipe(prompt=prompt, width=w, height=h, num_inference_steps=m["steps"],
                     guidance_scale=m["guidance"], generator=gen).images[0]
        torch.mps.synchronize()
        return image

    # Timing: same prompt, fixed seed; the warm-up runs are thrown away.
    times = []
    for i in range(CFG["timing"]["warmup"] + CFG["timing"]["runs"]):
        t = time.time()
        img = make(timing_prompt(), CFG["seeds"][0])
        dt = time.time() - t
        if i >= CFG["timing"]["warmup"]:
            times.append(dt)
            img.save(out / "timing" / f"t{i}.png")
        print(f"timing {i}: {dt:.2f} s", flush=True)
    results["timing"]["per_picture_s"] = [round(x, 2) for x in times]
    results["timing"]["median_s"] = round(sorted(times)[len(times) // 2], 2)
    mem("after_timing")

    # Identity and quality pictures.
    for test, name, prompt, seed in jobs():
        img = make(prompt, seed)
        rel = f"{test}/{name}.png"
        img.save(out / rel)
        results["files"].append({"test": test, "file": rel, "prompt": prompt, "seed": seed})
        print(f"{rel}", flush=True)
    mem("after_all")

    # Blind copies: shuffled names, so the scores can be given before the model is known.
    import random
    rng = random.Random(0)
    picked = [f for f in results["files"] if f["test"] == "quality"] + \
             [f for f in results["files"] if f["test"] == "identity"]
    rng.shuffle(picked)
    key = {}
    for n, f in enumerate(picked):
        blind = f"b{n:03d}.png"
        shutil.copy(out / f["file"], out / "blind" / blind)
        key[blind] = f["file"]
    (out / "blind" / "key.json").write_text(json.dumps(key, indent=2))

    results["memory"]["peak_rss_gb"] = round(
        resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**30 if sys.platform == "darwin"
        else resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20, 2)
    (out / "results.json").write_text(json.dumps(results, indent=2))

    # Free everything before the process exits, so the log shows the release.
    del pipe, img
    gc.collect()
    torch.mps.empty_cache()
    print(f"done: {out}", flush=True)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["plan", "run"])
    ap.add_argument("--model", required=True, choices=list(CFG["models"]))
    args = ap.parse_args()
    if CFG["models"][args.model]["kind"] == "edit":
        import bench_edit
        if args.command == "plan":
            return bench_edit.plan(args.model)
        bench_edit.run(args.model)
        return 0
    if args.command == "plan":
        return plan(args.model)
    run(args.model)
    return 0


if __name__ == "__main__":
    sys.exit(main())

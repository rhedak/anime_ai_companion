#!/usr/bin/env python3
"""Scoring half of the benchmark. Run after bench.py has exited, so only this model is loaded.

    python3 score.py runs/<model>-<stamp>

Writes scores.json and scores.csv into the run folder. Scores need DINOv2 (facebook/dinov2-small,
Apache-2.0). Its weights are a separate download and are only fetched when this runs.
"""

import csv
import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from transformers import AutoImageProcessor, AutoModel

HERE = Path(__file__).resolve().parent
CFG = json.loads((HERE / "config.json").read_text())
EMBED_MODEL = "facebook/dinov2-small"


def load_rgb(path):
    """Composite onto white so transparent pack pictures and opaque generated ones compare on one ground."""
    img = Image.open(path).convert("RGBA")
    bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
    return Image.alpha_composite(bg, img).convert("RGB")


class Embedder:
    def __init__(self):
        e = CFG["embedder"]
        self.proc = AutoImageProcessor.from_pretrained(e["repo"], revision=e["revision"], local_files_only=True)
        self.model = AutoModel.from_pretrained(e["repo"], revision=e["revision"], local_files_only=True).eval()

    @torch.no_grad()
    def __call__(self, img):
        out = self.model(**self.proc(images=img, return_tensors="pt"))
        v = out.last_hidden_state[:, 0]  # CLS token
        return torch.nn.functional.normalize(v, dim=-1)[0]


def cos(a, b):
    return float((a @ b).item())


def border_whiteness(img, tol):
    """Share of the outer 2% ring of pixels that are close to pure white. A plain background is
    keyable (test F) when this is near 1 and the rest of the ring is the same colour."""
    a = np.asarray(img).astype(int)
    h, w, _ = a.shape
    r = max(1, int(0.02 * min(h, w)))
    ring = np.concatenate([a[:r].reshape(-1, 3), a[-r:].reshape(-1, 3),
                           a[:, :r].reshape(-1, 3), a[:, -r:].reshape(-1, 3)])
    white = np.all(np.abs(ring - 255) <= tol, axis=1).mean()
    return round(float(white), 3)


def score_edit(run, results):
    """Edit models: how much changed outside the allowed box (should be near zero), how much
    changed inside it (the edit happened), identity to the base, and drift along the chain."""
    emb = Embedder()
    base = load_rgb(run / "edit" / "base.png")
    base_emb = emb(base)
    a_base = np.asarray(base).astype(int)
    thr = CFG["edit"]["inside_threshold"]
    rows = []
    for f in results["files"]:
        img = load_rgb(run / f["file"])
        a = np.asarray(img).astype(int)
        x0, y0, x1, y1 = results["boxes"][f["box"]]
        inside = np.zeros(a.shape[:2], dtype=bool)
        inside[y0:y1, x0:x1] = True
        diff = np.abs(a - a_base).max(axis=2)
        out_px = diff[~inside]
        in_px = diff[inside]
        rows.append({
            "file": f["file"],
            "test": f["test"],
            "box": f["box"],
            "outside_mean_diff": round(float(out_px.mean()), 2),
            "outside_changed_share": round(float((out_px > thr).mean()), 4),
            "inside_mean_diff": round(float(in_px.mean()), 2),
            "vs_base": round(cos(emb(img), base_emb), 3),
        })
    timing = results["timing"]
    drift = [r for r in rows if r["test"] == "drift"]
    singles = [r for r in rows if r["test"] == "edit"]
    summary = {
        "load_s": timing["load_s"],
        "median_s_per_edit": timing["median_s"],
        "peak_rss_gb": results["memory"]["peak_rss_gb"],
        "outside_mean_diff_median": round(float(np.median([r["outside_mean_diff"] for r in singles])), 2),
        "outside_changed_share_max": max(r["outside_changed_share"] for r in singles),
        "inside_mean_diff_min": min(r["inside_mean_diff"] for r in singles),
        "identity_vs_base_min_single": min(r["vs_base"] for r in singles),
        "drift_vs_base": [r["vs_base"] for r in drift],
    }
    (run / "scores.json").write_text(json.dumps({"summary": summary, "rows": rows}, indent=2))
    with open(run / "scores.csv", "w", newline="") as fh:
        wr = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        wr.writeheader()
        wr.writerows(rows)
    print(json.dumps(summary, indent=2))


def main(run_dir):
    run = Path(run_dir)
    results = json.loads((run / "results.json").read_text())
    if results.get("kind") == "edit":
        return score_edit(run, results)
    ref = Path(CFG["reference"])
    emb = Embedder()
    tol = CFG["matte_tolerance"]

    # Calibration: the Risa uniform pack's own pictures, scored against its neutral picture.
    neutral_ref = emb(load_rgb(ref / "neutral.webp"))
    ref_names = [f"{k}.webp" for k in CFG["emotions"]] + ["wave-1.webp", "wave-2.webp", "cheer-1.webp", "cheer-2.webp"]
    calib = {}
    for n in ref_names:
        p = ref / n
        if p.exists():
            calib[n] = round(cos(emb(load_rgb(p)), neutral_ref), 3)
    vals = sorted(calib.values())
    calibration = {"vs_risa_neutral": calib,
                   "min": vals[0] if vals else None,
                   "median": vals[len(vals) // 2] if vals else None}

    # Identity: each picture against the model's own base (consistency) and the Risa look (target).
    base_img = load_rgb(run / "identity" / "base.png")
    base_emb = emb(base_img)
    rows = []
    for f in results["files"]:
        if f["test"] != "identity":
            continue
        img = load_rgb(run / f["file"])
        e = emb(img)
        rows.append({
            "file": f["file"],
            "vs_base": round(cos(e, base_emb), 3),
            "vs_risa_neutral": round(cos(e, neutral_ref), 3),
            "border_white": border_whiteness(img, tol),
        })

    # Test F on the quality pictures: plain background check only, no embedding needed.
    for f in results["files"]:
        if f["test"] == "quality":
            rows.append({"file": f["file"], "border_white": border_whiteness(load_rgb(run / f["file"]), tol)})

    timing = results["timing"]
    summary = {
        "load_s": timing["load_s"],
        "median_s_per_picture": timing["median_s"],
        "peak_rss_gb": results["memory"]["peak_rss_gb"],
        "calibration_min": calibration["min"],
        "calibration_median": calibration["median"],
    }
    idv = [r["vs_base"] for r in rows if "vs_base" in r and r["file"] != "identity/base.png"]
    summary["identity_vs_base_min"] = min(idv, default=None)
    summary["identity_vs_base_mean"] = round(sum(idv) / len(idv), 3) if idv else None
    bq = [r["border_white"] for r in rows if r["file"].startswith("quality/")]
    summary["border_white_mean_quality"] = round(sum(bq) / len(bq), 3) if bq else None

    (run / "scores.json").write_text(json.dumps({"summary": summary, "calibration": calibration, "rows": rows}, indent=2))
    fields = ["file", "vs_base", "vs_risa_neutral", "border_white"]
    with open(run / "scores.csv", "w", newline="") as fh:
        wr = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        wr.writeheader()
        wr.writerows(rows)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main(sys.argv[1])

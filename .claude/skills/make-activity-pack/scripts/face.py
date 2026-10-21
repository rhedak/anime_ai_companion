"""Locate the irises (teal), head top and the face midline in a 940x1070 RGBA frame."""
import sys
import numpy as np
from PIL import Image
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from inventory import label_runs

def irises(arr, ymax=0.26):
    a = arr[..., 3] > 128
    r, g, b = arr[..., 0].astype(int), arr[..., 1].astype(int), arr[..., 2].astype(int)
    H, W = a.shape
    teal = a & (g > r + 25) & (b > r + 25) & (g > 90)
    teal[int(H * ymax):] = False
    comp = label_runs(teal)
    big = sorted(((v[0], k, v[1:]) for k, v in comp.items() if v[0] > 40), reverse=True)[:4]
    return [(area, box) for area, k, box in big]

def measure(path):
    arr = np.asarray(Image.open(path).convert("RGBA"))
    a = arr[..., 3] > 128
    H, W = a.shape
    cols = np.nonzero(a[: int(H * 0.2)].any(axis=0))[0]
    top = int(np.nonzero(a.any(axis=1))[0].min())
    irs = irises(arr)
    eyes = sorted([((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, b[2] - b[0] + 1, b[3] - b[1] + 1, area) for area, b in irs])
    return top, eyes

if __name__ == "__main__":
    for n in ["neutral", "happy", "sad", "angry", "surprised", "shy", "thinking", "wave-1", "wave-2", "cheer-1", "cheer-2", "activity-swimming-1", "activity-swimming-2", "activity-swimming-3", "activity-swimming-4"]:
        top, eyes = measure(f"frames-raw/{n}.png")
        print(f"{n:22s} top {top:4d}  iris blobs:", [(round(e[0]), round(e[1]), e[2], e[3]) for e in eyes])

"""Step 2: every frame of the pack as lossless WebP in out/ (run from the folder that holds frames-raw/, with these scripts on the path).

    python3 -I build.py            # emotions (rest, blink, talk1-3), poses, then the activity loops and their talking sets

The activity loop names and the talk pattern are the ones used for Risa's and Draconia's packs: four frames, frame 4 = frame 2, mouths [talk2, talk3, talk2, talk1].
"""
import os, shutil, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blink import blink_frame
from mouth import cheer_patch, talk_frames

EMOTIONS = {"neutral": {}, "happy": {}, "sad": {}, "angry": {}, "surprised": dict(rx=47, top_margin=19), "shy": {}, "thinking": {}}
ACTIVITIES = os.environ.get("ACTIVITIES", "swimming").split(",")
OUT = "out/"
os.makedirs(OUT, exist_ok=True); os.makedirs("tmp", exist_ok=True)

def webp(src, name):
    Image.open(src).convert("RGBA").save(OUT + name + ".webp", "WEBP", lossless=True, quality=100, method=6, exact=True)

patch, sang = cheer_patch()  # the open mouth of cheer-1, so make the poses first
for e, kw in EMOTIONS.items():
    webp(f"frames-raw/{e}.png", e)
    blink_frame(f"frames-raw/{e}.png", f"tmp/{e}-blink.png", **kw)
    webp(f"tmp/{e}-blink.png", f"{e}-blink")
    outs, _ = talk_frames(f"frames-raw/{e}.png", f"tmp/{e}-talk", patch, sang)
    for i, p in enumerate(outs, 1):
        webp(p, f"{e}-talk{i}")
for p in ["wave-1", "wave-2", "cheer-1", "cheer-2"]:
    webp(f"frames-raw/{p}.png", p)
pattern = [1, 2, 1, 0]
for act in ACTIVITIES:
    for n in range(1, 5):
        webp(f"frames-raw/activity-{act}-{n}.png", f"activity-{act}-{n}")
        outs, _ = talk_frames(f"frames-raw/activity-{act}-{n}.png", f"tmp/{act}{n}-talk", patch, sang)
        shutil.copy(outs[pattern[n - 1]], f"tmp/activity-{act}-talk-{n}.png")
        webp(f"tmp/activity-{act}-talk-{n}.png", f"activity-{act}-talk-{n}")
print(len(os.listdir(OUT)), "frames")

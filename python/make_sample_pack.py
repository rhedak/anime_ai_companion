"""Draws a sample frame pack from one of the creator's presets: the same pictures the drawn avatar
shows, as PNG files named the way `src/frame-pack.ts` expects. It is a way to see the format, and
a reference for what an AI-made set has to contain.

    CREATOR_SRC=../anime-character-creator/src uv run --with cairosvg python python/make_sample_pack.py data/frames/linnea
    options: --preset NAME  --width PIXELS (default 580)  --full (whole body instead of the close-up)

cairosvg needs the cairo library (macOS: `brew install cairo`; the creator's render.sh sets the path
Homebrew uses). Nothing here is part of the running app.
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

for prefix in ("/opt/homebrew/lib", "/usr/local/lib"):  # cairosvg finds libcairo through dlopen
    os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = os.environ.get("DYLD_FALLBACK_LIBRARY_PATH", "") + ":" + prefix

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, os.environ.get("CREATOR_SRC") or str((root.parent / "anime-character-creator" / "src")))

import cairosvg  # noqa: E402
from anime_character_creator import PRESETS, render_character  # noqa: E402
from anime_character_creator.urlstate import params_from_dict, params_to_dict  # noqa: E402

CLOSE_UP = (55, 0, 290, 330)  # the same crop the page uses for the drawn avatar
FULL_BODY = (0, 0, 400, 500)
TALK_OPENINGS = (0.3, 0.55, 0.85)  # what the page cycles through while she talks

parser = argparse.ArgumentParser()
parser.add_argument("out")
parser.add_argument("--preset", default="linnea")
parser.add_argument("--width", type=int, default=580)
parser.add_argument("--full", action="store_true")
args = parser.parse_args()

if args.preset not in PRESETS:
    sys.exit(f"unknown preset '{args.preset}'. Presets: {', '.join(PRESETS)}")

x, y, w, h = FULL_BODY if args.full else CLOSE_UP
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
emotions = json.loads((root / "emotions.json").read_text())
base = params_to_dict(PRESETS[args.preset])


def save(face, name, mouth, closed=False):
    character = json.loads(json.dumps(base))
    character["face"].update(face)
    character["face"]["mouth_open"] = mouth
    character["face"]["eyes_closed"] = closed
    svg = render_character(params_from_dict(character))
    svg = re.sub(r'viewBox="[^"]*"', f'viewBox="{x} {y} {w} {h}"', svg, count=1)
    svg = re.sub(r'(<svg[^>]*?)\swidth="[^"]*"', r"\1", svg, count=1)
    svg = re.sub(r'(<svg[^>]*?)\sheight="[^"]*"', r"\1", svg, count=1)
    cairosvg.svg2png(bytestring=svg.encode(), write_to=str(out / name), output_width=args.width, output_height=round(args.width * h / w))


for emotion, face in emotions.items():
    rest = face.get("mouth_open", base["face"].get("mouth_open", 0))
    save(face, f"{emotion}.png", rest)
    save(face, f"{emotion}-blink.png", rest, closed=True)
    for n, opening in enumerate(TALK_OPENINGS, start=1):
        save(face, f"{emotion}-talk{n}.png", max(rest, opening))

print(f"wrote {len(emotions) * (2 + len(TALK_OPENINGS))} pictures to {out}")

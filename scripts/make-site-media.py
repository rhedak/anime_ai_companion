"""Makes the animated pictures of the README and the site (site/assets/*.gif) from the activity pictures of the packs.

    uv run --with pillow --with numpy python -I scripts/make-site-media.py [--packs ../anime_ai_companion-packs/packs-src] [--out site/assets]

Needs ffmpeg. Only original characters (Risa and Franzi, MIT) are used. Every picture is put on the page's own dark panel colour, so the GIFs are
small and look the same on GitHub and on the site. Each loop is played at 12 pictures a second, the way the app plays it.
"""
import argparse, math, pathlib, shutil, subprocess, sys, tempfile
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("--packs", default="../anime_ai_companion-packs/packs-src")
ap.add_argument("--app-packs", default="packs")
ap.add_argument("--out", default="site/assets")
args = ap.parse_args()
PACKS, APP, OUT = pathlib.Path(args.packs), pathlib.Path(args.app_packs), pathlib.Path(args.out)
BG = (31, 24, 64)  # --panel of the site
FPS = 12

# (file name, pack folder, activity, width)
LOOPS = [
    ("dancing", APP / "franzi-dress", "dancing", 300),
    ("tennis", PACKS / "risa-tennis", "tennis", 300),
    ("swimming", PACKS / "risa-bikini", "swimming", 300),
    ("cooking", PACKS / "franzi-casual", "cooking", 300),
]


def frames(folder, activity):
    files = sorted(folder.glob(f"activity-{activity}-[0-9]*.webp"), key=lambda p: int(p.stem.rsplit("-", 1)[1]))
    if not files:
        sys.exit(f"no {activity} pictures in {folder}")
    return files


def flat(path, width):
    im = Image.open(path).convert("RGBA")
    h = round(width * im.height / im.width)
    im = im.resize((width, h), Image.LANCZOS)
    base = Image.new("RGBA", im.size, BG + (255,))
    base.alpha_composite(im)
    return base.convert("RGB")


def gif(images, target, colors=96):
    with tempfile.TemporaryDirectory() as tmp:
        for i, im in enumerate(images):
            im.save(f"{tmp}/f{i:04d}.png")
        palette = f"{tmp}/palette.png"
        subprocess.run(["ffmpeg", "-v", "error", "-framerate", str(FPS), "-i", f"{tmp}/f%04d.png", "-vf", f"palettegen=max_colors={colors}:stats_mode=full", palette], check=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(FPS), "-i", f"{tmp}/f%04d.png", "-i", palette, "-lavfi", "paletteuse=dither=bayer:bayer_scale=4", "-loop", "0", str(target)], check=True)
        # The site plays the same pictures as a looping video (a quarter of the weight of the GIF or less); the GIF stays for the README, where video does not play.
        video = target.with_suffix(".mp4")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(FPS), "-i", f"{tmp}/f%04d.png", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-movflags", "+faststart", "-an", str(video)], check=True)
        print(f"{video}: {video.stat().st_size // 1024} KB")
    print(f"{target}: {len(images)} pictures, {target.stat().st_size // 1024} KB")


OUT.mkdir(parents=True, exist_ok=True)

# One GIF for each loop.
loops = {}
for name, folder, activity, width in LOOPS:
    files = frames(folder, activity)
    loops[name] = [flat(f, width) for f in files]
    gif(loops[name], OUT / f"activity-{name}.gif")

# The hero: three loops side by side, each at its own length (the whole thing is 72 pictures: 6 seconds).
trio = ["dancing", "tennis", "swimming"]
n = 72
w, h = loops[trio[0]][0].size
hero = []
for t in range(n):
    sheet = Image.new("RGB", (w * len(trio), h), BG)
    for k, name in enumerate(trio):
        sheet.paste(loops[name][t % len(loops[name])], (k * w, 0))
    hero.append(sheet)
gif(hero, OUT / "hero-activities.gif", colors=96)

# The wardrobe: one character, five outfits, cross-faded.
OUTFITS = [("risa-dress", APP), ("risa-casual", PACKS), ("risa-uniform", PACKS), ("risa-green-coat", PACKS), ("risa-tennis", PACKS)]
ww = 300
stills = []
for pack, base in OUTFITS:
    path = base / pack / "neutral.webp"
    if not path.exists():
        print("missing", path)
        continue
    stills.append(flat(path, ww))
seq = []
hold, fade = 14, 6
for i, a in enumerate(stills):
    b = stills[(i + 1) % len(stills)]
    seq += [a] * hold
    for k in range(1, fade):
        seq.append(Image.blend(a, b, k / fade))
gif(seq, OUT / "wardrobe.gif", colors=128)

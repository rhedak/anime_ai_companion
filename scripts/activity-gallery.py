"""Makes a local gallery of every activity loop the packs have: one GIF and one MP4 for each, and an index.html that shows them all.

    uv run --with pillow --with numpy python -I scripts/activity-gallery.py [--out local/activity-gallery] [--bg panel|transparent|white|#rrggbb]
                                                                              [--width 400] [--talk] [--only risa,swimming] [--no-mp4]

For local checks and for picking something to post. A new activity (pictures named `activity-<name>-<n>.webp` in a pack) appears the next time it runs,
with nothing to add here. It looks in the app's `packs/` and the packs repository's `packs-src/` (`--packs`, `--app-packs`); a pack that is in both is
taken from the app. `--talk` adds the loop with her mouth moving (the `activity-<name>-talk-<n>` pictures laid over the quiet ones, the way the app plays it).
`--only` keeps the loops whose pack, character or activity name contains one of the words. Needs ffmpeg. The default output folder is git-ignored.

Every loop is played the way the app plays it: more than eight pictures at twelve a second, fewer at three. The pictures of the Draconia and Miku packs are
unofficial fan art and not MIT: the index says so, so check the pack's NOTICE.md before posting one of them anywhere.
"""
import argparse, html, pathlib, re, subprocess, sys, tempfile
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("--packs", default="../anime_ai_companion-packs/packs-src")
ap.add_argument("--app-packs", default="packs")
ap.add_argument("--out", default="local/activity-gallery")
ap.add_argument("--bg", default="panel", help="panel (the site's dark colour), transparent (GIF with a cut-out edge), white, or a hex colour like #202020")
ap.add_argument("--width", type=int, default=400)
ap.add_argument("--talk", action="store_true", help="also make the loop with the talking mouths")
ap.add_argument("--only", default="", help="comma separated words: keep a loop if its pack, character or activity contains one")
ap.add_argument("--no-mp4", action="store_true")
args = ap.parse_args()
OUT = pathlib.Path(args.out)
ONLY = [w.strip().lower() for w in args.only.split(",") if w.strip()]
PANEL = (31, 24, 64)
BG = {"panel": PANEL, "white": (255, 255, 255), "transparent": None}.get(args.bg)
if BG is None and args.bg != "transparent":
    m = re.fullmatch(r"#([0-9a-fA-F]{6})", args.bg)
    if not m:
        sys.exit("--bg is panel, transparent, white or #rrggbb")
    BG = tuple(int(m.group(1)[i : i + 2], 16) for i in (0, 2, 4))

NUMBERED = re.compile(r"^activity-([a-z0-9]+)-(\d+)\.webp$")
TALK = re.compile(r"^activity-([a-z0-9]+)-talk-(\d+)\.webp$")


def read_lines(path):
    try:
        return path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []


def pack_info(folder):
    """The character id (look.txt's `character:` line), the credit line and whether the pack says it is not MIT."""
    character = next((l.split(":", 1)[1].strip() for l in read_lines(folder / "look.txt") if l.lower().startswith("character:")), folder.name.split("-")[0])
    credit = next((l.strip() for l in read_lines(folder / "credit.txt") if l.strip()), "")
    notice = " ".join(read_lines(folder / "NOTICE.md")).lower()
    fan_art = bool(re.search(r"not under the mit|unofficial", notice))
    return character, credit, fan_art


def find_loops():
    """{(pack, activity): (folder, quiet files, talking files)}; the app's copy of a pack wins over the packs repository's."""
    found = {}
    for root in (pathlib.Path(args.packs), pathlib.Path(args.app_packs)):  # the app last, so it replaces
        if not root.is_dir():
            print(f"(no folder {root})", file=sys.stderr)
            continue
        for folder in sorted(p for p in root.iterdir() if p.is_dir()):
            quiet, talk = {}, {}
            for f in folder.iterdir():
                if m := NUMBERED.match(f.name):
                    quiet.setdefault(m.group(1), []).append((int(m.group(2)), f))
                elif m := TALK.match(f.name):
                    talk.setdefault(m.group(1), []).append((int(m.group(2)), f))
            for name, pics in quiet.items():
                found[(folder.name, name)] = (folder, [f for _, f in sorted(pics)], [f for _, f in sorted(talk.get(name, []))])
    return found


def flat(path, width, talk=None):
    im = Image.open(path).convert("RGBA")
    if talk is not None:  # the talking picture is a patch of the quiet one with the same number: the whole picture, drawn over
        base = im
        im = Image.open(talk).convert("RGBA")
        base = base.copy()
        base.alpha_composite(im)
        im = base
    height = round(width * im.height / im.width)
    im = im.resize((width, height), Image.LANCZOS)
    if BG is None:
        return im
    back = Image.new("RGBA", im.size, BG + (255,))
    back.alpha_composite(im)
    return back.convert("RGB")


def render(images, fps, target):
    """A GIF and an MP4 of the pictures (the MP4 has no transparency: with --bg transparent it is made on the panel colour)."""
    with tempfile.TemporaryDirectory() as tmp:
        for i, im in enumerate(images):
            im.save(f"{tmp}/f{i:04d}.png")
        gif_filter = "palettegen=max_colors=128:reserve_transparent=1" if BG is None else "palettegen=max_colors=128:stats_mode=full"
        use = "paletteuse=dither=bayer:bayer_scale=4:alpha_threshold=128" if BG is None else "paletteuse=dither=bayer:bayer_scale=4"
        subprocess.run(["ffmpeg", "-v", "error", "-framerate", str(fps), "-i", f"{tmp}/f%04d.png", "-vf", gif_filter, f"{tmp}/palette.png"], check=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(fps), "-i", f"{tmp}/f%04d.png", "-i", f"{tmp}/palette.png", "-lavfi", use, "-loop", "0", str(target.with_suffix(".gif"))], check=True)
        if not args.no_mp4:
            if BG is None:  # video has no alpha: flatten onto the panel colour
                for i, im in enumerate(images):
                    back = Image.new("RGBA", im.size, PANEL + (255,))
                    back.alpha_composite(im)
                    back.convert("RGB").save(f"{tmp}/f{i:04d}.png")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(fps), "-i", f"{tmp}/f%04d.png", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-movflags", "+faststart", "-an", str(target.with_suffix(".mp4"))], check=True)


loops = find_loops()
if not loops:
    sys.exit("no activity pictures found (looked in --packs and --app-packs)")
OUT.mkdir(parents=True, exist_ok=True)
cards = []
for (pack, activity), (folder, quiet, talk) in sorted(loops.items(), key=lambda kv: (pack_info(kv[1][0])[0], kv[0][1], kv[0][0])):
    character, credit, fan_art = pack_info(folder)
    if ONLY and not any(w in f"{pack} {character} {activity}".lower() for w in ONLY):
        continue
    fps = 12 if len(quiet) > 8 else 3
    variants = [("", [flat(f, args.width) for f in quiet])]
    if args.talk and len(talk) == len(quiet):
        variants.append(("-talking", [flat(f, args.width, t) for f, t in zip(quiet, talk)]))
    elif args.talk:
        print(f"{pack} {activity}: no talking pictures ({len(talk)} for {len(quiet)})")
    files = []
    for suffix, images in variants:
        target = OUT / f"{pack}-{activity}{suffix}"
        render(images, fps, target)
        size = target.with_suffix(".gif").stat().st_size
        print(f"{target.with_suffix('.gif')}: {len(images)} pictures at {fps}/s, {size // 1024} KB")
        files.append((suffix, target.name + ".gif", target.name + ".mp4", len(images), size))
    cards.append((character, pack, activity, fps, credit, fan_art, files))

# The index: every loop, grouped by character, with its numbers and any licence warning.
rows = []
last = None
for character, pack, activity, fps, credit, fan_art, files in cards:
    if character != last:
        rows.append(f"<h2>{html.escape(character)}</h2>")
        last = character
    for suffix, gif, mp4, n, size in files:
        warn = '<p class="warn">Unofficial fan art, not MIT: read the pack\'s NOTICE.md before posting.</p>' if fan_art else ""
        mp4_link = "" if args.no_mp4 else f' · <a href="{html.escape(mp4)}">mp4</a>'
        rows.append(
            f'<figure><img src="{html.escape(gif)}" alt="{html.escape(pack)} {html.escape(activity)}" loading="lazy">'
            f"<figcaption><b>{html.escape(activity)}{html.escape(suffix)}</b> · {html.escape(pack)}<br>{n} pictures at {fps}/s · {size // 1024} KB · "
            f'<a href="{html.escape(gif)}">gif</a>{mp4_link}{warn}</figcaption></figure>'
        )
page = f"""<!doctype html>
<meta charset="utf-8"><title>Activity gallery</title>
<style>
body {{ background: #{PANEL[0]:02x}{PANEL[1]:02x}{PANEL[2]:02x}; color: #eee; font: 15px system-ui, sans-serif; margin: 24px; }}
h1, h2 {{ font-weight: 600; }} h2 {{ margin: 32px 0 8px; text-transform: capitalize; border-bottom: 1px solid #fff3; }}
figure {{ display: inline-block; margin: 8px 16px 16px 0; vertical-align: top; }}
img {{ display: block; max-width: {args.width}px; background: #{"%02x%02x%02x" % (BG or PANEL)}; }}
figcaption {{ max-width: {args.width}px; margin-top: 6px; color: #ccc; font-size: 13px; }} a {{ color: #f4a58a; }} .warn {{ color: #ffb454; margin: 4px 0 0; }}
</style>
<h1>Activity gallery</h1>
<p>{len(cards)} loops, made {__import__("datetime").date.today()} by scripts/activity-gallery.py. Local only: this folder is git-ignored.</p>
{chr(10).join(rows)}
"""
(OUT / "index.html").write_text(page, encoding="utf-8")
print(f"{OUT / 'index.html'}: {len(cards)} loops")

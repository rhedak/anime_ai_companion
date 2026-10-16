#!/usr/bin/env python3
"""Writes test/fixtures/render-ops.json: a large, deterministic set of requests for the renderer and Python's exact reply to each.

This is the oracle for src/render-ops.ts. python/render_ops.py (the frozen Python implementation of the request handling, run against the
frozen Python creator) answers every request; test/render-ops.test.ts replays the same requests through the TypeScript and compares.
Python is needed only to REGENERATE the file (a rare job: when the oracle should cover more); the test needs no Python. python/render_ops.py is
kept for exactly this job: neither the server nor the browser demo runs it any more, it is the frozen reference this script asks.

    CREATOR_SRC=../anime-character-creator-ts/src uv run --no-project --python 3.13 scripts/gen-render-ops-fixtures.py

CREATOR_SRC is the Python creator's `src` folder (the frozen Python package on the creator's ts-port branch, or any with the same behaviour). Use CPython 3.13: its error
texts (`unhashable type: 'list'`, JSON decode errors) are the ones the creator's TypeScript was verified against, and 3.14 words some of them differently.
The output is deterministic: running it twice gives the same bytes.

What the file holds (the same shape the test reads):
  meta        what made it (the Python version, the numbers of cases) and how the shortened values are written
  characters  named characters, each stored once as the full object; a request or reply that says {"$character": "name"} means that one
  cases       {"request": ..., "reply": ...} in order, and sometimes "known_difference": why the creator's TypeScript is known to answer
              differently (the test then compares only the shape). `request` is exactly what was sent (a character as a $character reference); `reply`
              is exactly what Python answered, except: every SVG string is {"sha256": ..., "len": ...} (of its UTF-8 bytes), the
              `character` of a patch reply is the same marker for the text json.dumps(character) (the JSON the worker wrote), and the
              `character` of a base reply is a $character reference
  lines       {"line": text, "reply": text} for raw lines fed the way python/render_worker.py fed them to `handle` (it read each line with its
              newline, and answered text that is not JSON with a JSONDecodeError), with the reply text exactly as Python wrote it
"""

import copy
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CREATOR_SRC = os.environ.get("CREATOR_SRC") or os.path.normpath(os.path.join(ROOT, "../anime-character-creator/src"))
os.environ["CREATOR_SRC"] = CREATOR_SRC
sys.path.insert(0, os.path.join(ROOT, "python"))

# python/render_ops.py is kept only for this: it is the frozen Python reference that answers the oracle's requests. Nothing else runs it.
from render_ops import handle  # noqa: E402

OUT = os.path.join(ROOT, "test", "fixtures", "render-ops.json")

# ---------------------------------------------------------------------------------------------------------------------------------
# helpers


def sha(text):
    data = text.encode("utf-8")
    return {"sha256": hashlib.sha256(data).hexdigest(), "len": len(data)}


def jsish(value):
    """What a character looks like after JavaScript's JSON.stringify and JSON.parse: a whole float is an int. The app sends these."""
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, float):
        return int(value) if value == value and abs(value) != float("inf") and value == int(value) else value
    if isinstance(value, list):
        return [jsish(v) for v in value]
    if isinstance(value, dict):
        return {k: jsish(v) for k, v in value.items()}
    return value


CHARS = {}


def expand(value):
    """A request with its {"$character": name} references replaced by the characters."""
    if isinstance(value, dict):
        if set(value) == {"$character"}:
            return copy.deepcopy(CHARS[value["$character"]])
        return {k: expand(v) for k, v in value.items()}
    if isinstance(value, list):
        return [expand(v) for v in value]
    return value


def ref(name):
    return {"$character": name}


CASES = []


def shorten(request, reply):
    """Python's reply with every SVG and the patched character shortened (see the module docstring)."""
    out = dict(reply)
    if "svgs" in out and isinstance(out["svgs"], list):
        out["svgs"] = [sha(s) if isinstance(s, str) else s for s in out["svgs"]]
    if "character" in out and isinstance(request, dict):
        if request.get("op") == "patch":
            out["character"] = sha(json.dumps(out["character"]))
        elif request.get("op") == "base":
            name = request["name"]
            CHARS.setdefault(name, out["character"])
            assert CHARS[name] == out["character"]
            out["character"] = ref(name)
    return out


def case(request, known_difference=None):
    """Ask Python and record the pair. The request may hold $character references; the reply is Python's own.

    `known_difference` marks a case where the creator's TypeScript is known to answer differently from the Python creator (a bug or a
    wording of the creator, not of this app); the test then compares only the shape of the reply (ok or not, the error's class,
    the number and the lengths of the SVGs) and says why in `known_difference`."""
    reply = handle(copy.deepcopy(expand(request)))
    record = {"request": request, "reply": shorten(request, reply)}
    if known_difference:
        record["known_difference"] = known_difference
    CASES.append(record)
    return reply


# ---------------------------------------------------------------------------------------------------------------------------------
# the characters

schema = case({"op": "schema", "id": 1})
PRESETS = schema["presets"]
TOP = list(schema["top"])
FACE = list(schema["face"])
OUTFIT = list(schema["outfit"])
ALL_BARE = TOP + FACE + OUTFIT

for name in PRESETS:
    case({"op": "base", "name": name, "id": name})
# the base replies registered the starting looks under the preset's name: the characters the app starts from
for name in ["risa", "linnea", "katherina", "satoko", "gero", "viktor", "tenno", "keiko", "reinhard"]:
    CHARS[name + "-js"] = jsish(CHARS[name])
nofinish = copy.deepcopy(CHARS["risa"])
del nofinish["finish"]
CHARS["risa-nofinish"] = nofinish
CHARS["risa-nofinish-js"] = jsish(nofinish)
flat = copy.deepcopy(CHARS["risa"])
flat["finish"] = "flat"
CHARS["risa-flat"] = flat
CHARS["empty"] = {}
CHARS["face-only"] = {"face": {}}
CHARS["no-outfit"] = {"hair_color": "#123456", "face": {}}
CHARS["no-face"] = {"hair_color": "#123456", "outfit": {}}
CHARS["just-outfit"] = {"outfit": {"tunic_color": "#112233"}, "face": {}}
bare = copy.deepcopy(CHARS["linnea"])
for key in ("tunic_color", "trouser_color"):
    bare["outfit"][key] = None
CHARS["linnea-bare"] = bare  # no covering garment at all (a hand-made look)
one = copy.deepcopy(CHARS["linnea"])
one["outfit"]["trouser_color"] = None
CHARS["linnea-tunic-only"] = one
CHARS["risa-badtype"] = {**copy.deepcopy(CHARS["risa"]), "hair_length": "long"}
CHARS["risa-nullfloat"] = {**copy.deepcopy(CHARS["risa"]), "hair_length": None}
CHARS["risa-listcolor"] = {**copy.deepcopy(CHARS["risa"]), "hair_color": ["#fff"]}
CHARS["risa-unknownkey"] = {**copy.deepcopy(CHARS["risa"]), "wings": 2}
CHARS["risa-badfinish"] = {**copy.deepcopy(CHARS["risa"]), "finish": "glossy"}
CHARS["risa-strength-7"] = {**copy.deepcopy(CHARS["risa"]), "highlight_strength": 7}
CHARS["risa-young"] = {**copy.deepcopy(CHARS["risa"]), "face_age": 0.1}
CHARS["risa-null-face"] = {**copy.deepcopy(CHARS["risa"]), "face": None}
CHARS["risa-int-height"] = {**copy.deepcopy(CHARS["risa"]), "height": 2}
CHARS["risa-bigint"] = {**copy.deepcopy(CHARS["risa"]), "bust": 12345678901234567890}  # an int above 2**53 in a float field
CHARS["risa-scar-float"] = {**copy.deepcopy(CHARS["risa"]), "face": {**CHARS["risa"]["face"], "scar_side": 1.0}}

# ---------------------------------------------------------------------------------------------------------------------------------
# op patch: the values each field is tried with

# One value of each kind a model (or the page) can send. Strings are what the model writes; the numbers and the other JSON values are
# what a hand-made request can carry. Each kind of field is tried with the values that mean something for it, and with the odd ones.
W_BOOL = ["true", "yes", "on", "1", "false", "no", "0", "TRUE", "Yes", " on ", "\ttrue\n", "y", "2", "off", "nil", "True", "FALSE"]
W_NULL = ["none", "null", "off", "NONE", "Null", " Off ", "None"]
W_NUM = ["0", "1", "1.5", "-1", "20", "21", "-20", "-21", "20.0000001", "nan", "NaN", "inf", "-inf", "infinity", "+5", ".5", "5.", "1e3", "1E1", "1e-3", "1_0",
         "1__0", "_1", "1_", " 7 ", "0x10", "1,5", "\u0663", "\uff11\uff12", "abc", "", " ", "--1", "1e", "+", "0.1", "0.9", "0.99", "1.0", "1.01", "2.5", "0.5", "-0.0"]
W_COLOR = ["#fff", "#FFF", "#abcdef", "#ABCDEF", "#AbCdEf", "red", "#12", "#gggggg", "#ffff", "#fffff", "#1234567", "ff0000", "#", "# fff", "#ffffff ", " #fff ",
           "rgb(1,2,3)", "#\uff26\uff26\uff26", "#ff\u00e9", "#000", "#0A0b0C"]
W_HAIR = ["long_blunt", "short_layered", "long_center_part", "long_traced", "long_parted", "long_fringed", "short_crop", "short_tousled", "long_traced_real", "nope",
          "Long_Blunt", "constructor", "__proto__", "toString", "hasOwnProperty", "", "long blunt"]
W_BODY = ["tall_chibi", "tall_chibi_long_torso", "tall_slender", "realistic", "tall chibi", "constructor", "__proto__", "toString", "nope", "Tall_Chibi"]
W_STYLE = ["mitten", "fist", "flat", "soft", "glossy", "bar", "pleated", "blazer", "shirt", "loafer"]
W_TEXT = ["hello", "Hi there!", "it's me", "a-b_c.d,e?f!", "ok ok ok", "<b>hi</b>", '"quoted"', "a/b", "a\\b", "x;y", "a&b", "a=b", "(x)", "[x]", "{x}", "a:b",
          "\u00e9", "\u65e5\u672c\u8a9e", "\U0001f600", "x" * 40, "x" * 41, "x" * 39, "line\nbreak", "tab\there", "trail ", "\u00a0nbsp\u00a0", "\u3000wide\u3000",
          "\x1cfs\x1c", "\x85nel\x85", "\ufeffbom", "A", "0", "1.5", "-", "_", ".", "'", "!"]
NUMBERS = [0, 1, -1, 2, 3, 20, 21, -20, 1.5, 0.5, 0.0, -0.0, 1.0, 20.0, 20.5, 1e3, 1e-9, 0.999999, 1e22, 123456789012345678901234567890,
           float("nan"), float("inf"), float("-inf"), True, False, None]
OTHERS = [[], [1], ["#fff"], {}, {"a": 1}, [[1]], [None]]

# values tried on EVERY field at once (a request with all the fields as keys, in the schema's order): the dense matrix
MATRIX_VALUES = [
    "true", "false", "0", "1", "none", " 7 ", "1_0", "nan", "-1", "1.5", "20", "21", "abc", "",
    "#fff", "#ABCDEF", "red", "hello", "<b>hi</b>",
    "long_blunt", "tall_slender", "nope", "flat",
    0, 1.5, 21, True, None, [1],
]

# values tried on each field alone
SINGLE_VALUES = ["1", "0", "true", "none", "#abc", "hello", "abc", 0.5]


def patch(character, set_, **extra):
    return case({"op": "patch", "character": ref(character) if isinstance(character, str) else character, "set": set_, **extra})


# --- the matrix: one request per value, every field as a key (bare names)
for value in MATRIX_VALUES:
    patch("risa", {key: value for key in ALL_BARE})

# the same with the app's own spelling of the character (whole floats are ints), and the keys in the other order
for value in ["1", "none", "#fff", 0.5]:
    patch("risa-js", {key: value for key in ALL_BARE})
    patch("linnea", {key: value for key in reversed(ALL_BARE)})

# --- the dotted names, section.name, and the sections of a bare name that is in two places or none
for value in ["1", "none", "#abc", "abc", 0.5]:
    patch("katherina", {**{"face." + k: value for k in FACE}, **{"outfit." + k: value for k in OUTFIT}})
    patch("risa", {"top." + k: value for k in TOP[:6]})
    patch("risa", {"face." + k: value for k in TOP[:3]})  # a top-level name under the wrong section
    patch("risa", {"outfit." + k: value for k in FACE[:3]})

# --- every field alone, a few values each (bare name and dotted)
for key in ALL_BARE:
    section = "face." if key in FACE else "outfit." if key in OUTFIT else ""
    for value in SINGLE_VALUES:
        patch("risa", {key: value})
    for value in SINGLE_VALUES[:2]:
        if section:
            patch("katherina", {section + key: value})

# --- every kind of value on a field of each type (a bool, a float, an int, a colour, a nullable colour, a name, a free text, a nullable float)
KINDS = {
    "hair_knot": W_BOOL + W_NULL + NUMBERS,
    "glasses": W_BOOL[:8] + NUMBERS[:12],
    "hair_length": W_NUM + W_NULL[:2] + NUMBERS + OTHERS,
    "height": W_NUM[:20] + NUMBERS,
    "skirt_length": W_NUM[:14] + W_NULL[:3] + NUMBERS[:12],
    "face.blush": W_NUM[:20] + NUMBERS[:12],
    "highlight_strength": W_NUM[:24] + NUMBERS[:12],
    "scar_side": W_NUM[:24] + W_NULL[:2] + NUMBERS,
    "shoulder_bars": W_NUM[:24] + NUMBERS[:12],
    "wristband_side": W_NUM[:16] + NUMBERS[:12],
    "skin_tone": W_COLOR + W_NULL[:2] + NUMBERS[:6],
    "hair_tip_color": W_COLOR + W_NULL + NUMBERS[:10] + OTHERS[:3],
    "outfit.hat_color": W_COLOR + W_NULL[:4],
    "hairstyle": W_HAIR + W_NULL[:2] + NUMBERS[:6],
    "body": W_BODY + W_NULL[:2],
    "wristband_text": W_TEXT + W_NULL + NUMBERS[:12] + OTHERS[:3],
    "hair_clip": W_TEXT[:20] + W_STYLE + W_NULL[:3] + NUMBERS[:6],
    "finish": W_STYLE + W_NULL[:2] + NUMBERS[:6],
    "belt_cut": W_STYLE + W_TEXT[:6] + W_NULL[:2],
    "hand_style": W_STYLE + W_NULL[:2],
}
for key, values in KINDS.items():
    for value in values:
        patch("risa", {key: value})

# --- the same on a character as the app sends it (whole floats written as ints)
for key in ["hair_length", "scar_side", "height", "highlight_strength", "shoulder_bars", "mouth_open", "face_age", "bust"]:
    for value in ["1", "1.5", 1, 0.5, "none"]:
        patch("risa-js", {key: value})

# --- the model may not: make her younger, shorter than standard, or take her down to underwear
for value in ["0", "0.1", "0.9", "1", "none", "abc", 0, 1, None]:
    patch("risa", {"face_age": value})
    patch("risa", {"face_age": value, "hair_color": "#fff"})
    patch("risa", {"face.face_age": value})
for value in ["0", "0.5", "0.99", "0.9999999", "1", "1.0", "1.3", "20", "-1", "none", "abc", 0.5, 0.99, 1, 1.3, None, "21"]:
    patch("risa", {"height": value})
COVERING = ["tunic_color", "coat_color", "robe_color", "skirt_color", "trouser_color"]
for name in ["linnea", "risa", "katherina", "satoko", "gero", "linnea-tunic-only", "linnea-bare"]:
    for key in COVERING:
        patch(name, {key: "none"})
        patch(name, {"outfit." + key: "null"})
        patch(name, {key: "#123"})
    patch(name, {key: "none" for key in COVERING})
    patch(name, {key: "none" for key in reversed(COVERING)})
    patch(name, {"tunic_color": "none", "skirt_color": "none", "trouser_color": "none", "coat_color": "none"})
    patch(name, {"coat_color": "none", "robe_color": "none", "skirt_color": "none", "trouser_color": "none", "tunic_color": "none", "hat_color": "#fff"})
    patch(name, {"robe_color": "#336699", "tunic_color": "none", "skirt_color": "none", "trouser_color": "none", "coat_color": "none"})
    patch(name, {"tunic_color": "none", "skirt_color": "none", "trouser_color": "none", "coat_color": "none", "robe_color": "#336699"})

# --- base: with other keys before and after, unknown, and of odd types
for name in PRESETS:
    patch("linnea", {"base": name})
patch("linnea", {"hair_color": "#fff", "base": "risa", "eye_color": "#000"})
patch("linnea", {"eye_color": "#000", "base": "risa", "hair_color": "#fff"})
patch("linnea", {"base": "risa", "base2": "x"})
for value in ["", "nope", "RISA", "Risa", " risa", "risa ", "constructor", "__proto__", "toString", "hasOwnProperty", 5, 1.5, True, False, "none", "null", "0", []]:
    patch("linnea", {"base": value})
    patch("linnea", {"base": value, "hair_color": "#fff"})
patch("linnea", {"base": None})
patch("linnea", {"base": None, "hair_color": "#fff"})
patch("linnea", {"base": ["risa"]})  # unhashable: not caught inside the loop
patch("linnea", {"base": {"a": 1}})
patch("linnea", {"base": "risa", "hair_color": "#fff", "face_age": "0", "tunic_color": "none"})
patch("linnea-js", {"base": "satoko", "hair_color": "#fff"})
patch("risa-nofinish", {"hair_color": "#fff"})
patch("risa-nofinish", {"finish": "flat"})
patch("risa-nofinish", {"base": "gero"})

# --- unknown keys, dotted keys with an unknown section, odd keys
for key in ["bogus", "", " ", "hair color", "Hair_Color", "HAIR_COLOR", "hair_color ", " hair_color", ".", "..", "a.b.c", ".hair_color", "outfit.", "outfit.nope",
            "outfit.hair_color", "face.hair_color", "face.tunic_color", "top.hair_color", "nope.hair_color", "outfit.outfit", "face.face", "outfit.hat_color.x",
            "face", "outfit", "load", "base2", "constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "prototype", "length", "name", "id", "op",
            "outfit.constructor", "outfit.__proto__", "face.constructor", "face.__proto__", "face.toString", "ｈair", "é", "hair_color\n", "outfit.hat_color\n",
            "OUTFIT.hat_color", "outfit .hat_color", "outfit. hat_color"]:
    patch("risa", {key: "#fff"})
    patch("risa", {key: "1"})
patch("risa", {"bogus": "1", "hair_color": "#ff0000", "hairstyle": "nope", "outfit.hat_color": "#222"})
patch("risa", {})
patch("risa", {"hair_color": "#ff0000", "hairstyle": "nope", "bogus": "1", "outfit.hat_color": "#222"})
patch("linnea", {"hair_color": "#ff0000", "hairstyle": "nope", "bogus": "1", "outfit.hat_color": "#222"})
patch("linnea", {"wristband_text": '"/><script>alert(1)</script>', "hair_clip": "<svg/onload=alert(1)>", "outfit.wristband_text": "fine words"})

# --- several keys: the order matters, a later key sees what an earlier one did
patch("risa", {"hair_length": "0.3", "hair_length2": "x", "hair_length ": "0.4"})
patch("risa", {"hair_color": "#111", "hair_color ": "#222"})
patch("risa", {"hair_color": "#111", "outfit.hair_color": "#222"})
patch("risa", {"height": "1.2", "outfit.skirt_length": "0.2", "hair_length": "0.9", "bust": "1", "hairstyle": "short_tousled", "body": "tall_slender"})
patch("risa", {"hairstyle": "short_tousled", "body": "tall_slender", "height": "1.2"})
patch("risa", {"hair_length": "1e3", "hair_color": "#fff"})
patch("katherina", {"hat_color": "none", "staff_color": "none", "staff_crystal_color": "none", "hair_clip_color": "none", "hair_color": "#101010"})
patch("katherina", {"hat_color": "#ff0000", "hat_band_color": "#00ff00", "wristband_color": "#0000ff", "wristband_text": "Go Team", "glasses": "yes", "scar_side": "-1"})
patch("risa", {"glasses": "yes", "blush": "1.5", "eye_color": "#0a0b0c", "hair_tip_color": "#ff88cc", "finish": "flat", "highlight_strength": "0.5"})
patch("risa", {"finish": "flat", "highlight_strength": "7"})
patch("risa", {"finish": "glossy", "highlight_strength": "7"})
patch("risa", {"finish": "soft", "highlight_strength": "2"})
patch("risa", {"highlight_strength": "2.0000001"})
patch("risa", {"highlight_strength": "-0.1"})
patch("risa-flat", {"highlight_strength": "7"})
patch("risa-flat", {"finish": "soft"})
patch("risa-flat", {"finish": "soft", "highlight_strength": "3"})

# --- a patch with its own further fields and odd shapes
patch("risa", {"hair_color": "#fff"}, id=None)
patch("risa", {"hair_color": "#fff"}, id="a string id")
patch("risa", {"hair_color": "#fff"}, id=[1, {"a": None}])
patch("risa", {"hair_color": "#fff"}, id=1.5)
patch("risa", {"hair_color": "#fff"}, id={"x": "é"})
patch("risa", {"hair_color": "#fff"}, extra_key=1, id=7)
case({"op": "patch", "character": ref("risa"), "set": {"hair_color": "#fff"}})  # no id at all
patch("risa", {"wristband_text": "é"})

# --- characters that are not clean (a hand-edited saved look)
for name in ["empty", "face-only", "no-outfit", "no-face", "just-outfit", "risa-badtype", "risa-nullfloat", "risa-listcolor", "risa-unknownkey", "risa-badfinish",
             "risa-strength-7", "risa-young", "risa-null-face", "risa-int-height", "risa-bigint", "risa-scar-float"]:
    patch(name, {"hair_color": "#fff"})
    patch(name, {"outfit.hat_color": "#fff"})
    patch(name, {"face.blush": "1"})
    patch(name, {"hair_length": "0.5", "height": "1.1"})
    patch(name, {"tunic_color": "none"})
    patch(name, {"trouser_color": "none", "skirt_color": "none", "tunic_color": "none"})
    patch(name, {"base": "gero"})
    patch(name, {})

# --- every preset: one change of each kind
for name in PRESETS:
    patch(name, {"hair_color": "#ff0000", "glasses": "true", "outfit.hat_color": "#222", "hair_length": "0.9", "hairstyle": "short_crop", "height": "1.2"})
    patch(name + "-js" if name + "-js" in CHARS else name, {"eye_color": "#00ff00", "blush": "0.5", "face_age": "0.5"})

# ---------------------------------------------------------------------------------------------------------------------------------
# op frames

EMOTIONS = {
    "neutral": {},
    "happy": {"mouth_curve": 1.6, "brow_tilt": -0.1, "blush": 1.0, "eye_openness": 0.7, "mouth_open": 0.3},
    "sad": {"mouth_curve": -1.4, "brow_tilt": -1.2, "eye_openness": 0.7, "blush": 0.0},
    "angry": {"mouth_curve": -1.0, "brow_tilt": 1.4, "eye_openness": 0.6, "eye_tilt": 0.2},
    "surprised": {"eye_size": 1.12, "iris_size": 0.8, "brow_tilt": -0.5, "mouth_curve": 0.2, "mouth_width": 0.6, "mouth_open": 0.65},
    "shy": {"blush": 1.5, "gaze": 0.8, "mouth_curve": 0.6, "brow_tilt": -0.6, "eye_openness": 0.8},
    "thinking": {"gaze": -0.8, "mouth_curve": -0.1, "brow_tilt": 0.3, "eye_openness": 0.9, "mouth_width": 0.6},
}
POSES = {
    "wave": [{"right_arm_out": 128}, {"right_arm_out": 152}],
    "cheer": [{"right_arm_out": 125, "left_arm_out": 125}, {"right_arm_out": 150, "left_arm_out": 150}],
}


def frames(character, face, mouth, **extra):
    return case({"op": "frames", "character": ref(character) if isinstance(character, str) else character, "face": face, "mouth": mouth, **extra})


def mouths(rest):
    """What public/frames.js asks for: four openings (never below the resting one), the rest first."""
    return [rest, max(rest, 0.3), max(rest, 0.55), max(rest, 0.85)]


emotion_names = list(EMOTIONS)
for i, name in enumerate(PRESETS):
    for j in range(2):
        emotion = emotion_names[(i + j * 3) % len(emotion_names)]
        face = EMOTIONS[emotion]
        rest = face.get("mouth_open", CHARS[name]["face"].get("mouth_open", 0))
        frames(name, face, mouths(rest))  # a character Python wrote (floats written as floats)
        if name + "-js" in CHARS:
            frames(name + "-js", jsish(face), jsish(mouths(rest)))  # as the app sends it
for gesture, poses in POSES.items():
    for name in ["risa", "linnea", "katherina", "satoko", "gero", "viktor", "tenno", "risa-js", "keiko", "reinhard"]:
        for emotion in ["neutral", "happy"]:
            face = EMOTIONS[emotion]
            frames(name, face, [face.get("mouth_open", 0)], poses=poses)
            frames(name, jsish(face), jsish([face.get("mouth_open", 0)]), poses=poses)

# a character with no finish is drawn soft; one that said flat stays flat
frames("risa-nofinish", {}, [0])
frames("risa-nofinish-js", {}, [0])
frames("risa", {}, [0])
frames("risa-flat", {}, [0])
frames("risa-nofinish", {"finish": "flat"}, [0])  # `finish` is not a face field: its refusal is Python's text
frames("risa-badfinish", {}, [0])
frames("risa-strength-7", {}, [0])
frames("risa-young", {}, [0])

# mouth lists and face overrides of every shape
for mouth in [[0], [1], [0, 0.3], [0, 0.3, 0.55, 0.85], [0.5, 0.5], [1.5], [-1], [0.0], [1e-9], [20], [0, 1, 0, 1, 0, 1], [True], [False], [None], [0.123456789012345],
              [], ["a"], [[1]], "abc", 0, None, {"a": 1}, [float("nan")], [float("inf")], [12345678901234567890], [0, "x"]]:
    frames("risa", {}, mouth)
    frames("risa-js", {}, jsish(mouth) if isinstance(mouth, list) else mouth)
for face in [{}, {"blush": 1}, {"blush": 1.0}, {"blush": "1"}, {"blush": None}, {"glasses": True}, {"glasses": 1}, {"glasses": "yes"}, {"eyes_closed": True},
             {"mouth_open": 0.9}, {"mouth_curve": 3}, {"scar_side": 1}, {"scar_side": 1.0}, {"scar_side": -1}, {"nope": 1}, {"hair_color": "#fff"}, {"eye_size": 0},
             {"eye_size": "big"}, {"eye_size": [1]}, {"gaze": 100}, {"eye_openness": -1}, {"brow_tilt": 2, "mouth_width": 0.2, "lash": 0.8}, {"mouth_open": None}, {"mouth_open": True}]:
    frames("risa", face, [0, 0.5])
    frames("linnea-js", face, [0])
frames("risa", [["blush", 1]], [0])  # dict.update takes a list of pairs too
frames("risa", [["blush"]], [0])
frames("risa", [1], [0])
frames("risa", 5, [0])
frames("risa", None, [0])
frames("risa", "ab", [0])
frames("risa", [], [0])
frames("risa", {"blush": 1}, [0], poses=[{}])
frames("risa", {"blush": 1}, [0], poses=[])
frames("risa", {}, [0], poses=[{"hair_color": "#fff"}, {"hair_length": 0.9, "right_arm_out": 100}])
frames("risa", {}, [0], poses=[{"outfit": {"hat_color": "#fff"}}])  # `outfit` is not a top-level field of a pose
frames("risa", {}, [0], poses=[{"face": {}}])
frames("risa", {}, [0], poses=[{"height": 1.2}, {"height": "tall"}])
frames("risa", {}, [0], poses=[{"right_arm_out": 128, "bogus": 1}])
frames("risa", {}, [0], poses=[1])
frames("risa", {}, [0], poses=["right_arm_out"])
frames("risa", {}, [0], poses=[[]])
frames("risa", {}, [0], poses=[[["right_arm_out", 3]]])
frames("risa", {}, [0], poses=5)
frames("risa", {}, [0], poses=None)
frames("risa", {}, [0], poses="ab")
frames("risa", {}, [0], poses={"a": 1})
frames("risa", {}, [], poses=[{"right_arm_out": 128}])
frames("risa", {}, "abc", poses=[{"right_arm_out": 128}])
frames("risa", {}, [0.5, 1], poses=[{"right_arm_out": 128}])
frames("risa-js", {}, [0], poses=[{"right_arm_out": 128.5}, {"right_arm_out": 128}])
frames("risa", {}, [0], poses=[{"finish": "flat"}])
frames("risa", {}, [0], poses=[{"finish": None}])
frames("risa-nofinish", {}, [0], poses=[{"right_arm_out": 128}])

# characters that are not clean
for name in ["empty", "face-only", "no-outfit", "no-face", "just-outfit", "risa-badtype", "risa-nullfloat", "risa-listcolor", "risa-unknownkey", "risa-null-face",
             "risa-int-height", "risa-scar-float", "linnea-bare"]:
    frames(name, {}, [0])
    frames(name, {"blush": 1}, [0, 0.3], poses=[{"right_arm_out": 128}])

# Known differences of the creator's TypeScript (see `known_difference` in case()), kept here so they stay visible
BIGINT = "an int above 2**53 in a float field: the creator's TypeScript draws the same length of SVG with different bytes"
case({"op": "frames", "character": ref("risa-bigint"), "face": {}, "mouth": [0]}, BIGINT)
case({"op": "frames", "character": ref("risa-bigint"), "face": {"blush": 1}, "mouth": [0, 0.3], "poses": [{"right_arm_out": 128}]}, BIGINT)
case({"op": "patch", "character": ref("risa-bigint"), "set": {"hair_color": "#fff"}}, BIGINT)

# missing and mistyped parts of a frames request
case({"op": "frames", "character": ref("risa")})
case({"op": "frames", "character": ref("risa"), "face": {}})
case({"op": "frames", "face": {}, "mouth": [0]})
case({"op": "frames", "character": ref("risa"), "mouth": [0]})  # no face override: fine
case({"op": "frames", "character": ref("risa"), "mouth": [0], "face": {}, "id": 9})
case({"op": "frames", "character": None, "face": {}, "mouth": [0]})
case({"op": "frames", "character": 5, "face": {}, "mouth": [0]})
case({"op": "frames", "character": "risa", "face": {}, "mouth": [0]})
case({"op": "frames", "character": [], "face": {}, "mouth": [0]})
case({"op": "frames", "character": [["a", 1]], "face": {}, "mouth": [0]})
case({"op": "frames", "character": ref("empty"), "face": {}, "mouth": [0]})
case({"op": "frames", "character": ref("risa"), "mouth": [0], "poses": [{"right_arm_out": 128}]})
case({"op": "frames", "character": ref("risa"), "poses": [{"right_arm_out": 128}]})
case({"op": "frames", "character": ref("risa"), "face": {}, "mouth": [0], "extra": 1})

# ---------------------------------------------------------------------------------------------------------------------------------
# schema, base and the requests that are not requests

case({"op": "schema"})
case({"op": "schema", "id": "again", "junk": [1, 2]})
for name in ["", "nope", "RISA", "Risa", "constructor", "__proto__", "toString", "hasOwnProperty", "risa ", " risa", "résumé", 5, 1.5, True, None, [], {}, ["risa"], {"a": 1}]:
    case({"op": "base", "name": name, "id": 3})
case({"op": "base"})
case({"op": "base", "id": 4})
case({"op": "base", "name": "risa", "id": 5, "extra": 1})

case({"op": "frames", "character": {"face": {}, "hair_color": 5}, "face": {}, "mouth": [0]},
     "an int in a colour field: the creator's TypeScript says \"'object' object has no attribute 'lstrip'\" where Python says 'int'")

for request in [
    {}, {"id": 1}, {"op": None}, {"op": 5}, {"op": 1.5}, {"op": True}, {"op": []}, {"op": ["schema"]}, {"op": {}}, {"op": {"a": 1}}, {"op": ""}, {"op": "nope"},
    {"op": "SCHEMA"}, {"op": " schema"}, {"op": "constructor"}, {"op": "__proto__"}, {"op": "toString"}, {"op": "hasOwnProperty"}, {"op": "handle"}, {"op": "OPS"},
    {"op": "nope", "id": "x"}, {"op": "op_patch"}, {"op": "patch"}, {"op": "patch", "id": 1}, {"op": "patch", "character": ref("risa")}, {"op": "patch", "set": {}},
    {"op": "patch", "character": None, "set": {}}, {"op": "patch", "character": 5, "set": {}}, {"op": "patch", "character": "risa", "set": {"hair_color": "#fff"}},
    {"op": "patch", "character": [], "set": {}}, {"op": "patch", "character": ref("risa"), "set": None},
    {"op": "patch", "character": ref("risa"), "set": 5}, {"op": "patch", "character": ref("risa"), "set": "abc"}, {"op": "patch", "character": ref("risa"), "set": "ab"},
    {"op": "patch", "character": ref("risa"), "set": []}, {"op": "patch", "character": ref("risa"), "set": [["hair_color", "#fff"]]},
    {"op": "patch", "character": ref("risa"), "set": [["hair_color", "#fff", 1]]}, {"op": "patch", "character": ref("risa"), "set": [1]},
    {"op": "patch", "character": ref("risa"), "set": [[1, 2]]}, {"op": "patch", "character": ref("risa"), "set": [[[1], 2]]},
    {"op": "patch", "character": ref("risa"), "set": ["ab"]}, {"op": "patch", "character": ref("risa"), "set": ["abc"]}, {"op": "patch", "character": ref("risa"), "set": ["hair_color"]},
    {"op": "patch", "character": ref("risa"), "set": True}, {"op": "patch", "character": ref("risa"), "set": 1.5},
    {"op": "patch", "character": {"hair_color": "#123"}, "set": {"hair_length": "0.3"}},
    {"op": "patch", "character": {"hair_color": "#123", "wings": 1}, "set": {"hair_length": "0.3"}},
    {"op": "patch", "character": {"outfit": 5}, "set": {"hair_length": "0.3"}},
    {"op": "patch", "character": {"outfit": None}, "set": {"tunic_color": "none"}},
    {"op": "patch", "character": {"outfit": []}, "set": {"tunic_color": "#fff"}},
    {"op": "patch", "character": {"outfit": {}}, "set": {"tunic_color": "none"}},
    {"op": "patch", "character": {"face": 5}, "set": {"blush": "1"}},
    {"op": "patch", "character": {"face": {}}, "set": {"outfit.hat_color": "#fff"}},
    {"op": "frames", "character": {"face": {}, "outfit": {}}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": 5}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": None}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": []}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": [["blush", 1]]}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": "ab"}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "outfit": 5}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "outfit": None}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "outfit": {"nope": 1}}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {"nope": 1}}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"nope": 1, "face": {}}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "hairstyle": "nope"}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "body": "nope"}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "hair_color": "red"}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "hair_color": None}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "skin_tone": "#12"}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "hair_length": 5}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "hair_length": -5}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "height": 0}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "height": -1}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "height": 50}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "face_age": -3}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "face_age": "x"}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "face_age": None}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "finish": None}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "finish": "soft", "highlight_strength": None}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "finish": "soft", "highlight_strength": "1"}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "finish": "flat", "highlight_strength": "1"}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "finish": "soft", "highlight_strength": 3}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "finish": "soft", "highlight_strength": True}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "finish": "soft", "highlight_strength": 2.0}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "finish": "soft", "highlight_strength": 2}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "finish": "soft", "highlight_strength": float("nan")}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "finish": 5}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "finish": ["soft"]}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "heads": 3}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "body": None}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {"eye_style": "x", "eye_glow": 1}}, "face": {}, "mouth": [0]},
    {"op": "frames", "character": {"face": {}, "hairstyle": "long_traced_real"}, "face": {}, "mouth": [0]},
]:
    case(request)

# not a request at all: the reply comes with an id of null, and an error of Python's own words
# (a request is a dict in the protocol, but a line of JSON can be anything)
for value in [[], [1], ["op"], "abc", "", 5, 1.5, True, False, None, float("nan")]:
    CASES.append({"request": value, "reply": handle(copy.deepcopy(value))})

# ---------------------------------------------------------------------------------------------------------------------------------
# lines: raw text the worker parsed before `handle`

LINES = [
    "{", "}", "[1,", "nul", "{} x", "{\"a\":1} {\"b\":2}", "NaN", "Infinity", "-Infinity", "'single'", "{'a': 1}", "{\"a\": }", "{\"a\" 1}", "{\"a\": 1,}", "[1,]",
    "{\"op\": \"schema\" \"id\": 1}", "01", "1.", ".5", "1e", "\"abc", "\"a\\xb\"", "\"\\ud800\"", "\"tab\there\"", "\u00e9", "{\"é\": 1}", "tru", "True", "None",
    "[]", "{}", "[1]", "\"abc\"", "5", "1.5", "true", "null", "{\"id\": 7}", "{\"id\": \"a\", \"op\": \"nope\"}", "{\"op\": \"base\", \"name\": \"nope\", \"id\": \"x\"}",
    "{\"op\": \"base\", \"id\": 1}", "{\"op\": \"patch\", \"id\": 1}", "  {\"op\": \"nope\"}  ", "\t{\"op\": \"nope\", \"id\": [1, 2]}", "{\"op\": \"nope\", \"id\": 1e400}",
    "{\"op\": \"nope\", \"id\": 12345678901234567890}", "{\"op\": \"nope\", \"id\": -0}", "{\"op\": \"nope\", \"id\": 1.0}", "{\"op\": \"nope\", \"id\": 1e2}",
    "{\"op\": \"nope\", \"id\": 100000000000000000000.0}", "{\"op\": \"nope\", \"id\": \"\\u00e9\\ud83d\\ude00\"}", "{\"op\": \"nope\", \"id\": NaN}",
    "{\"op\": \"nope\", \"op\": \"schema2\"}", "{\"op\": \"base\", \"name\": \"nope\", \"name\": \"gero\", \"id\": 1}",
    "[" * 2000 + "]" * 2000,
]


def answer_line(line):
    """What the Python worker (python/render_worker.py, now removed) did with each line of its input, which it read with the newline."""
    try:
        req = json.loads(line + "\n")
    except Exception as exc:
        reply = {"ok": False, "error": f"{type(exc).__name__}: {exc}", "id": None}
    else:
        reply = handle(req)
    return json.dumps(reply)


def run_lines(lines):
    return [{"line": line, "reply": answer_line(line)} for line in lines if line.strip()]


# a Python recursion error on a deep line is Python's own, and varies with its version: it is kept out
LINE_CASES = run_lines([l for l in LINES if not l.startswith("[[[[")])

# ---------------------------------------------------------------------------------------------------------------------------------
# write

svg_markers = sum(len(c["reply"].get("svgs", [])) for c in CASES if isinstance(c["reply"], dict))
meta = {
    "about": "Python's exact replies to python/render_ops.py's handle(); see scripts/gen-render-ops-fixtures.py for how to read this file",
    "python": sys.version.split()[0],
    "cases": len(CASES),
    "lines": len(LINE_CASES),
    "svgs": svg_markers,
    "svg_marker": "an SVG string is {sha256, len}: the SHA-256 and the number of bytes of its UTF-8",
}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    f.write('{"meta":' + json.dumps(meta, separators=(",", ":")) + ',\n"characters":{\n')
    f.write(",\n".join(json.dumps(k) + ":" + json.dumps(v, separators=(",", ":")) for k, v in CHARS.items()))
    f.write('},\n"cases":[\n')
    f.write(",\n".join(json.dumps(c, separators=(",", ":")) for c in CASES))
    f.write('],\n"lines":[\n')
    f.write(",\n".join(json.dumps(c, separators=(",", ":")) for c in LINE_CASES))
    f.write("]}\n")
print(f"{len(CASES)} cases, {len(LINE_CASES)} lines, {len(CHARS)} characters, {os.path.getsize(OUT)} bytes -> {os.path.relpath(OUT, ROOT)}")

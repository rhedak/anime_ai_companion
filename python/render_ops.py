"""What the renderer can be asked, as plain functions: schema, base, patch, frames.

`handle(request)` takes one request (a dict) and returns the reply dict.
The app's server no longer runs this file: it draws with the creator's TypeScript (src/render-ops.ts is this file ported, and
test/render-ops.test.ts checks it against this one through test/fixtures/render-ops.json, made by scripts/gen-render-ops-fixtures.py).
It stays for the browser demo (Pyodide, which has not moved yet) and as that oracle: keep the two in step until the demo moves.

The creator is only imported, never modified: set CREATOR_SRC to its `src` dir, or put the package on sys.path yourself.
"""

import dataclasses
import json
import math
import os
import re
import sys

if os.environ.get("CREATOR_SRC"):  # in the browser (Pyodide) the package is put on sys.path by the page instead
    sys.path.insert(0, os.environ["CREATOR_SRC"])

from anime_character_creator import (  # noqa: E402
    HAIRSTYLES, PRESETS, CharacterParams, FaceStyle, Outfit, render_character,
)
from anime_character_creator.character import BODY_TYPES  # noqa: E402
from anime_character_creator.urlstate import params_from_dict, params_to_dict  # noqa: E402

SECTIONS = {"face": FaceStyle, "outfit": Outfit}
TOP = {f.name: f for f in dataclasses.fields(CharacterParams) if f.name not in SECTIONS}
FIELDS = {"": TOP}
for _name, _cls in SECTIONS.items():
    FIELDS[_name] = {f.name: f for f in dataclasses.fields(_cls)}

HEX = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
# Free-text values (wristband_text, hair_clip, ...) end up inside the SVG, and the creator does
# not escape them, so only plain words are accepted: no markup characters, quotes or slashes.
PLAIN_TEXT = re.compile(r"^[A-Za-z0-9_.,!?' -]{1,40}$")


def locate(key):
    """'outfit.hat_color' or bare 'hat_color' -> (section, field name)."""
    if "." in key:
        section, name = key.split(".", 1)
        if section in SECTIONS and name in FIELDS[section]:
            return section, name
        raise ValueError(f"unknown field '{key}'")
    for section in ("", "face", "outfit"):  # names do not overlap between the three
        if key in FIELDS[section]:
            return section, key
    raise ValueError(f"unknown field '{key}'")


def coerce(name, type_str, raw):
    """Turn the model's text value into the dataclass field's type."""
    if isinstance(raw, str):
        raw = raw.strip()
    nullable = "None" in type_str
    base = type_str.replace("| None", "").strip()
    if isinstance(raw, str) and raw.lower() in ("none", "null", "off"):
        if nullable:
            return None
        raise ValueError("cannot be removed")
    if base == "bool":
        if str(raw).lower() in ("true", "yes", "on", "1"):
            return True
        if str(raw).lower() in ("false", "no", "0"):
            return False
        raise ValueError("expected true or false")
    if base in ("float", "int"):
        x = float(raw)
        if not math.isfinite(x) or abs(x) > 20:
            raise ValueError("number out of range")
        return int(round(x)) if base == "int" else x
    if base == "str":
        raw = str(raw)
        if name.endswith("_color") or name == "skin_tone":
            if not HEX.match(raw):
                raise ValueError("expected a hex colour like #ff88cc")
            if len(raw) == 4:
                raw = "#" + "".join(c * 2 for c in raw[1:])
            return raw.lower()
        if name == "hairstyle" and raw not in HAIRSTYLES:
            raise ValueError(f"hairstyle must be one of {', '.join(HAIRSTYLES)}")
        if name == "body" and raw not in BODY_TYPES:
            raise ValueError(f"body must be one of {', '.join(BODY_TYPES)}")
        if not PLAIN_TEXT.match(raw):
            raise ValueError("text may only use letters, digits and simple punctuation (up to 40 characters)")
        return raw
    raise ValueError(f"unsupported field type {type_str}")


# What the model may and may not do to her own look. The drawn figure is an adult, so she
# cannot be drawn younger, and she keeps at least one covering garment: the creator always
# draws underwear, and nothing the model sends takes her down to just that.
MODEL_LOCKED = {"face_age": "her age is fixed; she is always drawn as an adult"}
COVERING = ("tunic_color", "coat_color", "robe_color", "skirt_color", "trouser_color")


def check_allowed(character, section, name, value):
    """Raise ValueError if the model may not make this change to this character."""
    if name in MODEL_LOCKED:
        raise ValueError(MODEL_LOCKED[name])
    if name == "height" and value < 1.0:
        raise ValueError("height must be 1.0 or more")
    if section == "outfit" and name in COVERING and value is None:
        if not any(character["outfit"].get(c) for c in COVERING if c != name):
            raise ValueError("she keeps at least one covering garment on")


def show(value):
    """A value as the model wrote it: true, false, none, #rrggbb."""
    if isinstance(value, bool):
        return "true" if value else "false"
    return "none" if value is None else value


def trial_render(character):
    render_character(params_from_dict(character))


def op_schema(_req):
    def describe(section):
        out = {}
        for name, f in FIELDS[section].items():
            default = f.default if f.default is not dataclasses.MISSING else None
            out[name] = {"type": str(f.type), "default": default}
        return out

    return {
        "presets": list(PRESETS),
        "hairstyles": list(HAIRSTYLES),
        "bodies": list(BODY_TYPES),
        "top": describe(""),
        "face": describe("face"),
        "outfit": describe("outfit"),
    }


# She is drawn beside picture packs, and the creator's soft finish (gradients, tinted lines, tone in the hair) is what
# closes most of the gap between a drawn figure and a painted one, so every starting character is soft. It is only a
# starting value: `finish` and `highlight_strength` are ordinary fields she or the user can change (`[avatar finish=flat]`),
# and a creator older than the soft finish has neither field, so then nothing is set.
# A character with no `finish` at all (a look saved before the field existed, in the app or in a visitor's browser) has made no
# choice, so it is drawn with the default too; one that says `flat` stays flat.
DEFAULT_FINISH = "soft"


def starting_look(name):
    """The creator's preset as a character dict, with the companion's default finish."""
    character = params_to_dict(PRESETS[name])
    if "finish" in TOP:
        character["finish"] = DEFAULT_FINISH
    return character


def op_base(req):
    return {"character": starting_look(req["name"])}


def op_patch(req):
    character = json.loads(json.dumps(req["character"]))
    applied, rejected = [], []
    items = dict(req["set"])
    base = items.pop("base", None)
    if base is not None:
        if base in PRESETS:
            character = starting_look(base)
            applied.append(f"base={base}")
        else:
            rejected.append({"key": "base", "reason": f"unknown preset '{base}'"})
    for key, raw in items.items():
        try:
            section, name = locate(key)
            value = coerce(name, str(FIELDS[section][name].type), raw)
            check_allowed(character, section, name, value)
            target = character[section] if section else character
            previous = target.get(name)
            target[name] = value
            try:
                trial_render(character)
            except Exception as exc:
                target[name] = previous
                raise ValueError(f"rendering failed ({exc})") from exc
            applied.append(f"{key}={show(value)}")
        except (ValueError, TypeError) as exc:
            rejected.append({"key": key, "reason": str(exc)})
    return {"character": character, "applied": applied, "rejected": rejected}


def op_frames(req):
    character = json.loads(json.dumps(req["character"]))
    if "finish" in TOP:
        character.setdefault("finish", DEFAULT_FINISH)
    character["face"].update(req.get("face", {}))
    if "poses" in req:
        # one frame per pose (a pose overrides top-level fields such as right_arm_out), mouth at rest
        character["face"]["mouth_open"] = req["mouth"][0]
        character["face"]["eyes_closed"] = False
        out = []
        for pose in req["poses"]:
            posed = {**character, **{k: v for k, v in pose.items() if k in TOP}}
            out.append(render_character(params_from_dict(posed)))
        return {"svgs": out}
    svgs = []
    for mouth in req["mouth"]:
        character["face"]["mouth_open"] = mouth
        character["face"]["eyes_closed"] = False
        svgs.append(render_character(params_from_dict(character)))
    # one extra frame for blinking: eyes shut, mouth as at rest
    character["face"]["mouth_open"] = req["mouth"][0]
    character["face"]["eyes_closed"] = True
    svgs.append(render_character(params_from_dict(character)))
    return {"svgs": svgs}


OPS = {"schema": op_schema, "base": op_base, "patch": op_patch, "frames": op_frames}


def handle(req):
    """One request in, one reply out. Never raises: a failure is a reply with ok false, so the caller stays alive."""
    try:
        reply = {"ok": True, **OPS[req["op"]](req)}
    except Exception as exc:  # keep the worker alive whatever one request does
        reply = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    reply["id"] = req.get("id") if isinstance(req, dict) else None
    return reply

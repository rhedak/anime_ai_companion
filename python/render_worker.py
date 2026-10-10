"""Long-lived bridge to the anime-character-creator package.

Speaks JSON lines on stdin/stdout, one request per line:
  {"id": 1, "op": "schema"}
  {"id": 2, "op": "base", "name": "linnea"}
  {"id": 3, "op": "patch", "character": {...}, "set": {"hair_color": "#ff0000"}}
  {"id": 4, "op": "frames", "character": {...}, "face": {...}, "mouth": [0, .3, .6]}
Every reply is {"id": n, "ok": true, ...} or {"id": n, "ok": false, "error": "..."}.

The creator is only imported, never modified: set CREATOR_SRC to its `src` dir.
"""

import dataclasses
import json
import math
import os
import re
import sys

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
        return raw
    raise ValueError(f"unsupported field type {type_str}")


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


def op_base(req):
    return {"character": params_to_dict(PRESETS[req["name"]])}


def op_patch(req):
    character = json.loads(json.dumps(req["character"]))
    applied, rejected = [], []
    items = dict(req["set"])
    base = items.pop("base", None)
    if base is not None:
        if base in PRESETS:
            character = params_to_dict(PRESETS[base])
            applied.append(f"base={base}")
        else:
            rejected.append({"key": "base", "reason": f"unknown preset '{base}'"})
    for key, raw in items.items():
        try:
            section, name = locate(key)
            value = coerce(name, str(FIELDS[section][name].type), raw)
            target = character[section] if section else character
            previous = target.get(name)
            target[name] = value
            try:
                trial_render(character)
            except Exception as exc:
                target[name] = previous
                raise ValueError(f"rendering failed ({exc})") from exc
            applied.append(f"{key}={value}")
        except (ValueError, TypeError) as exc:
            rejected.append({"key": key, "reason": str(exc)})
    return {"character": character, "applied": applied, "rejected": rejected}


def op_frames(req):
    character = json.loads(json.dumps(req["character"]))
    character["face"].update(req.get("face", {}))
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

for line in sys.stdin:
    if not line.strip():
        continue
    req = {}
    try:
        req = json.loads(line)
        reply = {"ok": True, **OPS[req["op"]](req)}
    except Exception as exc:  # keep the worker alive whatever one request does
        reply = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    reply["id"] = req.get("id")
    sys.stdout.write(json.dumps(reply) + "\n")
    sys.stdout.flush()

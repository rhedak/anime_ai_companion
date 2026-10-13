"""Long-lived bridge to the anime-character-creator package.

Speaks JSON lines on stdin/stdout, one request per line:
  {"id": 1, "op": "schema"}
  {"id": 2, "op": "base", "name": "linnea"}
  {"id": 3, "op": "patch", "character": {...}, "set": {"hair_color": "#ff0000"}}
  {"id": 4, "op": "frames", "character": {...}, "face": {...}, "mouth": [0, .3, .6]}
Every reply is {"id": n, "ok": true, ...} or {"id": n, "ok": false, "error": "..."}.

The creator is only imported, never modified: set CREATOR_SRC to its `src` dir.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # run with -I, which leaves the script's folder off the path

from render_ops import handle  # noqa: E402

for line in sys.stdin:
    if not line.strip():
        continue
    try:
        req = json.loads(line)
    except Exception as exc:
        reply = {"ok": False, "error": f"{type(exc).__name__}: {exc}", "id": None}
    else:
        reply = handle(req)
    sys.stdout.write(json.dumps(reply) + "\n")
    sys.stdout.flush()

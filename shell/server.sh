#!/usr/bin/env bash
# Starts the companion server from this checkout without the desktop shell: in the foreground (Ctrl+C stops it), or in the background.
#
#   shell/server.sh              this computer only, http://127.0.0.1:3737
#   shell/server.sh --lan        also reachable from other devices on the network (a phone); needs the token the server prints
#   PORT=3739 shell/server.sh    another port
#   shell/server.sh --daemon     in the background, and it keeps running after the terminal closes (log: data/server.log)
#   shell/server.sh --status     whether that background server runs
#   shell/server.sh --stop       stops it
#   shell/server.sh --restart    stops it and starts it again in the background
#   shell/server.sh --daemon --lan   the background server, also on the network
#
# Its data is this checkout's data/ and workspace/ (the owner's own), unless ANAICO_DATA / ANAICO_WORKSPACE say otherwise.
# Any arguments are passed to the server, so --lan is only on for the start that asks for it.
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export PORT="${PORT:-3737}"

# The drawing code lives next to this repo (or wherever CREATOR_SRC points).
creator="${CREATOR_SRC:-$root/../anime-character-creator/ts/src}"
if [[ ! -f "$creator/render.ts" ]]; then
  echo "The creator's TypeScript is not at $creator (clone anime-character-creator next to this repo, or set CREATOR_SRC)." >&2
  exit 1
fi

cd "$root"
if [[ ! -d node_modules ]]; then
  echo "Installing the packages (once)…"
  npm install
fi

# --daemon, --restart, --status and --stop go to the anaico command's own code (src/cli.ts), which keeps the background
# server's pid in data/server.pid and its log in data/server.log. It does not open a browser here.
for arg in "$@"; do
  case "$arg" in
    --daemon | --restart | --status | --stop)
      exec node src/cli.ts "$@" --no-open
      ;;
  esac
done

echo "Companion server on port $PORT${*:+ ($*)}"
exec node src/server.ts "$@"

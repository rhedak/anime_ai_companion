#!/usr/bin/env bash
# Runs the desktop app (Electron) from this checkout, for trying a change: the window shows ../src and ../public as they are now.
#
#   shell/dev-app.sh                      its own port and its own data folder, so it never touches the installed app or its data
#   PORT=3737 shell/dev-app.sh            another port (3737 is the installed app's: if it is running, the window would show that server)
#   ANAICO_DEV_HOME=~/x shell/dev-app.sh  another folder for the dev app's settings, chat log, looks and workspace (default ~/.anaico-dev)
#
# Edits to src/ or app/main.cjs need a restart of this script; edits to public/ only a reload of the window.
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export PORT="${PORT:-3738}"
home="${ANAICO_DEV_HOME:-$HOME/.anaico-dev}"
mkdir -p "$home"

# The drawing code lives next to this repo (or wherever CREATOR_SRC points).
creator="${CREATOR_SRC:-$root/../anime-character-creator/ts/src}"
if [[ ! -f "$creator/render.ts" ]]; then
  echo "The creator's TypeScript is not at $creator (clone anime-character-creator next to this repo, or set CREATOR_SRC)." >&2
  exit 1
fi

cd "$root/app"
if [[ ! -d node_modules ]]; then
  echo "Installing the desktop shell's packages (Electron, once)…"
  npm install
fi

# The shell keeps everything in Electron's user-data folder and ignores ANAICO_DATA, so that is what is pointed elsewhere. A separate folder also
# gives the dev app its own single-instance lock: the installed app can stay open.
echo "Dev app on port $PORT, data in $home/data"
exec npm start -- --user-data-dir="$home"

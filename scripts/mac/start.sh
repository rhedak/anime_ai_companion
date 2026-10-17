#!/bin/bash
# Started by the app's native stub (main.swift), which stops it again when the app quits. It prepares the environment a Finder-launched app lacks, starts the
# server with the bundled Node, and opens the page. The server keeps running while the app does; quitting the app (Dock -> Quit) stops it.
here="$(cd "$(dirname "$0")/.." && pwd)"   # .../Anaico.app/Contents (this file is in Contents/Resources)
res="$here/Resources"
support="$HOME/Library/Application Support/Anaico"
mkdir -p "$support/data" "$support/workspace"

# A Finder-launched app gets a bare PATH, so it would not find claude, opencode or ollama. Ask the user's own shell for its PATH (a marker
# line, because a shell's start-up files may print other things), and add the usual places in case that fails.
login_path="$("${SHELL:-/bin/zsh}" -ilc 'printf "\nANAICO_PATH=%s\n" "$PATH"' 2>/dev/null | sed -n 's/^ANAICO_PATH=//p' | tail -1)"
export PATH="${login_path:+$login_path:}$HOME/.local/bin:$HOME/.opencode/bin:$HOME/.claude/local:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

export ANAICO_DATA="$support/data"
export ANAICO_WORKSPACE="$support/workspace"
export CREATOR_SRC="$res/creator/ts/src"
port="${PORT:-3737}"
url="http://127.0.0.1:$port"

# The first time, use a brain that is installed. After that the choice is the user's, made in the page.
if [ ! -f "$ANAICO_DATA/settings.json" ]; then
  for pair in claude:claude opencode:opencode cursor-agent:cursor ollama:ollama; do
    if command -v "${pair%%:*}" >/dev/null 2>&1; then
      printf '{ "provider": "%s" }\n' "${pair##*:}" > "$ANAICO_DATA/settings.json"
      break
    fi
  done
fi

# Already running (another launch): just show the page.
if curl -fsS --max-time 2 "$url/" >/dev/null 2>&1; then
  open "$url"
  exit 0
fi

exec "$res/node" "$res/app/src/server.ts" --open >>"$support/server.log" 2>&1

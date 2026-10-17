# The Mac app

`scripts/build-mac-app.sh` builds `dist/Anaico.app` and a zip of it (about 80 MB): a pinned Node, the app with its packages, the
character creator at the release this version pins, and a small native launcher. Double-click it and the page opens; quit it
(Dock → Quit, or Cmd-Q) and the server stops. Clicking the Dock icon again shows the page.

```bash
scripts/build-mac-app.sh                 # for this Mac
scripts/build-mac-app.sh --arch arm64    # for Apple Silicon, built on an Intel Mac (or the other way round)
```

It needs the Xcode command line tools (`swiftc`) and network access (Node from nodejs.org, checked against its published SHA-256, and the
creator from GitHub).

## For the person who gets the zip

- The app is **not signed with a developer certificate** (that needs an Apple Developer account), so macOS blocks it the first time:
  right-click → **Open**, then **Open** again; or System Settings → Privacy & Security → **Open Anyway**.
- It still needs **a brain** installed: Claude Code, opencode, Cursor or Ollama. The first time, it picks one it finds; after that the
  choice is made in the page.
- Her settings, chat and look are in `~/Library/Application Support/Anaico/` (`data/`, `workspace/`, `server.log`), so replacing
  the app with a newer one keeps them.

## How it works

- The launcher (`scripts/mac/main.swift`) runs `Resources/start.sh`, which `exec`s the bundled Node on the bundled copy of the app.
  A Finder-launched app gets a bare `PATH`, so `start.sh` asks the user's login shell for theirs (otherwise `claude`, `opencode` and
  `ollama` would not be found) and sets `ANAICO_DATA`, `ANAICO_WORKSPACE` and `CREATOR_SRC`.
- `ANAICO_DATA` / `ANAICO_WORKSPACE` (`src/paths.ts`) move the folders that are otherwise `data/` and `workspace/` next to the code.
- To try a build without touching the real folders: `open dist/Anaico.app --env PORT=3799 --env HOME=/tmp/anaico-test`.

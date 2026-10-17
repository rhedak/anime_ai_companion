# Desktop shell (Electron)

A window around the app. It contains no app code of its own: `main.cjs` starts `src/server.ts` (run by Electron's bundled Node, 24.x, which is newer than the
22.18 the app needs) and shows the page the server serves. The server is unchanged and still listens on `127.0.0.1` only. The window loads that one
origin and nothing else; other links open in the user's browser, and every browser permission except clipboard-write and fullscreen is refused.

```bash
cd app
npm install     # downloads Electron
npm start       # a checkout: runs ../src/server.ts, creator from ../../anime-character-creator
```

- **User files** are in Electron's `userData` folder (`%APPDATA%\anaico-desktop` on Windows, `~/Library/Application Support/anaico-desktop` on a Mac), as
  `data/`, `workspace/` and `server.log` (`ANAICO_DATA`, `ANAICO_WORKSPACE`). Nothing is written next to the code.
- **A server already running** on the port (3737, or `PORT`) is shown instead of starting another one. Quitting the app stops only a server it started.
- **Not done yet:** packaging (an installer that carries the app and the creator at its pinned release in `resources/`), a native folder dialog
  for "choose a folder" (`src/folder-picker.ts` has no Windows branch), a tray icon, signing, and moving the Mac app onto this shell.

# Desktop shell (Electron)

A window around the app. It contains no app code of its own: `main.cjs` starts `src/server.ts` (run by Electron's bundled Node, 24.x, which is newer than the
22.18 the app needs) and shows the page the server serves. The server is unchanged and still listens on `127.0.0.1` only. The window loads that one
origin and nothing else; other links open in the user's browser, and every browser permission except clipboard-write and fullscreen is refused.

```bash
cd app
npm install     # downloads Electron and electron-builder
npm start       # a checkout: runs ../src/server.ts, creator from ../../anime-character-creator
npm run dist    # stages the app and the creator, builds dist/Anime AI Companion Setup <version>.exe (about 145 MB)
```

- **User files** are in Electron's `userData` folder (`%APPDATA%\Anime AI Companion` on Windows), as `data/`, `workspace/` and `server.log`
  (`ANAICO_DATA`, `ANAICO_WORKSPACE`). Nothing is written next to the code, and uninstalling leaves them.
- **A server already running** on the port (3737, or `PORT`) is shown instead of starting another one. Quitting the app stops only a server it started.
- **What the installer carries** (`scripts/stage.mjs`): the app without tests, site or demo, with its production packages (`resources/anaico-app/`, not
  `app/`, which Electron would take for its own program), and the creator's TypeScript at the release `package.json` pins (`resources/creator/`). The
  packages are put in by `scripts/after-pack.cjs`, because electron-builder never copies a `node_modules` folder through `extraResources`.
- **The installer** is per user (no administrator needed), lets the user pick the folder, and is not signed, so Windows SmartScreen warns on first run.
- **The icon** (`build/icon.png`) is Risa, the default character, cropped to her face on a rounded plate. It is committed; `scripts/make-icon.cjs` makes it
  again from a render of her (the command is at the top of that file).
- **Not done yet:** a native folder dialog for "choose a folder" (`src/folder-picker.ts` has no
  Windows branch), a tray icon, signing, auto-update, and moving the Mac app onto this shell.

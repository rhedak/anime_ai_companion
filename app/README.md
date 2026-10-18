# Desktop shell (Electron)

A window around the app. It contains no app code of its own: `main.cjs` starts `src/server.ts` (run by Electron's bundled Node, 24.x, which is newer than the
22.18 the app needs) and shows the page the server serves. The server is unchanged and still listens on `127.0.0.1` only. The window loads that one
origin and nothing else; other links open in the user's browser, and every browser permission except clipboard-write and fullscreen is refused.

```bash
cd app
npm install     # downloads Electron and electron-builder
npm start       # a checkout: runs ../src/server.ts, creator from ../../anime-character-creator
npm run dist    # stages the app and the creator, builds dist/Anime AI Companion Setup <version>.exe (about 145 MB)
npm run dist:mac # on a Mac: dist/Anime AI Companion-<version>[-arm64].dmg and -mac.zip, one per chip (about 210 MB each)
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
- **Choosing a folder** uses the server's own dialog (`src/folder-picker.ts`: PowerShell on Windows, osascript on a Mac), so the shell needs nothing extra.
- **The tray icon** (Risa) brings the window back on a click; its menu has Show, Open in Browser and Quit. Closing the window only hides it: she and her
  server keep running until Quit, and the first time Windows says so in a notice. Quit stops the server too.
- **On a Mac** the files are in `~/Library/Application Support/Anime AI Companion/`. A Finder-launched app has a bare `PATH`, so the shell asks the user's
  login shell for theirs (and adds `~/.local/bin`, `~/.opencode/bin`, Homebrew and the like) before starting the server; otherwise `claude`, `opencode`,
  `cursor-agent` and `ollama` would not be found. Choosing the first brain on a fresh start is the server's own job (basic mode), not the shell's.
  Closing the window hides it (the Dock icon or the menu-bar icon brings it back); Cmd-Q quits and stops the server.
- **Signing:** the Mac build is signed ad hoc (`identity: "-"`), not with a developer certificate (that needs an Apple Developer account), so Apple Silicon
  accepts it but macOS still blocks the first launch of a downloaded copy: right-click → **Open**, then **Open** again (or System Settings → Privacy &
  Security → **Open Anyway**). The Windows installer is unsigned too.
- **Microphone.** Electron has the browser's speech API but no speech service behind it (that needs a Google key of the app's own), so
  dictation would only fail with a network error. When the user agent says Electron, the button opens a card (`askOpenInBrowser` in `public/app.js`)
  offering the page in the user's browser, where it works. A local recogniser would make it work in the window itself.
- **Not done yet:** a developer certificate and notarisation, and auto-update.

---
description: Download the desktop app for Windows, macOS or Linux. One install, no terminal; she runs in her own window with your coding agent behind her.
---

# Download

**[Download the latest version](https://github.com/rhedak/anime_ai_companion/releases/latest)** (free, MIT licensed)

One file for your system, from the table below or the *Assets* list of the release. Nothing else to install: Node.js and the character creator are inside.
You still need **a brain** (below); without one she runs a small built-in script and tells you how to get one.

| System | File | Size |
| --- | --- | --- |
| **Windows** 10 or newer | [`Anime.AI.Companion.Setup.<version>.exe`](https://github.com/rhedak/anime_ai_companion/releases/download/v<version>/Anime.AI.Companion.Setup.<version>.exe) | about 165 MB |
| **macOS** 11 or newer, Apple Silicon | [`Anime.AI.Companion-<version>-arm64.dmg`](https://github.com/rhedak/anime_ai_companion/releases/download/v<version>/Anime.AI.Companion-<version>-arm64.dmg) | about 180 MB |
| **macOS**, Intel | [`Anime.AI.Companion-<version>.dmg`](https://github.com/rhedak/anime_ai_companion/releases/download/v<version>/Anime.AI.Companion-<version>.dmg) | about 190 MB |
| **Linux**, x64 | [`Anime.AI.Companion-<version>.AppImage`](https://github.com/rhedak/anime_ai_companion/releases/download/v<version>/Anime.AI.Companion-<version>.AppImage) | about 190 MB |
| **Linux**, arm64 | [`Anime.AI.Companion-<version>-arm64.AppImage`](https://github.com/rhedak/anime_ai_companion/releases/download/v<version>/Anime.AI.Companion-<version>-arm64.AppImage) | about 190 MB |

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org), from the first Windows installer that is signed (it is being applied for; see the [code signing policy](code-signing.html)). Until then the installer is unsigned and Windows warns, as described below.

## The first start

The app is **not signed with a developer certificate** (that needs a paid account), so your system warns you once. It is the same program
you can read in this repository.

- **Windows:** SmartScreen says "Windows protected your PC". Choose **More info**, then **Run anyway**. On Windows 11 with **Smart App Control** switched on, an unsigned installer is blocked with no way to run it anyway: turn Smart App Control off (Windows Security → App & browser control → Smart App Control) to install. A signed installer is [being applied for](code-signing.html). The installer is per user and needs
  no administrator.
- **macOS:** open the `.dmg`, drag the app into *Applications*, then **right-click it → Open**, and **Open** again. (Or System Settings →
  Privacy & Security → **Open Anyway**.)
- **Linux:** make the file executable and run it: `chmod +x Anime.AI.Companion-<version>.AppImage` and double-click it, or start it in a terminal.
  An AppImage uses FUSE 2 (`libfuse2`, or `libfuse2t64` on Ubuntu 24.04 and newer). Without it, newer AppImages unpack themselves into a folder in `/tmp` and start
  from there (this prints a long file listing and leaves that folder behind); an older one fails with `error loading libfuse.so.2`. Installing that package avoids both, or unpack the file yourself and run it from a folder of your own: `./Anime.AI.Companion-<version>.AppImage --appimage-extract`, then
  `squashfs-root/AppRun`. The launcher entry the AppImage makes starts the app with `--no-sandbox` (an AppImage cannot carry the setuid helper
  Chromium's sandbox wants); started by hand, add it yourself if you see an "unprivileged user namespaces" or `chrome-sandbox` error. The folder
  picker needs `zenity` or `kdialog`, and the tray icon needs a desktop that shows one. `--version` prints the version and `--help` the options.

The release also has a `SHA256SUMS` file; `sha256sum -c SHA256SUMS --ignore-missing` checks what you downloaded.

## What you need besides the app

One brain, the same ones the [Brains](brains.html) page describes: Claude Code (`claude`, signed in), opencode, Cursor (`cursor-agent`) or
Ollama. The app looks for them the way your terminal does, so a brain you can start from a terminal is found. It picks one it finds on the first
start; after that the choice is yours, in the page.

## Where things are

Her settings, chat, look and the folder she works in are in your user folder, never inside the app, so installing a newer version keeps them:

- Windows: `%APPDATA%\Anime AI Companion`
- macOS: `~/Library/Application Support/Anime AI Companion`
- Linux: `~/.config/Anime AI Companion`

Closing the window hides her to the tray or menu bar; she and her server keep running until you choose **Quit**.

## Updates

Nothing is installed behind your back. The first time, the app asks whether to look for a newer version about once a day; if you say yes it
asks GitHub for the newest version number (GitHub sees your IP address and that the app asked, nothing else), and tells you when there is one,
with a button to this page. The app asks only once; the switch is under **File → Options**, and the **Help** menu has *Check for Updates…*.

## Speaking to her

The microphone button needs your browser's speech recognition, which the app's window does not have. Its button offers to open the same page in
your browser, where it works (and still asks first).

## Prefer to run it from source?

[Getting started](getting-started.html) has the clone-and-run route, the `anaico` command for work mode in a folder, and every setting. Or
[try the demo](demo/) first: nothing to install.

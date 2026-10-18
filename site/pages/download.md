---
description: Download the desktop app for Windows, macOS or Linux. One install, no terminal; she runs in her own window with your coding agent behind her.
---

# Download

**[Download the latest version](https://github.com/rhedak/anime_ai_companion/releases/latest)** (free, MIT licensed)

One file for your system, from the *Assets* list of the release. Nothing else to install: Node.js and the character creator are inside.
You still need **a brain** (below); without one she runs a small built-in script and tells you how to get one.

| System | File | Size |
| --- | --- | --- |
| **Windows** 10 or newer | `Anime.AI.Companion.Setup.<version>.exe` | about 145 MB |
| **macOS** 11 or newer, Apple Silicon | `Anime.AI.Companion-<version>-arm64.dmg` | about 210 MB |
| **macOS**, Intel | `Anime.AI.Companion-<version>.dmg` | about 210 MB |
| **Linux**, x64 | `Anime.AI.Companion-<version>.AppImage` | about 210 MB |
| **Linux**, arm64 | `Anime.AI.Companion-<version>-arm64.AppImage` | about 210 MB |

## The first start

The app is **not signed with a developer certificate** (that needs a paid account), so your system warns you once. It is the same program
you can read in this repository.

- **Windows:** SmartScreen says "Windows protected your PC". Choose **More info**, then **Run anyway**. The installer is per user and needs
  no administrator.
- **macOS:** open the `.dmg`, drag the app into *Applications*, then **right-click it → Open**, and **Open** again. (Or System Settings →
  Privacy & Security → **Open Anyway**.)
- **Linux:** make the file executable and run it: `chmod +x Anime.AI.Companion-<version>.AppImage` and double-click it, or start it in a terminal.
  On Ubuntu 24.04 and newer the browser sandbox can be refused for an AppImage; start it with `--no-sandbox` if you see that error. The folder
  picker needs `zenity` or `kdialog`, and the tray icon needs a desktop that shows one.

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
with a button to this page. The **Help** menu has *Check for Updates…* and the switch.

## Speaking to her

The microphone button needs your browser's speech recognition, which the app's window does not have. Its button offers to open the same page in
your browser, where it works (and still asks first).

## Prefer to run it from source?

[Getting started](getting-started.html) has the clone-and-run route, the `anaico` command for work mode in a folder, and every setting. Or
[try the demo](demo/) first: nothing to install.

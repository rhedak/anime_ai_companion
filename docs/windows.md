# Running it on Windows

Windows support is new and has had little testing. This is the shortest way to try it; if something breaks, the last section says
what to send.

## The short way

1. On the repository page choose **Code → Download ZIP**, and unpack it somewhere you keep files (not inside `Program Files`).
   If you know git, `git clone https://github.com/rhedak/anime_ai_companion.git` works as well.
2. Double-click **`windows-start.bat`**. Windows may warn that the file comes from the internet: choose *More info → Run anyway*.
3. It checks four things and offers to install what is missing. It asks before each install:
   - **Node.js 22.18 or newer**, installed with `winget` (included in current Windows 10 and 11). Without winget it opens nodejs.org.
   - **The app's packages** (`npm install`, once).
   - **The character creator** (the drawing code), downloaded from GitHub as a ZIP; no git needed.
   - **opencode**, the free brain, installed with `npm install -g opencode-ai`. Its free models need no account. If you skip it, she runs a small
     built-in script instead (hair, eyes, moods and gestures, but no real conversation) and tells you in her first message how to get a brain.
4. Your browser opens at <http://127.0.0.1:3737>. Leave the black window open while you use her; closing it stops her.

Next time, double-click `windows-start.bat` again; it skips what is already there. Under *Brain* in the page you can switch to
Claude Code, Cursor or Ollama if you have one of them.

## Notes

- **Where things live.** Your chat, settings and her look are in the app's `data\` folder; the creator is kept in `%USERPROFILE%\.anaico\creator`.
- **Claude Code on Windows.** Use its own installer (it gives a real `claude.exe`). One installed through npm is a `.cmd` shim, which
  works for opencode and Cursor but is not a good fit for Claude's long launch arguments.
- **Work mode.** Letting her edit files and run commands works the same way as elsewhere (every change asks first). `!command` in
  the chat runs through `cmd.exe`.
- **No folder dialog.** The "choose a folder" button has no Windows dialog yet; type or paste the folder's path instead.
- **Port in use.** If 3737 is taken, open a terminal in the app folder and run `set PORT=3800 && node src/server.ts --open`.

## If it does not start

Open **Command Prompt** (or PowerShell) in the app folder and run:

```
node bin/anaico.js --doctor
```

It says what is missing (Node, a brain, the creator, the port). Send that output, plus the text in the black window, to whoever gave
you the app.

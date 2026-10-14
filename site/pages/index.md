---
description: A face for your coding agent. A free, open-source anime character that fronts Claude Code, Cursor, opencode or Ollama on your own computer, asks before every command or edit, and can be answered from your phone.
---

# Anime AI Companion

**A face for your coding agent.** A free, open-source anime character who lives in your browser and runs on **your own
computer**, in front of Claude Code, Cursor, opencode or a local Ollama model. In work mode she reads, edits and runs
commands in your project folder, and **asks first**, with a card that shows the exact command or diff; your phone can
answer those cards. Her face is a real vector drawing that blinks, talks and changes expression as she writes, and when you
ask her to change her hair or put on glasses she **redraws herself**. In chat mode she is simply a friend with a face.

![Work mode: she asks before an edit, and the card shows the diff](assets/work.png)

**[Try the demo now](demo/)**: a live Risa in your browser, nothing to install and nothing sent anywhere. Or [watch the short trailer](https://www.youtube.com/shorts/E_4PIfWC-5U) (about a minute).

![The chat and the character side by side](assets/chat.png)

## What you can do

- **Chat.** Her mood follows the conversation: seven expressions, blinking, and a mouth that moves while she
  talks. `/show` runs through all of them.
- **Work with her.** Point her at a project folder and she can read files, edit them and run commands. She asks
  first, with a card that shows the exact command or change. [Work mode](work-mode.html)
- **Use the brain you already have.** Claude Code, Cursor, opencode, or a local model through Ollama (chat, and an
  experimental work mode for models that support tools). [Brains](brains.html)
- **Give her a character.** Import a character card from [SillyTavern](https://github.com/SillyTavern/SillyTavern) or [Chub](https://chub.ai), with her greeting and lorebook if you like,
  and she keeps a plain file of notes about you. [Customising](customising.html)
- **Talk to her.** Type while she answers and your messages queue; the microphone button (opt-in) dictates instead of typing.
  [Chatting](chatting.html)
- **Let her redraw herself.** "Blue hair and glasses, please." Her look is reversible, and you can save looks and
  switch to any of 19 built-in characters. [Her looks](looks.html)
- **Carry on from your phone.** One flag lets your phone join the same session over your own network, with a QR
  code to scan. [From your phone](phone.html)
- **Bring your own pictures.** Replace the drawn character with a set of images from any image tool.
  [Picture packs](picture-packs.html)

![She changed her hair and put on glasses when asked](assets/customise.png)

## Start in a minute

You need Node.js 22.18 or newer, Python 3.11 or newer, and one brain (for example a signed-in `claude`).

```bash
git clone https://github.com/rhedak/anime-character-creator.git
git clone https://github.com/rhedak/anime_ai_companion.git
cd anime_ai_companion
npm install
npm start          # then open http://127.0.0.1:3737
```

Then try: *"Hi! Could you change your hair to mint green and put on a black witch hat?"*
The full steps, and what to do when something does not start, are in [Getting started](getting-started.html).

## Private by design

Everything runs on your machine. The only thing that leaves it is the conversation your own brain sends to its
provider (for Claude Code, to Anthropic). The server listens on `127.0.0.1` only, unless you ask for phone access,
and work mode never skips an approval. [Safety and privacy](safety.html)

## Free, and a friendly request

It is MIT licensed: use it, change it, share it. If you improve it, a pull request is very welcome and never
required. The character is drawn by [anime-character-creator](https://github.com/rhedak/anime-character-creator), a
separate open-source project that draws characters from parametric shapes, in code.

**Made with AI, openly.** The code, the character creator and these pages were written with AI coding agents, mostly
Claude Code. [How this was made](about.html#how-this-was-made) says exactly what that means.

This is an independent project, not affiliated with or endorsed by Anthropic, Cursor, or any other provider named
in these pages.

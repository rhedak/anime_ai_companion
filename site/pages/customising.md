---
description: Make it yours: her name, personality, expressions, the interface colours, and the drawing itself.
---

# Customising

Keep your changes where updates do not overwrite them. `data/` and `workspace/` are yours: git ignores them, and
updates never touch them.

| To change | Edit | Takes effect |
| --- | --- | --- |
| Her voice | the **Voice** menus; `public/speech.js` for more | at once; reload after editing |
| Her name | click it, or `/rename Hana` | at once |
| Her look | ask her in chat, or `COMPANION_PRESET` for the starting character | at once |
| Her personality and voice | `persona.md` (chat) and `persona-work.md` (work-mode rules) | restart the server; for Claude also `/clear`, because an existing conversation keeps the prompt it began with |
| Her expressions | `emotions.json` | restart the server |
| The interface | `data/custom.css` (variables are in `public/theme.css`) | reload the page |
| Models and pre-approved tools | `data/settings.json`, `COMPANION_MODEL`, `COMPANION_WORK_MODEL` | restart the server |
| How the body is drawn: shapes, hairstyles, outfits, presets | the [creator](https://github.com/rhedak/anime-character-creator), not this repo | restart the server |

## The interface

All colours, fonts, corner radii and sizes of the interface are CSS variables at the top of `public/theme.css`, each
with a comment. Put your changes in **`data/custom.css`**: it loads last, a page reload shows the change, and
deleting it restores the default look. You can simply ask an AI assistant to write it:
"edit `data/custom.css` to make the chat panel light with a blue accent; the variables are documented in
`public/theme.css`".

```css
:root { --accent: #4f9d69; --surface: #22302a; --panel: #17201c; --radius-lg: 6px; --font-heading: "Courier New", monospace; }
```

## Her persona and tags

`persona.md` holds her personality and the tag protocol that drives her face (`[emotion:…]`, `[gesture:…]`,
`[avatar …]`, `[image …]`, `[demo]`). Keep that protocol if you rewrite her personality, and keep the emotion list
in step with `emotions.json`. It has a `{{name}}` placeholder for her name.

## Her voice

This is open source, so the voice is yours to change in your own checkout. All of it is in `public/speech.js`
(about 150 lines, no dependencies) and the **Voice** wiring near the end of `public/app.js`; a page reload picks up an edit. For
example:

- **Pitch, or a different default speed:** set `utterance.pitch` or change `DEFAULT_RATE` and `RATES` in
  `speech.js`.
- **A voice per character:** choose the voice from the character's name or pack in `speak()`.
- **A better voice:** replace `synth.speak(utterance)` with a call to a local text-to-speech program (Piper and
  Kokoro are open-source ones) and play the audio it returns. The server is the place to run it; `src/server.ts` is
  small enough to read in one sitting.
- **Speech input:** add a microphone button that fills the message box. The browser's `SpeechRecognition` is the
  quickest way, but it sends audio to the browser's vendor; a local Whisper model keeps it on your machine. Remember
  that microphones need `localhost` or HTTPS.

You can ask an AI assistant to make the change: "add a microphone button to `public/app.js` that dictates into the
message box with `SpeechRecognition`". [AGENTS.md](../../AGENTS.md) has the rules a change must keep.

## The drawing

The renderer imports the creator by path, so work in the creator checkout next to this repo (or wherever
`CREATOR_SRC` points): edits are picked up the next time the server starts. Do not install it: a second copy would
only be a second source of truth. This repo pins a creator release in `package.json`; your checkout of the creator's
`main` may be ahead of it.

## Changing the app itself

Node runs the TypeScript directly, so `npm start` is all there is. `npm run typecheck` and `npm test` are the checks,
and neither needs a Claude, Cursor or opencode login. The notes for anyone changing the code, including the safety
rules a change must keep, are in [AGENTS.md](../../AGENTS.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md).

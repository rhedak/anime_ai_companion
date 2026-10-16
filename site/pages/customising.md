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
in step with `emotions.json`. It has a `{{name}}` placeholder for her name. The `[remember …]` tag (how she saves a note about
you) is explained to her with her first message of a conversation, not in `persona.md`, so you do not need to add it.

### Her notes about you

She can keep a few notes about you across conversations, in `data/memory.md`: one short fact per line, plain Markdown you can
open and edit.

- In chat, when you tell her something worth keeping (your name, a preference, something you ask her to remember), she
  **asks first**: a small card under her message shows the note and you choose **Keep** or **Not now**. Nothing is saved until you
  keep it, a note you turn down is not offered again in that conversation, and an unanswered card just stays unsaved. She is told
  which proposed notes were declined or are still waiting, so she does not say she saved them. Up to 50 notes, 200 characters each.
- `/memory ask` (the default), `/memory auto` and `/memory off` choose what happens to a note she proposes. With **auto** she saves
  it herself (**🧠 Remembered: …**) with an **Undo** button next to it; **off** saves nothing, and she is told so. The choice is
  kept in `data/settings.json`, and `auto` cannot be switched on from a phone.
- `/memory` lists them, `/memory add <note>` adds one, `/memory forget <number>` (or `all`) removes one, and `/memory edit`
  opens the file. An edit by hand is picked up with her next message.
- She is told her notes with the first message of a conversation, and only what changed after that, so the prompt that
  Claude keeps cached is never touched. A new conversation (`/clear`) gets the full list again.
- Notes are information about you, not instructions: they are handed over as data. **She saves nothing in work mode**, because a
  file or web page she reads there could talk her into writing a note that outlives the conversation; use `/memory add` there. If
  you ask her to remember something in work mode (or with notes off), the chat says once that she cannot, and she is told not to
  promise it.
- These are **her own notes about you**, a plain file on your computer. They are not Claude's memory feature, and they are
  not shared with it.
- The file belongs to you: it stays in `data/`, out of git, and nothing is sent anywhere except in her messages to your brain.
  Switching brain starts a new conversation, so she is told the notes again.

### Character cards

Character cards (the community format used by [SillyTavern](https://github.com/SillyTavern/SillyTavern), [Chub](https://chub.ai) and similar sites: a `.json` file, or a `.png`
with the card inside) can give her a ready-made personality.

- `/card import <file>` reads a V1, V2 or V3 card and shows what it will add. Nothing changes until you choose
  **Use this card** (or `/card apply`); **Cancel** (or `/card cancel`) drops it.
- Her description, personality, scenario, example lines and name are always used. HTML and our own tags
  (`[emotion:…]`, `[avatar …]`, `[image …]`) are removed from the text, `{{char}}` becomes her name, and each field is capped
  in length. The author's own notes are shown in the preview, nothing more.
- A card can carry more, and the preview offers each part as a checkbox:
  - **Her greeting** (`first_mes` and the alternate greetings): new conversations open with it, shown by the page without
    asking the model, so it costs nothing. She is told afterwards what she said. Ticked by default.
  - **The lorebook:** short background entries that are added to your message when it mentions their keywords, each entry once
    per conversation, at most three entries and 1,500 characters per message (it adds to what a message costs). Only plain
    keywords are supported, not regular-expression keys. Ticked by default.
  - **The card author's own instructions** (`system_prompt` and `post_history_instructions`): off by default. These are
    orders written by the card's author, and they apply in chat **and in work mode**, where she can read files and run
    commands. They sit before her style notes and the expression protocol, and the protocol still applies, but a card can
    tell her to behave in ways you do not expect, ignore your project's rules, or (if it is malicious) steer her toward harmful
    commands. Every command still waits for your approval, but you are trusting the card's author. The preview warns strongly
    once and that is the only warning: using them is entirely your own risk.
  - Not supported: a card's `extensions` (front-end scripts and the like).
- Her name becomes the card's name if it fits the name rules. Her look is not part of a card.
- The card is saved in `data/character.json` and replaces only the first part of `persona.md`. The style notes and the
  expression protocol stay. A conversation that is already running keeps the persona it began with, so use `/clear`.
- `/card apply greeting lore orders` (any of the three words) applies a waiting card with exactly those parts; plain `/card apply` uses the greeting and lorebook.
- `/card export` downloads her current character as a V2 card, with the greeting, instructions and lorebook if a card brought them. `/card reset` goes back to `persona.md` (she keeps the
  name; rename her with `/rename`).
- A card is text written by someone else and it becomes part of her instructions. Read the preview before you accept it.
  Importing and resetting work from the computer itself only, not from a phone.

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

The renderer loads the creator's TypeScript by path, so work in the creator checkout next to this repo (or wherever
`CREATOR_SRC` points): edits are picked up the next time the server starts. Do not install it: a second copy would
only be a second source of truth. This repo pins a creator release in `package.json`; your checkout of the creator's
`main` may be ahead of it.

## Changing the app itself

Node runs the TypeScript directly, so `npm start` is all there is. `npm run typecheck` and `npm test` are the checks,
and neither needs a Claude, Cursor or opencode login. The notes for anyone changing the code, including the safety
rules a change must keep, are in [AGENTS.md](../../AGENTS.md) and [CONTRIBUTING.md](../../CONTRIBUTING.md).

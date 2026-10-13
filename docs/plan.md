# Plan: portable personas, memory, and a few smaller steps

Written 2026-10-13. Replaces the 2026-10-11 plan for Cursor as a brain, which is
implemented (Cursor, opencode and Ollama are brains; the history of that plan is in
git). This file is only what comes next.

The ideas come from reading two community lists of companion projects
(awesome-agentic-ai-waifus and awesome-ai-companion) and asking what they do that this
app does not yet. Everything here keeps the rules in `AGENTS.md`: loopback only,
nothing from a model is injected as HTML, permission modes stay in memory, and the
cache-friendly way of talking to Claude is not broken.

## Order

| # | Step | Cost | Why this place |
| --- | --- | --- | --- |
| 1 | Character cards (import and export) | small | Isolated, fully testable, and a large catalogue of ready personas |
| 2 | A memory file she can read and write | medium | Memory is the biggest gap against the lists |
| 3 | Check the MCP bridge, then decide | small | Part of it may exist already |
| 4 | Speech input, opt-in | medium | Voice out exists, voice in does not |
| 5 | Proactive greetings | small, but costly to use | Only without a model call |

Smaller ideas are at the end.

## 1. Character cards (V2 and V3)

A character card is the community's portable persona format (a PNG with embedded JSON, or
plain JSON), used by SillyTavern, Chub and similar sites.

- `/card import <file>` reads a V2 or V3 card and fills the character part of her persona:
  name, description, personality, scenario, first message.
- `/card export` writes her current persona as a V2 card.
- The tag protocol (`[emotion:…]`, `[gesture:…]`, `[avatar …]`, `[image …]`) is not part of a
  card and must not be replaceable by one. Keep the persona in two pieces: the character
  (from a card, or `persona.md`) and the protocol (ours, fixed). Today `persona.md` holds
  both in one file, so the first job is splitting it without changing what the model reads.
- Her look is not in the card spec, so only the persona travels. A card may carry a name; it
  uses the same path as `/rename`.
- A card is untrusted text that ends up in her system prompt. Show what will be used and
  ask before it applies. Strip markup, cap the length, ignore fields we do not map, and never
  run anything from a card (no regex scripts, no embedded extensions).
- Taking effect: the persona is part of the prompt a Claude conversation began with, so an
  import needs `/clear`, and the command says so. Ollama, Cursor and opencode read it on
  the next conversation.
- Tests: fixture cards (V2 JSON, V3 JSON, PNG with a text chunk, a hostile one). No network
  and no login.

Done when: a card from a public site becomes her persona after one confirmation, and an
export imports cleanly again.

## 2. A memory file

She has the chat log and nothing else that survives `/clear`. The lists favour plain,
inspectable memory (Markdown, verbatim, forgettable) over vectors, and so do we.

- `data/memory.md`: one short fact per line. It belongs to the user, like the rest of
  `data/`, and stays out of git.
- She adds a line with a `[remember …]` tag. The server strips it like her other tags,
  appends the line, and shows it in the chat ("remembered: …") so nothing is written
  silently.
- `/memory` lists the lines, `/memory forget <n>` removes one, `/memory edit` opens the file.
- How it reaches the model: not in a launch flag or the system prompt (that would break the
  cached prompt; see Claude Code notes in `AGENTS.md`). The file goes through
  `notesForModel`, once at the start of a conversation and again only when it changes.
- A size cap, with a hint when it is near ("your notes are getting long"), because every
  extra byte rides on every cold start.
- Only this one file is ever written, only by appending. A line that looks like an
  instruction to change files, commands or settings is just text; it is shown, never run.
- Not now: vectors, graphs, summaries of old chats, dream or decay systems.

Done when: she remembers a fact across `/clear` and a restart, the user can see and
remove every line, and the cold-cache card still guards the first message after a gap.

## 3. The MCP bridge

`data/attach-mcp.json` and `data/attach-token` exist on the live install, but nothing in
`src/`, `public/` or the docs mentions them. Find out what writes them (probably a Claude
Code or Cursor feature, not this app) before designing anything.

If there is no bridge, the idea is a small local MCP server with tools such as
`set_emotion`, `play_gesture` and `redesign_avatar`, so an agent in another terminal can use
her as a face. It would be loopback only, token-protected, and could not start commands or
change permissions. It follows `--lan` rules for anything that is not loopback.

Done when: the question "what are those files" is answered in a line here, and either
removed from the plan or turned into a design.

## 4. Speech input (opt-in)

Nothing in the page uses speech recognition today; on a phone the README tells people to
use the keyboard's microphone key.

- Browser `SpeechRecognition` is the cheapest, but Chrome and Safari send the audio to
  their vendor. That has to be said in the menu, as it is for the online voices.
- A local Whisper is truer to "everything stays on your machine" and costs a dependency.
- Either way: a push-to-talk button, off by default, remembered in the browser, never
  listening in the background. Microphones need `localhost` or HTTPS, so phones over
  `--lan` still cannot use it.
- Decide between the two with a half-day spike, as the Cursor plan did.

## 5. Proactive greetings

A companion that speaks first after you have been away is common in the lists. Here every
message after a long gap pays for the whole conversation again, which is why
`src/cache-guard.ts` stops it. So a proactive message that calls the model is the opposite
of what the app protects.

Only worth building as a canned line shown in the page, with no model call, off at every
start. If that is not wanted, leave it out.

## Smaller ideas

- Stickers: pick an image from an emotion tag, using the tags she already writes.
- A mood-based theme, through the variables in `public/theme.css`.
- A short page in `docs/` on bringing your own brain, since several listed projects are
  guides, not code.
- Presets as shareable packs: `packs/` is close to this already.

## Out of scope

- Playing games, Twitch or YouTube chat, and bridges to Telegram, Discord or WeChat. They
  do not fit a loopback-only, local app.
- Watching the screen or webcam, and device or hardware control.
- Fine-tuning pipelines and anything that sends the user's data off the machine on its own.
- VRM, Live2D, Pyodide, and a UI for the pre-approved tool list stay open as before and are
  not part of this plan.

## Risks

- **Persona split.** Moving the protocol out of `persona.md` must produce the same prompt
  text for the model. Compare before and after, because a changed prompt loses the cache.
- **Cards as an attack path.** They are text from strangers. Review before applying, and
  treat every field as data.
- **Memory growth.** The cap and the "changes only" delivery keep the cost of a cold start
  predictable. Check it against the cache-guard thresholds.
- **A model that writes files.** Keep it to one append-only file, shown in the chat, with
  an undo.
- **Provider differences.** A change that touches the persona or notes must say what
  Claude Code, Cursor, opencode and Ollama each do now; they differ in system prompts
  (Cursor and opencode prepend the persona to the user message).

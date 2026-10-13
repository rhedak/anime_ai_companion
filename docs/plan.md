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
| 3 | ~~Check the MCP bridge, then decide~~ | done | Was removed on purpose; dropped (see 3) |
| 4 | Speech input, opt-in | medium | Voice out exists, voice in does not |
| 5 | ~~Proactive greetings~~ | dropped | A canned line cannot fit every character (see 5) |
| 6 | Tools for Ollama models that support them | spike built; needs a check with real models | Local code never leaves the machine; quality depends on the model |

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
- Greetings, the lorebook and the author's own instructions are opt-ins at import (built 2026-10-13), with one warning there.
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

## 3. The MCP bridge (dropped)

Resolved 2026-10-13. `data/attach-mcp.json` and `data/attach-token` are leftovers from "pro mode", a stdio channel that let a
terminal Claude Code session be her brain (added in `8e6167a`, removed again in `5bf06d2` the same day). That removal took
out the channel shim, the local token socket and the MCP SDK and zod dependencies (about 1,200 lines of lockfile), because
the default mode already covers what pro mode was a workaround for. Nothing in the app reads or writes the two files now, so
they can be deleted by hand: the token belongs to a socket that no longer exists.

A new MCP server that lets another agent drive her face (`set_emotion`, `play_gesture`, `redesign_avatar`) would bring back
the same dependency and the same kind of local socket and token, for a use nobody has asked for. Not planned. If it comes
back, start from `git show 8e6167a` and keep it loopback only, token protected, and unable to start commands.

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

## 5. Proactive greetings (dropped)

Resolved 2026-10-13, not built. A companion that speaks first after you have been away is common in the lists. Here every
message after a long gap pays for the whole conversation again, which is why `src/cache-guard.ts` stops it, so a greeting that
calls the model is the opposite of what the app protects. The remaining version, a canned line shown by the page with no model
call, does not fit either: with character cards (step 1) she can be anyone, and a fixed English line would greet in the wrong
voice. If it comes back, the line has to come from the character (a field of the card, or `persona.md`), not from the app.

## 6. Tools for Ollama models

Ollama is chat only today (`canUseTools` is false, work mode unavailable). A model that supports tool calls, such as the
coding-focused Qwen models, could do work mode too. Ollama only calls the model, so the tools and the loop are ours to
write; Claude, Cursor and opencode ship their own.

What Ollama gives us (from its API docs; not yet tried on a real install):

- `/api/chat` takes a `tools` list (`type`, `function.name`, `description`, `parameters`) and streams a call as
  `message.tool_calls` with `function.name` and an `arguments` object, in a chunk before the final `done: true` one.
- The result goes back as a message with `role: "tool"` and `tool_name`, after the assistant message that holds the
  calls. There is no call id.
- `/api/show` has a `capabilities` list. Its docs example shows only `completion` and `vision`, so whether it reports
  `tools` has to be checked against a real Ollama. If it does not, fall back to a short list of known families, or a
  manual "this model can use tools" setting.

What to build (`src/providers/ollama.ts` is one streamed chat call today):

- Tools run by us in the project folder: read, write or edit, bash, grep and glob. Each has path checks (nothing outside
  the project folder, no home or `/`), size caps, and timeouts.
- The loop: call, run the requested tools, send the results back, repeat until plain text. A turn cap stops a model that
  keeps calling tools.
- Approvals through the existing permission card (`permission` events and `respondPermission`): every call shows the exact
  command or change and waits. Reads can be pre-approved as for the other brains. Ollama's menu is Ask and Plan only,
  and nothing looser exists for it, as for opencode before its opt-in. The mode comes back to Ask at every start.
- `canUseTools` per model, from the capability check, so work mode is only offered when the model supports it.
  Switching models re-checks it.
- Ollama's default context window is small and tool output fills it fast: set `num_ctx` and cut long tool results.
- `persona-work.md` applies in work mode, as for the other brains.
- Tests fake the Ollama server, as `test/ollama.test.ts` does. No model and no Ollama install needed in CI.

**Status 2026-10-13:** the spike is built (`src/providers/ollama-tools.ts`, the loop in `src/providers/ollama.ts`) and tested against a
fake Ollama only: the loop, approvals, plan mode, the turn cap, stopping mid-card and the capability check. It has never run against a
real model. The check is deferred to another machine (2026-10-13): this one (Intel i5, 16 GB, CPU only) cannot run `qwen3-coder:30b`, whose
weights are 19 GB. A machine with about 32 GB of memory, ideally Apple Silicon, can; a 4 to 8 GB tool-capable model such as
`qwen3:8b` would also work here for a first look, slowly. Still to do: try it with `qwen3-coder` (and one weaker model) on a small real task, note which models call tools well,
and check whether `/api/show` reports `tools` on the installed Ollama. The tool set is read_file, grep, bash, write_file and edit_file
(exact text replaced once, or everywhere with replace_all); glob is deferred, since grep and bash cover it.

Spike first: one model (try `qwen3-coder`), three tools (read, grep, bash with approval), a turn cap, and a manual check of
how it behaves on a small real task. Record which models call tools well, and decide whether to widen it from that.

**Warning in the docs (required, not optional).** Local models with tools are the user's responsibility. The README, the
site's work-mode page and the Ollama brain's menu entry say so in plain words:

- How well a local model uses tools depends entirely on the model and its size. Small or older ones call tools badly:
  wrong arguments, loops, or text that only looks like a tool call.
- She can propose a wrong or harmful command or edit with full confidence. Every call still waits for the user's approval,
  so reading what the card shows before approving is the user's job. No mode skips that for Ollama.
- The app does not test, rate or vouch for any particular local model. Work done through one is at the user's own risk,
  and the user checks the result (use git in the project folder).
- It is labelled experimental in the page, with the model's name shown.

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
- **Local tool use is only as good as the model.** The app cannot make a weak model safe or competent. The approval card is
  the only gate, which is why no looser Ollama mode exists and the docs warning above is part of the feature.
- **Context.** Tool output can overflow a small `num_ctx`; truncate and say so.
- **Provider differences.** A change that touches the persona or notes must say what
  Claude Code, Cursor, opencode and Ollama each do now; they differ in system prompts
  (Cursor and opencode prepend the persona to the user message).

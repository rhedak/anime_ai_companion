# Plan: from chat companion to a companion you can work with

Written 2026-10-10. Covers what exists, the two ways of working with her
(browser-owned and terminal-owned sessions), the order to build them in, and
what is still unknown.

## Goal

A local, browser-based anime companion that is **drawn by code and driven by
Claude Code**. You can chat with her, ask her to redesign herself, and work with
her on real tasks (run commands, edit files) as in a normal Claude Code session.

Two ways to work, same screen:

| | Normal mode | Pro mode |
| --- | --- | --- |
| Who owns the Claude Code session | The Node server (headless `claude`) | Your own terminal (`claude`, interactive) |
| Who decides permissions | The browser: pre-approved list, or approve in the chat | The terminal: its own prompts or auto mode |
| Browser is | The whole product | A face and chat UI for the terminal session |
| Audience | Anyone | You, with a terminal open in parallel |

## Principles

- **One interface, two backends.** The chat UI, the avatar and the tag protocol
  do not change between modes; only the session backend does.
- **Local only.** The server binds to 127.0.0.1 and rejects foreign WebSocket
  origins. It can run Claude Code, so it is never exposed to a network.
- **Never bypass permissions.** Work mode asks, or uses an explicit allow-list.
  No `--dangerously-skip-permissions`.
- **The creator is a dependency, not a fork.** `../anime-character-creator` is
  imported and never modified. Anything it lacks is requested there.
- **The avatar and the persona are provider-agnostic.** Plain-text tags, so an
  Ollama backend can use them unchanged.

## Where we are (done)

- Browser UI: chat, speech bubble, close-up / full-body toggle, "Reset look".
- `claude -p` headless session over stream-json, Haiku by default, chat only
  (`--tools ""`), persona appended to the system prompt, claude.ai connectors and
  user settings switched off to keep turns small.
- Avatar drawn by the creator through a Python worker. Emotions
  (`[emotion:x]`) pick pre-rendered frames; the browser flips frames to blink and
  move her mouth while text streams.
- Self-customisation: `[avatar key=value ...]` is parsed as it streams, validated
  and coerced in Python, applied and saved to `data/avatar.json`. Rejected keys are
  reported back to the model on its next turn.
- Provider interface (`src/providers/types.ts`), with Claude Code as the first
  implementation.

Not yet verified: the page in a real browser (the Chrome extension was not
connected when it was built). Phase 0 below covers this.

## Phases

> **Status 2026-10-10:** Phases 0, 1 and 2 are done (see the notes under each). Next: the
> Phase 3 spike, then Phase 5 (Ollama) and Phase 6 polish.

### Phase 0: confirm what exists (small) ✅ done

- Open the page, run a conversation, check animation timing, crop with hats and
  full body, reconnect after a server restart, two tabs at once.
- Tune `emotions.json` (brows are the weak lever; move lids and mouth).
- Fix whatever shows up. Add a start script that opens the browser and stops
  every child process on exit.

Done when: a ten-minute conversation, including two redesigns, works without
touching the terminal.

### Phase 1: session abstraction ✅ done

The provider interface only knows text deltas. Work mode needs more events, so
widen it before building on it.

- Events: `delta`, `done`, `error`, plus `tool_use` (name, short summary, result
  status) and `permission_request` (id, tool, input, reason).
- A `respondToPermission(id, allow | deny, remember?)` call.
- Session info exposed to the UI: session ID, model, working directory, mode.
- Keep `ClaudeCodeProvider` as the only implementation; add tests for the
  stream-json parsing with recorded sample output (the CLI format can change
  between versions).

Done when: existing chat behaviour is unchanged and tool events reach the browser
(shown as small status lines such as "running `npm test`...").

### Phase 2: Normal mode, work edition (browser owns the session) ✅ done

**What was built, and what the spike found.** `claude -p --permission-prompt-tool stdio` makes the
CLI emit `control_request` / `can_use_tool` lines on stdout (tool, exact input, suggested rules) and
wait for a `control_response` (`allow` with `updatedInput`, or `deny` with a message) on stdin. This
is the protocol the Agent SDK's `canUseTool` uses, so no extra MCP bridge was needed. A denial comes
back to the model as an error tool result, and it does not retry. "Allow for this session" echoes the
suggested rule back with `destination: "session"`, so nothing is written to the project's settings.
The wire format is not a documented API: `test/fixtures/claude-stream.jsonl` records it and
`test/claude-stream.test.ts` pins it. Decisions: work mode defaults to Sonnet, `AskUserQuestion` is
disabled (she asks in chat), `--setting-sources ""` keeps a folder's hooks from running, and the
server always starts in chat mode. Not yet done from the list below: a UI to edit the pre-approved
list (it lives in `data/settings.json`).


1. **Spike (first, half a day):** how `--permission-prompt-tool` works on the
   installed CLI version: the tool contract, the allow / deny response shape, and
   what it receives for each tool. Record sample exchanges. This decides the
   design below; if it does not fit, fall back to allow-lists only.
2. **Permission bridge:** a small stdio MCP server, launched with the session via
   `--mcp-config` and `--permission-prompt-tool`, that forwards each request to the
   Node server and waits for the browser's answer. Timeout means deny.
3. **UI:** a dialog in the chat, worded in character ("Can I run `npm test`?"),
   showing the exact command or file path and diff. Buttons: allow once, allow for
   this session, deny. No "always" in the first version.
4. **Pre-approved list:** `--allowedTools` with a conservative default (read-only
   tools and a few safe `Bash(...)` patterns), editable in a settings file the UI
   can show.
5. **Project folder:** the user picks the working directory (validated, must
   exist, shown prominently). Default stays the empty `workspace/` sandbox.
   `--add-dir` for extras.
6. **Chat vs work toggle:** chat mode keeps `--tools ""` (cheap, safe, Haiku).
   Work mode enables tools and offers a model choice, since Haiku may be too weak
   for real coding. Switching restarts the process and resumes the session.
7. **Show the session ID** in the UI with a copy button, so `claude --resume <id>`
   works from a terminal (one writer at a time).

Done when: from the browser you can ask her to fix a failing test in a chosen
folder, approve the commands she asks to run, and see the result, with no
terminal involved.

Risks: prompt injection (file contents or web pages steering the model) is the
reason permissions stay on and the dialog shows exact commands; Pro usage limits
(work mode uses far more than chat); the persona must not make her less careful
with tools.

### Phase 3: Pro mode, spike first (terminal owns the session)

The terminal session runs the tools and owns permissions (including auto mode).
The browser must be fed by it and, ideally, feed it. Two directions, two
questions:

**Out (session to browser)**, in order of preference:
1. **MCP tools** the session calls: `say`, `set_emotion`, `set_avatar`. Clean and
   structured, but the model must use them instead of plain replies.
2. **Hooks** (for example on stop) that forward the final reply to the server.
3. **Tailing the session transcript** on disk. Needs no setup, but is fragile and
   whole-message only.

**In (browser to session):**
1. A push mechanism for MCP servers into a running session ("channels"): does it
   exist in the installed version, and what does it allow?
2. Fallback: a blocking `wait_for_user_message` tool loop. Works but hacky
   (timeouts, context growth, no clean interrupt).
3. Fallback of the fallback: no input from the browser; you type in the terminal
   and she reacts in the browser. Still a good feature.

Spike deliverable: a one-page finding with a working prototype of the best
option, and a decision on what Pro mode can promise. Timebox: one day.

Done when: you can run `claude` in a terminal with the companion plugged in and
watch her speak, emote and change her look from that session.

### Phase 4: Pro mode, build

Depends on the spike. Likely scope: an `Attached` backend implementing the same
interface, a launcher (`npm run attach` printing the command or config to start
the terminal session with the right MCP config and persona), and a status
indicator in the UI showing which mode and session she is connected to.

### Phase 5: other providers

- Ollama provider for chat mode (streaming over its local HTTP API). Persona and
  tags carry over; tools do not, so work mode is unavailable there.
- Provider picker in the UI; capabilities reported by the provider (`canUseTools`,
  `streams`) so the UI hides what is unavailable.

### Phase 6: polish (any order, as wanted)

- Persist chat history across restarts.
- Voice: browser speech recognition in, a TTS service out, with mouth frames
  driven by the audio.
- Richer avatar: backgrounds and poses (the creator can pose arms), idle
  animation, a gallery of saved looks, undo for a redesign.
- Avatar renderer behind an interface so a VRM or Live2D renderer can replace the
  SVG frames, if desired.
- Run the creator in the browser via Pyodide (as its own web tool does) so the app
  needs no Python process, which also helps if it is ever hosted.

## Decisions made

| Decision | Choice | Why |
| --- | --- | --- |
| Brain | Headless `claude` CLI on the user's login | Uses the plan the user already pays for; tools come for free |
| Default model | Haiku | Cheap on Pro limits; fine for chat |
| Avatar engine | `anime-character-creator`, rendered by Python | Real vector character, already parametric, expressions built in |
| Expression protocol | Plain-text tags in the reply | Provider-agnostic, streams, easy to validate |
| Avatar animation | Pre-rendered frames flipped in the browser | Cheap, deterministic, no per-frame round trip |
| Server | Node + TypeScript, no build step | Node runs `.ts` directly |

## Open questions

1. **Terms of use:** is driving the `claude` CLI from a local app on a Pro plan
   fine for personal use, and where is the line if the project is shared? Check
   the current terms before publishing anything.
2. **Which permission mechanism** the CLI exposes for external approval (Phase 2
   spike).
3. **Which input path** exists for a terminal-owned session (Phase 3 spike).
4. **Haiku in work mode:** is it good enough, or does work mode need Sonnet by
   default?
5. **One session or many:** today there is one companion and one conversation,
   shared by every open tab. Is that the desired model?
6. **Sharing the project:** the creator is a path dependency
   (`../anime-character-creator`). Fine locally; vendoring or a Pyodide build
   would be needed for anyone else.

## Risks

- **CLI format drift:** the stream-json events are not a stable API. Mitigation:
  recorded fixtures and a version check at startup.
- **Usage limits:** work mode can burn a Pro window quickly. Mitigation: show
  usage from the rate-limit events the CLI already emits.
- **Prompt injection through tools:** mitigated by permissions, a visible working
  directory, exact commands in the approval dialog and no permission bypass.
- **Persona vs. tools:** a strong persona can crowd out the coding behaviour of
  Claude Code's own prompt. Test with a real task before calling work mode done.
- **Two writers on one session:** the terminal and the server must not both send
  messages. The UI should show who currently holds the session.

## Suggested order

Phase 0, then Phase 1, then the Phase 2 spike. If the spike works, finish
Phase 2; run the Phase 3 spike next, and only then decide how much of Pro mode to
build. Phases 5 and 6 can be picked up whenever there is time.

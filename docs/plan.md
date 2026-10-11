# Plan: Cursor, Composer and Grok as a brain

Written 2026-10-11. Replaces the 2026-10-10 roadmap. Phases 0–5 of that file are
shipped (chat, work mode, permissions, Ollama, and the polish in the README).
This file is only the next brain.

**Status 2026-10-11:** implemented. Cursor is a brain via `cursor-agent acp`
(not the SDK). Chat is Ask mode, work mode uses the approval card, and Run
Everything is `--force`. Auto-review is not wired through ACP in the installed
CLI, so Auto and Accept edits stay Claude-only.

## Goal

Pick **Cursor** in the Brain menu and talk to her through a local Cursor agent,
on **Composer** or **Grok** (or any other model the account's catalog lists).
The face, the tags, the chat log and the page stay as they are. Claude Code and
Ollama stay.

## What Cursor actually is here

One provider, not three. Composer and Grok are model ids inside Cursor. The
TypeScript SDK (`@cursor/sdk`) runs the same agent loop the IDE uses:

- **Local** means the loop and the files stay on this machine (`local: { cwd }`).
  The model call still goes to Cursor. This is a third privacy story, next to
  "Claude sees the conversation" and "Ollama never leaves the machine".
- Auth is a user API key (`CURSOR_API_KEY`) or `Cursor.auth.login()` (a browser
  login that mints one). The SDK does not pick up a desktop Cursor login by
  itself. The key stays in the server process. The page never sees it.
- Model ids come from `Cursor.models.list()` for that key. `composer-2.5` is the
  current Composer id (`composer-2` is rerouted to it). Grok's id is whatever
  the catalog returns for the account; hard-coding one will go stale.
- Node 22.13 or newer. This repo already requires 22.18. Import `@cursor/sdk`
  directly. The app has no build step, so the bundled single-file entry is the
  wrong one.

Cloud agents (a Cursor VM, a cloned repo, a PR) are out of scope. So is calling
xAI's API directly: Grok arrives as a Cursor model, or not at all.

## What already fits the provider interface

`Provider` in `src/providers/types.ts` is enough. A `CursorProvider` maps:

| Companion | SDK |
| --- | --- |
| `send` + `delta` | `agent.send`, `onDelta` `text-delta` (the tag parser already strips `[emotion]` / `[avatar]` / `[image]` from streamed text) |
| attached pictures | `send({ text, images: [{ data, mimeType }] })` |
| tool status lines | `tool_call` events (`running` / `completed` / `error`) |
| stop button, Ctrl+C | `run.cancel()` |
| session id, survive a restart | `agent.agentId`, `Agent.resume` |
| fresh conversation | dispose and `Agent.create` again |
| chat mode, no tools | `tools: []` |
| plan mode | `mode: "plan"` then `mode: "agent"` |
| token counts | `usage` events and `result.usage` |
| images she shows, `!command`, Markdown, voice, looks | already in the server and the page; they do not care which brain spoke |

Chat mode is the same shape as Ollama: a system prompt, streamed text, tags,
no tools. Work mode is where it stops fitting.

## The gap: she must still ask

Two different Cursor surfaces get confused here.

**`@cursor/sdk` does not ask.** A local SDK agent runs shell, edit and write
with no approval callback. `local.autoReview` lets the classifier allow or
deny, and a denial is not raised to the user. Hooks are files on disk, with
no programmatic callback. That path cannot drive the approval card.

**The Cursor agent can.** That is the agent in the IDE and in `cursor-agent`,
not the SDK. `cursor-agent acp` speaks the Agent Client Protocol on stdin /
stdout, the same shape as Claude's `--permission-prompt-tool stdio`:

1. `initialize`, then `authenticate` (`cursor_login`, or a key already set).
2. `session/new` with the project folder as `cwd`. Modes are `agent`, `plan`
   and `ask` (read-only).
3. `session/prompt` sends the user message. `session/update` streams text
   chunks and tool calls.
4. Before a tool runs, the process sends `session/request_permission` and
   **waits**. The request carries the tool call, including its raw input, and
   options whose kinds are allow-once, allow-always and reject-once. The
   client answers on stdin. No answer means the tool does not run.
5. `session/cancel` stops the turn. `session/load` resumes one.

Allow once / Allow for this session / Deny already match those three kinds.
`cursor-agent --auto-review` is the IDE's Auto-review (safe calls run, the
rest prompt). `--force` (alias `--yolo`) is **Run Everything**: every tool
runs, and an explicit deny rule still blocks. It is a permission choice, not
the default.

On this machine `agent` on `PATH` is the Grok CLI. The Cursor binary is
`cursor-agent`. Spawn that one.

`systemPrompt` is a second spike, smaller. On the SDK it **replaces** Cursor's
coding prompt (local agents only, not kept across `Agent.resume`, and some
accounts cannot set it — the first `send` then fails and names
`--system-prompt`). Tool schemas still load. Chat wants the replacement:
`persona.md` is the whole prompt, same as Ollama. ACP's `session/new` has no
system-prompt field in the public schema, so the spike has to find where the
persona goes (a Cursor extension field, a rule, or the SDK for chat only).
Work mode needs a real task afterwards, because a replaced prompt can forget
how to use tools.

`settingSources` stays empty, the way Claude runs with `--setting-sources ""`.
A folder's hooks, rules and MCP servers stay unloaded unless we later add an
explicit opt-in, off at every start, matching **Use my Claude Code setup**.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Shape | One `cursor` provider, model picked from the catalog | Composer and Grok are models, not backends |
| Runtime | Local agent only | Files stay here; cloud agents are a different product |
| First slice | Chat, `tools: []`, persona as `systemPrompt` | No permission hole, tags already work |
| Work mode | `cursor-agent acp`, permission requests answered by the existing card | Same pause as the IDE agent. The SDK's unattended tools stay unused |
| Run Everything | Cursor-only menu entry, off at every start, spawned with `--force` | The IDE mode: no card unless Cursor still asks. Deny rules still apply |
| Defaults | Composer for both modes when it is in the catalog; otherwise the first listed model | Grok is offered when the catalog has it, not required |
| Key | `CURSOR_API_KEY` in the environment | Same pattern as not storing Claude credentials |
| Isolation | `settingSources` unset, no hooks written anywhere | A companion session must not arm the user's Cursor |
| Claude-only commands | Stay honest | `/compact`, `/effort`, `/setup`, `/rc`, `/rewind` keep saying they need Claude Code |

## Phases

### 1. Spike (first, before any UI)

A short script, not wired to the server. Timebox: half a day.

1. Log in, call `Cursor.models.list()`, write down the Composer and Grok ids
   this account actually has, plus any params (Composer has `fast`).
2. One local agent, `tools: []`, `systemPrompt` set to the persona. Send a
   sentence. Confirm text deltas, an `[emotion:…]` tag, and that a follow-up
   remembers the first turn.
3. Send one image. Cancel a run mid-reply.
4. Resume the same `agentId` in a second process.
5. Work probe: spawn `cursor-agent acp` against a throwaway folder, ask for a
   one-line edit and for `echo hi`, and confirm `session/request_permission`
   arrives with the raw command or diff and does not run until the client
   answers. Record the option ids Cursor actually sends (allow-once,
   allow-always, reject-once). Repeat with `--force` and confirm the edit and
   `echo hi` run with no card, and that a denied command (a `permissions.deny`
   rule) still does not run. Note any call that still asks under Run Everything
   (file deletion, a write outside the folder, the browser).
6. Find where the persona goes. Try an ACP extension field if one is
   advertised, and try the SDK `systemPrompt` for a tools-off chat. Note
   whether this account allows `systemPrompt`.

Done when: a page of findings with one real permission round-trip, and a
decision on where `persona.md` is injected.

### 2. Chat brain

- `src/providers/cursor.ts` implementing `Provider`. `canUseTools` is false
  while work mode is not allowed. `send` streams deltas and always `wait()`s.
  Dispose the agent on `close`.
- Startup error in the chat if the key is missing or the catalog call fails,
  with the dashboard place to make a key. No key field in the page.
- Brain menu gains Cursor. A model menu lists `displayName` from the catalog
  (Composer, Grok, the rest). Switching brains starts a fresh conversation,
  as Ollama already does.
- Persist provider, model id and `agentId` the way Claude persists a session
  id, so a restart resumes.
- Usage line: model name, and tokens when a run reports them. Session and week
  limits stay Claude-only (they are Claude Code's). `/cost` can show tokens
  for this brain once `usage` is filled; dollar figures only if `getUsage()`
  actually returns them.
- `/model` sets a catalog id. An unknown id is refused with the list.
- Tests: map a recorded `text-delta` / `tool_call` / `usage` sequence onto
  `ProviderEvent`s. The live SDK stays out of CI (it needs a key and network).

Done when: with a key in the environment, Brain → Cursor, a conversation shows
emotion tags on her face, a picture attaches, Stop cuts the reply, and a
server restart continues the same agent.

### 3. Work mode

Spawn `cursor-agent acp` with the project folder as `cwd`. Map
`session/request_permission` onto the existing `permission` event, and
`respondPermission` onto the JSON-RPC result:

| Card | ACP outcome |
| --- | --- |
| Allow once | `allow-once` |
| Allow for this session | `allow-always` |
| Deny | `reject-once` |

The card shows `rawInput` (the command or the write) and any diff in the tool
call content. Pre-approved reads (`Read`, `Grep`, `Glob`) match today's
allow-list, answered inside the provider without a card when Cursor offers
that. `plan` mode is Plan. `--auto-review` is Auto, and a call it still
escalates uses the same card. Accept-edits ships when the CLI exposes that
mode on this session. `session/cancel` is the stop button.

**Run Everything** is a fifth Permissions entry, shown only while the brain is
Cursor. Choosing it restarts the ACP process with `--force` and reloads the
session, the way a Claude permission change takes effect immediately. The
label in the menu says that tools run without a card. It is not saved: every
server start comes back to Ask, same as the other permission modes. Claude's
menu does not gain this entry. Auto stays the classifier. `/permissions
everything` selects it.

A `session/request_permission` that still arrives in this mode (Cursor does
this for some deletions, for writes outside the workspace, and for the
browser) is shown on the same card. Deny rules from the CLI config still win,
because `--force` means "allow unless explicitly denied". Home and `/` stay
refused as a folder.

The SDK stays out of work mode. `--force` is used only for this menu choice,
never as the way the process is started.

- `cwd` is the project folder. Home and `/` stay refused.
- Project MCP and hooks stay unloaded unless we later add an explicit opt-in,
  off at every start, matching **Use my Claude Code setup**.
- `!command` already runs in the server for any work-mode brain. Leave it.
- `/resume` uses `session/load` for this folder's Cursor sessions, not Claude
  session files.
- The footer session line shows the ACP session id. It is not a `claude --resume` command.

Done when: in a chosen folder she can change a file and run a command under the
rule the spike picked, the page says which rule that is, and opening an
unfamiliar folder runs none of that folder's Cursor hooks.

## Out of scope

- Cloud agents, PRs, the Cloud Agents REST API.
- A direct Grok or xAI chat provider.
- Replacing Claude Code, or teaching Ollama tools.
- VRM, Live2D, Pyodide, and a UI for the pre-approved tool list. Those stayed
  open at the end of the old plan and are still not this work.

## Risks

- **Account flag.** `systemPrompt` can be disabled. Chat then has no persona.
  The spike finds out before the menu item exists.
- **Catalog drift.** Model ids and params change. The menu reads the catalog
  at startup; CI never asserts a particular Grok id.
- **Prompt vs tools.** Replacing the system prompt can make work mode worse at
  coding. Phase 3 includes one real edit, not only a stream test.
- **Unattended tools.** The SDK and `cursor-agent -p` skip the card with no
  switch to turn them back on. Work mode goes through ACP. `--force` is only
  Run Everything, chosen in the menu, and a request Cursor still sends is
  still shown.
- **Wrong binary.** `agent` on this machine is the Grok CLI. The provider
  spawns `cursor-agent`.
- **Cost.** Composer and Grok bill the Cursor plan, the same pool as the IDE.
  The usage line has to show something, even if it is only tokens.
- **SDK churn.** Stream shapes and tool args are explicitly unstable. Pin the
  mapping behind one module and a fixture test, the way `claude-stream.ts` does.

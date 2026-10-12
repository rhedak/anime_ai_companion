---
description: The four brains she can run on (Claude Code, Cursor, opencode, Ollama), what each can do, and how to switch.
---

# Brains

The brain is the model that answers you. Pick it from the **Brain** menu under the message box, or start with
`COMPANION_PROVIDER`. Switching brains starts a new conversation, because they do not share memory. The same
persona and the same tags drive her face whichever brain you choose.

| | Claude Code | Cursor | opencode | Ollama |
| --- | --- | --- | --- | --- |
| Where the model runs | Anthropic | Cursor | whatever your opencode uses | your own machine |
| Chat | yes | yes (read-only) | yes (no tools) | yes |
| [Work mode](work-mode.html) | yes | yes | yes | no |
| Approval modes | Ask, Plan, Accept edits, Auto | Ask, Plan, Run everything | Ask, Plan, Run everything | none |
| Sign in once with | `claude` | `cursor-agent login` | `opencode auth login` | nothing |

## Claude Code

The default. A long-lived `claude -p` process on your machine, using your own login. Chat uses a small, quick model
(`COMPANION_MODEL`, default `haiku`) and work mode a stronger one (`COMPANION_WORK_MODEL`, default `sonnet`). Work
mode counts against your plan limits faster than chatting does. The bar in work mode shows
`claude --resume <session id>`, so you can continue the same conversation in a terminal; only one side should write
at a time.

## Cursor

Pick **Cursor** and she is driven by `cursor-agent` (Composer, Grok, or any model your account lists). Sign in once
with `cursor-agent login`, or set `CURSOR_API_KEY`. The conversation goes to Cursor; files stay on this machine.
Chat mode is read-only. Work mode asks with the same approval card as Claude, and the permissions menu adds **Run
everything** (`cursor-agent --force`): tools run without a card, a deny rule still blocks, and the choice resets to
Ask every time the server starts. Auto and Accept edits stay Claude Code modes.

## opencode

Pick **opencode** and she is driven by `opencode acp`, signed into whichever models your opencode install already
knows (choose one in the menu, or leave opencode's default). Sign in once with `opencode auth login`. Chat mode has
no tools: opencode is told to ask about every tool, and the app refuses each request without showing a card. Work
mode asks with the approval card. The menu offers **Ask**, **Plan** and **Run everything**, which lets every tool
run without a card and resets to Ask at every start. Every start is isolated: your project's own `opencode.json`,
plugins and MCP servers stay unloaded.

## Ollama

Pick **Ollama (local)** and she is powered by a model on your own machine: nothing leaves it at all. Install
[Ollama](https://ollama.com), run `ollama pull llama3.2` (or any chat model), and choose the model in the menu.
Small models follow the tag protocol less reliably, so her expressions may be less consistent. Ollama is chat only:
there are no tools, so work mode is unavailable.

## Using your Claude account

This project runs **on your own computer, with your own unmodified `claude` and your own login**. Please keep it
that way: do not host it as a service for other people, and do not build anything that collects, stores or relays
Claude credentials. Anthropic's terms do not allow routing other people's requests through a subscription (see the
[Claude Code legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance)). Plan limits
assume ordinary individual use, and a companion who chats all day uses them up faster than you might expect. If you
prefer an API key, Claude Code supports `ANTHROPIC_API_KEY`.

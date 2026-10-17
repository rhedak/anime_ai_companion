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
| [Work mode](work-mode.html) | yes | yes | yes | experimental, only for models that report tool support |
| Approval modes | Ask, Plan, Accept edits, Auto | Ask, Plan, Run everything | Ask, Plan, Run everything | Ask, Plan |
| Sign in once with | `claude` | `cursor-agent login` | `opencode auth login` | nothing |

## With no brain installed

If none of the brains is installed, she does not fail at your first message: she runs a small built-in script (the same one the
[browser demo](demo/) uses) and says so when you open the page. It can change her hair, eyes and clothes, become one of the starting
characters, show a mood, wave and run through her animations (`/show`), but it cannot hold a conversation or use work mode. Her first message
tells you how to get a real brain; [opencode](https://opencode.ai) is the easiest, free and without an account
(`npm install -g opencode-ai`, then restart the app). Installing one is enough: choose it in the **Brain** menu or restart, and the next
conversation is a real one. On a first start the app uses whichever brain it finds, in the order Claude Code, opencode, Cursor, a running
Ollama; a brain you chose yourself that has gone missing is not swapped for another one.

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
Small models follow the tag protocol less reliably, so her expressions may be less consistent. Chat never uses tools.

You can also start with it: `COMPANION_PROVIDER=ollama npm start` uses the first model you have installed, and
`COMPANION_PROVIDER=ollama OLLAMA_MODEL=llama3.2 npm start` names one.

**Use a model of about 3B or bigger** (`llama3.2`, `qwen2.5:3b` or `qwen2.5:7b`, for example). A very small one such as `qwen2.5:0.5b` chats,
but it does not reliably write her `[emotion:...]` and `[avatar ...]` tags: her face then stays flat, and asking her to change her hair or her
clothes does nothing, however it is worded.

**Work mode with a local model is experimental, and the quality is your responsibility.** If Ollama reports that the
model supports tool calls (a recent Qwen or Llama, for example; `ollama show <model>` lists its capabilities), the **Work** button
works with it. She can then read files, search, run a command, create a file and edit one in your project folder. How well a local model
uses tools depends entirely on the model and its size: small or older ones call tools badly (wrong arguments, loops, or text
that only looks like a tool call), and any model can propose a wrong or harmful command or edit with full confidence. Every
command, file write and edit waits for your approval and shows exactly what it will do, so reading the card is your job;
there is no mode that skips it for Ollama (only **Ask** and **Plan**, and Plan offers reading and searching only). Reading and
searching inside the project are pre-approved, like for the other brains. Nothing outside the project folder can be read or
written through her tools, but an approved `bash` command can do anything your user can. The app does not test, rate or vouch
for any local model: work done through one is at your own risk, so keep the project under git and check the result. She stops
after 12 tool steps in a row. Ollama's default context window is small, so tool work asks for 16384 tokens (change it with
`COMPANION_OLLAMA_CTX`); a big model with a big window needs the memory for it. If your Ollama is too old to report capabilities
and the model is not a known family, vouch for it with `COMPANION_OLLAMA_TOOLS=<model name>` (or `all`).

## Using your Claude account

This project runs **on your own computer, with your own unmodified `claude` and your own login**. Please keep it
that way: do not host it as a service for other people, and do not build anything that collects, stores or relays
Claude credentials. Anthropic's terms do not allow routing other people's requests through a subscription (see the
[Claude Code legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance)). Plan limits
assume ordinary individual use, and a companion who chats all day uses them up faster than you might expect. If you
prefer an API key, Claude Code supports `ANTHROPIC_API_KEY`.

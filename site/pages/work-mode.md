---
description: Let her read and edit files and run commands in a project folder, with an approval card for everything that is not pre-approved.
---

# Work mode

Flip the **Work** switch, pick a project folder, and she can read and edit files and run commands there, like a
regular Claude Code session. She asks first.

![An approval card showing the exact change](assets/work.png)

## Approvals

Every action that is not pre-approved shows an **approval card** with the exact command or file change. Choose
*Allow once*, *Allow for this session*, or *Deny*; a denial is not retried. `Read`, `Grep` and `Glob` are
pre-approved (change that in `data/settings.json`).

The **Permissions** menu changes how approvals work. It resets to *Ask* every time the server starts, and can be
changed at any time, even while a card is waiting.

| Mode | What it does | Brains |
| --- | --- | --- |
| **Ask** | every action that is not pre-approved shows a card (the default) | all with tools |
| **Plan** | she reads and proposes a plan; nothing changes until you approve it | all with tools |
| **Accept edits** | file edits no longer ask; commands still do | Claude Code |
| **Auto** | Claude Code's own classifier approves routine actions and blocks risky ones | Claude Code |
| **Everything** | every tool runs without a card, and she keeps going until done | Cursor, opencode |

Approval cards also offer *Allow, and accept all edits* (for file edits) and *Allow, and switch to Auto*, like the
terminal's "yes, and don't ask again".

## Choosing the folder

**Work here** applies the folder you typed. Once she already works in that folder, the same button reads **Choose
folder…** and opens your system's folder dialog (macOS, or Linux with `zenity` or `kdialog`; elsewhere type the
path). The home folder and `/` cannot be chosen. On a phone the folder bar starts folded away to save room, and the
**−** and **+** buttons fold and unfold it on any screen.

`anaico` starts in work mode for the folder you ran it from. A server that is already running keeps its mode and
folder.

## Your own Claude Code setup

By default your own Claude Code setup is **not** loaded: a folder's `.claude/settings*.json` hooks and allow rules,
your user settings and your MCP servers do not apply, so opening an unfamiliar folder runs nothing of its own. The
**Use my Claude Code setup** checkbox, or `/setup on`, loads them as in a terminal. Hooks run commands, so it is off
at every start.

### Skills

Skills are not loaded by default either, so she cannot call one by name and would have to read its file by hand. The
**Use my skills** checkbox, or `/skills on`, lets her use your own skills (`~/.claude/skills`) by name. It loads your
user settings, including any permission rules in them, but keeps hooks off. A folder's own skills stay off: those only
load with the whole setup above. It is off at every start.

When she reaches for one of your skills while they are off, she asks before anything is turned on. A folder that has its
own skills says so once.

## Shell commands

A message starting with `!` runs in the project folder at once, without a card, because you typed it yourself. See
[Chatting with her](chatting.html#shell-commands-with).

## From the terminal

The bar under the header shows `claude --resume <session id>` with a copy button, so you can carry on the same
conversation in a terminal. Only one side should write at a time.

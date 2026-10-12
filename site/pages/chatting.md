---
description: Voice, pictures, shell commands, the usage line, effort, long conversations and stopping her.
---

# Chatting with her

## Moods and gestures

She starts each reply with a mood, and the face follows: neutral, happy, sad, angry, surprised, shy or thinking.
She blinks every few seconds and her mouth moves while she talks. She can also wave or cheer. Type `/show` and
she plays every emotion, a blink, talking and both gestures, one second each, naming each one, without calling the
model. Asking her "show me all your animations" does the same.

## Voice

The **Voice** button makes her read her replies aloud with your browser's own speech synthesis: local voices,
nothing uploaded. She speaks sentence by sentence while the reply streams, and her mouth moves with the speech.
Speech *recognition* is deliberately left out: Chrome's version sends your audio to Google, which would break the
"stays on your machine" promise.

## Pictures

The **+** button next to the message box attaches up to five pictures (PNG, JPEG, GIF or WebP, up to 5 MB each).
You can also paste an image or drop files on the chat. The browser shrinks anything larger than 1568 px on its
long edge first, and the server checks the type, the contents and the sizes again. A picture without text works
too. With Ollama you need a vision model such as `llava`.

She can show pictures too. When she makes or finds an image in your project folder, an `[image path]` tag puts
small thumbnails under her message, and clicking one opens a viewer. Only real PNG, JPEG, GIF and WebP files up to
10 MB inside the project folder are shown, at most eight per reply.

## Shell commands with `!`

In [work mode](work-mode.html), a message that starts with `!` runs in your project folder straight away, like
Claude Code's bash mode: `!ls`, `!git status`. The output appears in the chat and goes to her with your next
message. There is no approval card, because you typed the command yourself, so the box turns amber while the line
starts with `!`. Commands stop after two minutes and their output is cut at 100 KB. Chat mode refuses them, and so
does a phone.

## Stopping her

**Ctrl+C**, or the round stop button that replaces Send while she works, stops her reply or a running `!command`.
What she had said stays in the conversation, and she carries on with your next message. With text selected,
Ctrl+C still copies. On a Mac use the Control key, not Cmd.

## How her replies are shown

Replies render a small, safe Markdown subset: paragraphs, headings, bold, italic, code, code blocks, lists, quotes
and http(s) links. It is built from plain page elements, never HTML, so nothing she writes can inject markup.
`/copy` and `/export` keep the Markdown source.

## The usage line

Under the message box a small line shows the model and its effort, your Claude **session** (five-hour) and **week**
usage with their reset times, and **ctx**, how full her memory of this conversation is. Numbers turn amber above 80%
and red above 95%. The limits come from Claude Code after each reply, so they are dimmed when older than ten
minutes. The **▾** in front folds the line away to a small "Usage" (with a warning mark if a limit is nearly used),
and the browser remembers the choice.

## Effort

The **Effort** menu, or `/effort low|medium|high|xhigh|max|default`, sets how hard Claude thinks: more is slower and
uses more of your limits. For *Default* the app reads the effort level from your own `~/.claude/settings.json`,
so she thinks as hard as your terminal does. Changing it restarts her process and the conversation carries on.

## Long conversations

Claude Code compacts the conversation by itself when the context gets big. The app asks for that at **200k
tokens**, not near the model's whole 1M window, because a conversation that grows to several hundred thousand
tokens makes every later message expensive. Change it with `COMPANION_AUTOCOMPACT` (100000 to 1000000, or `auto`).
`/compact` does it on demand.

Claude keeps the conversation in a prompt cache that lives about an hour. If you come back after that to a
conversation of 100k tokens or more, the next message would have to send all of it again at full price. So that
message waits and a card asks what to do:

- **Summarise, then send** runs `/compact` first, then sends your message. Every message after that is cheap, and
  the summary loses some detail.
- **Send as it is** pays the full read once and keeps every detail.
- **Don't send** puts your text back in the box.

## Her name

Click her name at the top, or use `/rename Hana`. Names are 1 to 24 letters, numbers, spaces and `. ' - _`, so a
name cannot carry instructions into her prompt. She is told about the change right away.

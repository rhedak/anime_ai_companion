@AGENTS.md

`AGENTS.md` above has everything shared: how to run it, how to customise it, and the rules for changing it.
If a `CLAUDE.local.md` exists, it describes this particular machine and wins where it differs from this file.

## Working on this with Claude Code

- **Running it for the user is normal.** If they ask you to start or try the app, do it with `npm start` or
  `anaico`; `data/` is theirs and is meant to be used. The exception is when `CLAUDE.local.md` says the
  checkout is their live app: then verify your own changes in a scratch copy instead (see the end of the
  Checks section in `AGENTS.md`).
- **No Python is needed** to run the app or `npm test`: the creator's TypeScript (`../anime-character-creator/ts/src`, or `CREATOR_SRC`) draws her
  in a worker thread. Without that folder the avatar, render and server tests skip.
- **The app starts its own `claude` processes** (`claude -p`, on the user's plan). Tests must never start a
  real one: test the stream parsing against recorded output (`test/claude-stream.test.ts`,
  `test/fixtures/`). For a manual check, a stand-in `claude` script on the `PATH` is enough.
- **Work mode may be pointed at this very repo.** If the app is running with its project folder set here,
  another agent could be editing files while you are. Look at `git status` before assuming a change is yours.
- **Tell the user what a restart costs.** After edits to `persona.md`, `emotions.json` or the creator, the
  server must restart, and an existing Claude conversation keeps its old persona until `/clear`.
- **Long chats use the plan fast.** If the user asks why a message used so much, the answer is on the documentation site
  ("Long conversations" on the chatting page, `site/pages/chatting.md`) and in the Claude Code notes of `AGENTS.md`.
- **When a change touches one provider,** say what Claude Code, Cursor and Ollama each do now; they differ in
  permission modes, system prompts and model ids.
- Never add `--dangerously-skip-permissions`, a loose default permission mode, or anything that serves
  other people or handles Claude credentials (see Safety in `AGENTS.md` and "Using it with your Claude
  account" in the README).

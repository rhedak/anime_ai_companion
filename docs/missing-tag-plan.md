# Plan: when a small model does not write the tag

Status: a plan, nothing built. Written 2026-10-27 after reading how Hob (FrigadeHQ/hob, `app/src/main/agent/claims.ts`) catches a model that says it did something it did not.

## The problem

Everything she does on the page is a tag in her reply: `[activity tennis]`, `[avatar hair_color=#ff88cc]`, `[outfit …]`. A small model (Ollama, and opencode's free models) often answers "Yes! Tennis sounds so fun!" and writes no tag, so nothing changes. The user sees a friendly reply and an unchanged picture. Claude Code does this rarely. Today the only answer is the line "A small model may not write the tags" in the README and the release notes, and the tags' notes: `notes.push("Your avatar tag had problems: …")` reaches her only on the next message, and only when she wrote a tag at all.

## What Hob does, and what is different here

Hob checks the reply after the fact (it names a chart or a renamed file, but no tool ran), then sends the model one note "from Hob, not from the user" and runs the turn again. That costs a whole extra model turn. Here a retry would also cost plan messages on Claude Code, so the check is limited to the brains that need it (below).

## Two ways, and which to build first

**A. Do it ourselves when the request is clear (no extra model turn).** The user asked for something the app can recognise, and the reply has no tag for it: the server applies the change itself.
- *Looks*: the built-in reader (`public/script.js`, `reply()`) already turns "make your hair mint green and put on glasses" into `[avatar …]` tags, and `findAvatarTags`, `applyAvatar` already apply them. For a chat message to a weak brain, run the reader on the user's text; if it produces `[avatar …]` and her reply has none, apply the reader's tags (and the "new look" line shows as always). She is told on her next message through the usual `notes`, so she knows it happened.
- *Activities*: a small pattern ("let's play tennis", "go swimming", "dance for me", "stop"), checked against the activities the active pack has (`packActivityNames`), then `deps.activity(name, false)` exactly as the tag would. Nothing is invented: only a name the pack has.
- Cost: none beyond the match. Risk: a wrong match, so the rules are explicit requests only (imperative or "let's … <activity>"), and nothing when her reply says no ("I can't", "not now").

**B. Ask her once more (a retry).** For a clear request with no tag, send one note ("[Note from the app, not from the user: …]") and let her answer again. Costs a model turn and shows a second reply, so it is the fallback for what A cannot recognise (an outfit change in free words), and only for brains that need it.

Build A first. B only if A leaves a real gap.

## Where it goes

- `src/turn-service.ts`, in the `done` event of a chat-mode turn (`makeTagApplier` already knows what tags the reply had: `activityDone`, avatar tags, outfit).
- The matching rules in one small module (`src/intent.ts`) with the reader import, so they are tested apart from the server.
- Chat mode only, as every tag is. Never in work mode.
- Brains: Ollama and opencode (`provider.name`), not Claude Code or Cursor. A setting is not needed; if a Claude user reports the same gap, widen it.
- Never when a card or a scene (`/play`) is active, never twice for one message, and `/clear` and the stop button still win.

## Tests

- Stand-in replies (`test/server.test.ts` helpers): a request with no tag changes the look or starts the activity; the same request with the tag changes it once, not twice; a refusal in her reply changes nothing; Claude Code and work mode are untouched.
- Unit tests for the patterns, including near-misses ("I played tennis yesterday", "swimming is fun").

## Open questions

- Should she be told on her next message, or silently? Told: it keeps her story consistent ("I changed your hair").
- Does the page need to say that the app, not she, made the change? Probably a plain line, like the existing "new look" line.
- Same treatment for `[outfit …]`? Only with a clear "put on her <outfit>" pattern; probably not in the first version.

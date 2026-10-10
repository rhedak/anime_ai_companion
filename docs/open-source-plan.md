# Plan: publishing as open source

Written 2026-10-10. Target: `git@github.com:rhedak/anime_ai_companion.git`.
Product roadmap lives in [plan.md](plan.md); this file is only about getting the
project public in good shape.

## Goal

Completely free to use, copy and customise, with a friendly, **non-binding**
request: if you improve this repo or your checkout of `../anime-character-creator`,
please share it back as a pull request.

## The licensing decision

**MIT, with no extra conditions.** A "you must share your changes" clause would be
a different licence (copyleft or a custom one), would not be open source by the
usual definition, and could not be enforced on a local tool anyway. The request is
therefore carried by *culture*, not by terms:

| Mechanism | Where | Nature |
| --- | --- | --- |
| A short, warm request | README and `CONTRIBUTING.md` | Words only |
| Easy to do | Small PRs welcome, PR template, "good first" labels | Lowers friction |
| A gentle nudge | Startup message when either checkout has local changes that are not on a remote | Console only, one time, silenced with `COMPANION_NO_NUDGE=1`; never blocks, never phones home |
| Credit | README, UI footer link | Honours the creator's request to link back |

The nudge is deliberately dumb and local: it runs `git status` and
`git rev-list @{u}..HEAD` in this repo and in the creator checkout and prints a line
such as: *"You have local changes in anime-character-creator. If they are useful to
others, a pull request would be very welcome."* No network access, no telemetry, no
data leaves the machine.

Suggested follow-up in the **creator** repo (the owner's call, not done here): the
same `CONTRIBUTING.md` wording, so the request reads the same in both places.

## Anthropic terms (checked 2026-10-10)

Source: the Claude Code "Legal and compliance" page. Conclusions that shape the
repo:

- Each user runs the app **locally with their own unmodified `claude` binary and
  their own login**. That is explicitly allowed.
- The project must never collect, store or relay credentials or tokens, never offer
  "log in with Claude", and must not be hosted as a service that runs on someone's
  plan for other people. The README says so.
- No Claude or Anthropic names or logos in the product name or branding, no implied
  endorsement. The README says "not affiliated with Anthropic".
- Plan limits assume ordinary individual use; the README mentions it.
- `ANTHROPIC_API_KEY` works with the CLI and is the documented alternative.

## Work items

1. **`LICENSE`:** MIT, "Copyright (c) 2026 Henrik Hanssen", same as the creator.
2. **`.gitignore`:** add `data/` (the user's own avatar), keep `workspace/*`.
3. **`package.json`:** `engines.node >= 22.18` (runs `.ts` natively), `license`,
   `repository`, `homepage`, `bugs`, `keywords`.
4. **README rewrite:**
   - What it is, in three sentences, and the architecture diagram.
   - Requirements: Node 22.18+, Python 3.11+, `claude` installed and logged in, and
     a checkout of `anime-character-creator` next to this repo (or `CREATOR_SRC`).
   - Quick start (clone both, `npm install`, `npm start`).
   - Configuration table.
   - **Using it with your Claude account:** local only, bring your own login, not
     affiliated, usage limits, API-key alternative, do not host for others.
   - **Contributing, the friendly version**, and credits (creator, `ws`).
5. **`CONTRIBUTING.md`:** the request, how to run checks, how to open a PR, what
   makes a good small PR, a note that nothing is required of anyone.
6. **`.github/`:** pull request template (what/why/how tested), two issue templates
   (bug, idea), and a CI workflow.
7. **Tests and CI:**
   - `npm test` with `node:test`: avatar tag parsing, and a smoke test of
     `python/render_worker.py` against the creator (skipped with a clear message if
     the creator is not found).
   - CI on push and pull request: check out this repo and
     `rhedak/anime-character-creator`, set up Node and Python, run
     `npm ci`, `npm run typecheck`, `npm test`.
8. **UI credit:** a small footer link to the creator project and this repo.
9. **Share nudge:** `src/share-nudge.ts`, called once at startup, as above.
10. **Git:** `git init -b main`, first commit(s), add the `origin` remote. **No push**
    until the owner says so.

## Owner's checklist (manual, on GitHub)

- Decide which **commit email** to publish. The local git identity is a personal
  address; GitHub offers a private `...@users.noreply.github.com` address
  (Settings, Emails) if that is preferred. Commits made so far can be re-authored
  before the first push.
- Repository settings: description, topics (`anime`, `ai-companion`, `claude-code`,
  `svg`, `llm`), enable Issues, optionally Discussions.
- Branch protection on `main` requiring CI, optional.
- Review the first commit once before pushing.
- Push: `git push -u origin main`.

## Acceptance

- A stranger can clone both repos, follow the README and have a working companion
  without reading any other file.
- `npm test` and CI pass on a clean checkout.
- No secrets, personal paths or personal avatar data in the tree or the history.
- The README states the licence, the Anthropic-terms position, the credits and the
  friendly request, in that order of prominence, and none of it blocks use.

## Out of scope

Hosting a public instance (not allowed by the terms above), a CLA, any enforcement
mechanism, any telemetry.

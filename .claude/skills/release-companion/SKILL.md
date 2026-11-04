---
name: release-companion
description: Prepare and ship a release of the companion app (anime_ai_companion), including the picture packs that go with it. Use when the owner says to prepare, cut or publish a release or a new version, or to publish packs. Covers the bump, the pins, check.sh, the pack publish order, the worktree merge, the tag, the draft release and its notes.
---

# Releasing the companion

`AGENTS.md` ("Branches and releases", "Checks") is the rule book; this is the sequence that worked for 0.13.0 to 0.15.0, with the traps. The owner says "prepare" (everything local, nothing outward) or "go" (the outward steps). Never push `main`, a tag, or run **Publish pack** without that go, and report after each outward step.

## 1. Prepare (local, on `dev` in `../anime_ai_companion-dev`)

1. Everything pushed first (`git push origin dev`) when asked; the bump commit is the last one. Before the bump, compare `git log --oneline origin/dev..dev` and `git log --oneline dev..origin/dev`: a pull request merged on GitHub can exist only on `origin/dev` (0.22.0: PR #33 did). Merge it into `dev` and rerun the checks, because the release merge takes what is on `origin/dev`.
   The check script refuses a dirty tree, so commit the bump before running `check.sh`.
2. **Version.** A minor for a feature (a new command, activity, pack support), a patch for fixes and docs only. Edit `package.json` (`version` **and** `installerVersion`, equal when installers are built), `app/package.json`, run `npm install --package-lock-only`, and edit `app/package-lock.json` lines 3 and 9 by hand (`sed -i '' '3s/OLD/NEW/;9s/OLD/NEW/'`; npm does not touch that file). Commit `Version X.Y.Z`.
3. **Pins.**
   - opencode: `gh release view v<pin> -R anomalyco/opencode`, newest tags (`gh release list`), and compare each asset's size and digest (`gh api repos/anomalyco/opencode/releases/tags/v<pin> --jq '.assets[] | "\(.name) \(.size) \(.digest)"'`) with `OPENCODE_PIN` in `src/install-opencode.ts`.
   - Creator: `git -C ../anime-character-creator fetch --tags; git tag --sort=-v:refname | head`. A new creator tag means: `package.json` `creator.ref`, the three clone commands (`README.md`, `AGENTS.md`, `site/pages/getting-started.md`, `sed 's/--branch vOLD/--branch vNEW/'`), then re-record the fixture with `CREATOR_SRC=../anime-character-creator/ts/src node scripts/refresh-render-ops-fixture.ts` and read its diff (a new body or hairstyle is expected, anything else is a finding). The creator checkout must be at the pinned tag for `check.sh`.
4. **`./check.sh --full`** in the background (it takes minutes; it fails on a dirty tree or a creator not at the pin). Read the result file, not just the exit code. **One flake is known:** `avatar-service` "a render that never ends is cut off at the timeout" on Node 22.18 under load. Run that file alone on 22.18 (`npx --yes node@22.18 --test test/avatar-service.test.ts`); if it passes, run `--full` again; a second failure is real. In 0.22.0 the full run failed on `npm test` once, the rerun of `npm test` alone passed (669 of 669), and the second full run passed. The cause of the first failure was never found: when `npm test` fails, save its whole output (the summary alone does not name the test), so the failing test can be read.
5. **Release notes** in the scratchpad, from the last release's notes: what is new (user words, not commit subjects), fixed, "Tested" (say what was and was not run: installers are built by the workflow and not run; faked network), "Still true" (known limits: small models may not write tags, no signing). The download table lists the five installer names with the new version. Thank the tester when a report led to a change.

## 2. Packs that ship with it (only on go)

Activity and outfit packs are published from `../anime_ai_companion-packs`, and the app's character files already point at them, so **packs go out before the app release**, never after.

1. Push the bump commit to `dev` (the packs workflows need it). Set `COMPANION_REF` in `.github/workflows/publish.yml` and `frames.yml` to that full commit sha, commit and push `main` of the packs repo.
2. Publish **one pack at a time** (they share one Pages deploy). Higher version than the live index entry (`site/index.json`, or `curl https://rhedak.github.io/anime_ai_companion-packs/index.json`); a republish of a changed pack needs a new version so installed copies are offered the update. Run each explicitly:
   `gh workflow run publish.yml -f pack_id=ID -f version=N`, then `sleep 8`, take the id with `gh run list --workflow=publish.yml --limit 1 --json databaseId`, `gh run watch ID --exit-status`, `gh run view ID --json conclusion`, `git pull` for the bot's commit. **Do not write this as a shell loop with `set -- $spec`** (zsh dropped the version, the dispatch failed with HTTP 422, and the loop read the previous run's "success"): a dispatch that prints an HTTP error did nothing.
3. Failures seen: a `publish.json` description over **400 characters** fails the index step after the archive is built (no release or tag is left; shorten, push, rerun); the archive tool refuses `activity-*` files if `COMPANION_REF` is older than activity support.
4. Verify in the live index (`frameCount`, archive size) before moving on.

## 3. The release (only on go)

Never merge on the owner's checkout (`../anime_ai_companion` is their live app on `main`). Use a temporary worktree:

```bash
git fetch -q origin --tags
git worktree add -q ../anime_ai_companion-release-tmp -b release-tmp origin/main
cd ../anime_ai_companion-release-tmp
git merge --no-ff -q origin/dev -m "Merge dev into main for X.Y.Z: <short list>"
git diff --stat origin/dev          # must be empty
git tag -a vX.Y.Z -m "X.Y.Z"        # annotated; a docs-only release uses "[docs-only] ..."
git push origin release-tmp:main vX.Y.Z   # main and the tag together
```

Then wait for the **Release** workflow (`gh run list`, find its id, watch the Monitor tool on `gh run view ID --json status`): every installer file and `SHA256SUMS` (0.22.0 had seven installer files: Windows `.exe`, Linux AppImage x64 and arm64, macOS `.dmg` and `.zip` for x64 and arm64), and also the CI and Documentation site runs for `main`.

**Traps seen in 0.22.0:**
- The macOS build can be cancelled before any runner starts (no steps, no runner name). Check https://www.githubstatus.com first. Rerun only the failed job with `gh run rerun ID -R rhedak/anime_ai_companion --failed`. The checksum job stays skipped until every build passes, and the run is marked failed in the meantime.
- A draft can hold only some installers. Do not publish it until every installer and `SHA256SUMS` are attached: `gh release view vX.Y.Z -R rhedak/anime_ai_companion --json assets`.
- Monitor watches expire (5 to 30 minutes). A run that is still going when one expires needs a new watch; the run's status, not the expiry notice, says what happened.

Publish the draft:

```bash
gh release edit vX.Y.Z -R rhedak/anime_ai_companion --title "X.Y.Z" --notes-file <notes> --draft=false --latest
gh release list -R rhedak/anime_ai_companion --limit 2 --json tagName,isLatest,isDraft
git worktree remove ../anime_ai_companion-release-tmp && git branch -D release-tmp
```

Say what happens to the owner's checkout: it stays on the old `main` until they pull. The merge commit exists only on `main`; the next release's merge picks it up.

## Things not to do

- Do not skip `--full` because a smaller run passed; do not release over a failure.
- Do not re-tag or move a pushed tag. Do not delete a published release without being asked.
- Do not announce the site pages (`picture-packs.html#activities`, etc.) as live before the Pages run succeeds.

## Packs waiting for the next release

Check this at each release; do not carry over a list. As of 2026-11-05 none are waiting: every pack's latest source commit is older than its last `Publish <id> version N` commit on the packs repo's `main`, and the bundled `franzi-dress` activity was in 0.21.1.

To check, for each id in the live index (`curl -s https://rhedak.github.io/anime_ai_companion-packs/index.json`):

```bash
cd ../anime_ai_companion-packs
pub=$(git log -1 --format='%ct' --grep="^Publish $id version" main)
src=$(git log -1 --format='%ct' -- packs-src/$id ref/$id)
[ "$src" -gt "$pub" ] && echo "$id: source changed after its publish"
```

Also check that no feature branch in the packs repo has commits not in `main` (`git rev-list --count main..<branch>`). A pack that does need publishing goes through section 2, with a version higher than its live entry.


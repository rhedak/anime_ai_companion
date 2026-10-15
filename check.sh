#!/usr/bin/env bash
# Runs on this machine what CI runs (.github/workflows/ci.yml), so a push is only made once everything that can be tested locally passed.
#
#   ./check.sh                 what CI's "check" job does: lockfile, typecheck, npm test
#   ./check.sh --full          also the checks a release needs: the oldest Node, the docs site and the staged demo (pages.yml)
#   ./check.sh --allow-dirty   skip the "what is tested is what is committed" guard (never used by the push hook)
#   ./check.sh --install-hook  make git run this before every push (core.hooksPath=.githooks)
#
# Escape hatches (environment): CHECK_ALLOW_CREATOR_DRIFT=1 (creator not at the pinned tag), CHECK_ALLOW_SKIPS=1 (tests may skip).
# `git push --no-verify` skips the hook; then CI is the only net.
set -euo pipefail
cd "$(dirname "$0")"

full=0 dirty_ok=0
for arg in "$@"; do
  case "$arg" in
    --full) full=1 ;;
    --allow-dirty) dirty_ok=1 ;;
    --install-hook)
      git config core.hooksPath .githooks
      echo "Installed: git now runs .githooks/pre-push (this setting is shared by every worktree of this repository)."
      exit 0 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

die() { echo "check.sh: $*" >&2; exit 1; }

# --- Preconditions: the same inputs CI has -----------------------------------------------------------------------------------------

# CI tests the pushed commit. Uncommitted or untracked files would make this run test something else.
if [ "$dirty_ok" = 0 ]; then
  git diff --quiet HEAD -- || die "tracked files have uncommitted changes (CI would test the commit, not these). Commit, or use --allow-dirty."
  untracked=$(git ls-files --others --exclude-standard | grep -v '^node_modules$' || true)
  [ -z "$untracked" ] || die "untracked files (a test may pass only because of them):
$untracked
Commit or remove them, or use --allow-dirty."
fi

# CI checks out the creator at the tag pinned in package.json, not whatever its main holds.
pin=$(node -p "require('./package.json').creator.ref")
creator_src=${CREATOR_SRC:-../anime-character-creator/src}
creator_root=$(dirname "$creator_src")
[ -d "$creator_src" ] || die "the creator is not at $creator_src: the renderer and server tests would skip. Clone it next to this repo at $pin."
if [ "${CHECK_ALLOW_CREATOR_DRIFT:-0}" != 1 ]; then
  at=$(git -C "$creator_root" describe --tags --exact-match HEAD 2>/dev/null || echo "no tag")
  [ "$at" = "$pin" ] || die "the creator at $creator_root is at '$at', CI uses $pin. Check out $pin (git -C $creator_root checkout $pin) or set CHECK_ALLOW_CREATOR_DRIFT=1."
  [ -z "$(git -C "$creator_root" status --porcelain)" ] || die "the creator checkout at $creator_root has local changes; CI would not have them."
fi

# The renderer tests need Python 3.11+, from python3 or from .venv (uv sync).
if [ ! -d .venv ] && ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null; then
  die "python3 is older than 3.11 and there is no .venv: run 'uv sync' once."
fi

echo "node $(node -v), $(python3 --version), creator $pin, commit $(git rev-parse --short HEAD)"

# --- Steps -------------------------------------------------------------------------------------------------------------------------

passed=() failed=()
step() {
  local name=$1; shift
  printf '\n==> %s\n' "$name"
  if "$@"; then passed+=("$name"); else failed+=("$name"); fi
}

# Runs a test command quietly; shows what failed. Skipped tests count as a failure: a skip means something was not tested.
run_tests() {
  local log rc=0 skipped
  log=$(mktemp)
  "$@" >"$log" 2>&1 || rc=$?
  grep -E '^# (tests|pass|fail|cancelled|skipped) ' "$log" | tr '\n' ' '; echo
  if [ "$rc" != 0 ]; then
    grep -E -A12 '^ *not ok ' "$log" | head -80 || true
    echo "(full output: $log)"
    return 1
  fi
  skipped=$(sed -n 's/^# skipped \([0-9]*\)$/\1/p' "$log")
  if [ "${skipped:-0}" != 0 ] && [ "${CHECK_ALLOW_SKIPS:-0}" != 1 ]; then
    echo "$skipped test(s) skipped (a missing creator or Python?). Set CHECK_ALLOW_SKIPS=1 to accept."
    grep -E '^ *ok .*# SKIP' "$log" | head -10 || true
    return 1
  fi
  rm -f "$log"
}

# The same command as CI: a lockfile npm would rewrite makes a fresh clone look modified.
lockfile() { npm install --package-lock-only --ignore-scripts >/dev/null && git diff --exit-code package-lock.json; }

stage_demo() { local dir; dir=$(mktemp -d) && CREATOR_SRC="$PWD/$creator_src" node demo/stage.mjs --out "$dir" >/dev/null; }

step "lockfile in step with package.json" lockfile
step "typecheck" npm run --silent typecheck
step "npm test" run_tests npm test --silent

if [ "$full" = 1 ]; then
  # Needs the network the first time (npx fetches that Node).
  step "tests on the oldest Node (22.18)" run_tests npx --yes node@22.18 --test "test/**/*.test.ts"
  step "docs site builds" npm run --silent site
  step "demo stages" stage_demo
fi

# --- Verdict -----------------------------------------------------------------------------------------------------------------------

printf '\n'
for n in "${passed[@]:-}"; do [ -z "$n" ] || echo "  ok    $n"; done
for n in "${failed[@]:-}"; do [ -z "$n" ] || echo "  FAIL  $n"; done
if [ "${#failed[@]}" -gt 0 ]; then
  echo "check.sh: ${#failed[@]} check(s) failed. Do not push."
  exit 1
fi
echo "check.sh: all checks passed$([ "$full" = 1 ] || echo ' (add --full before a release)')."

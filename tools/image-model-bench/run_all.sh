#!/usr/bin/env bash
# Runs the benchmark for each model in turn, one process at a time, so only one model is ever in memory.
# Usage: ./run_all.sh zimage-turbo [other-model ...]
# Each model: generate (bench.py run) in its own process, exit, then score (score.py) with DINOv2 only.
set -euo pipefail
cd "$(dirname "$0")"

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <model> [<model> ...]" >&2
  exit 2
fi

for model in "$@"; do
  echo "== $model: plan"
  python3 bench.py plan --model "$model"

  if pgrep -f "bench.py run" >/dev/null; then
    echo "another bench.py run is still going; stop it first" >&2
    exit 1
  fi

  echo "== $model: generate"
  run_dir=$(python3 bench.py run --model "$model" | tee /dev/stderr | awk '/^done: /{print $2}')

  # bench.py has exited, so its model is out of memory before scoring starts.
  if pgrep -f "bench.py run" >/dev/null; then
    echo "bench.py still running after generation; not scoring" >&2
    exit 1
  fi

  echo "== $model: score ($run_dir)"
  python3 score.py "$run_dir"
done

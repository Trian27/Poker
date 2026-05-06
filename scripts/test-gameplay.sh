#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-pr}"
PYTHON_BIN="${PYTHON_BIN:-$HOME/.virtualenvs/poker/bin/python}"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Expected Python interpreter not found: $PYTHON_BIN" >&2
  exit 1
fi

run_gameimplementation() {
  echo "==> GameImplementation build"
  (cd "$ROOT_DIR/GameImplementation" && npm run build)

  echo "==> GameImplementation full Jest"
  (cd "$ROOT_DIR/GameImplementation" && npm test -- --runInBand)

  echo "==> GameImplementation gameplay suite"
  (cd "$ROOT_DIR/GameImplementation" && npm run test:gameplay)

  if [[ "$MODE" != "pr" ]]; then
    echo "==> GameImplementation chaos suite"
    (cd "$ROOT_DIR/GameImplementation" && npm run test:chaos)
  fi
}

run_poker_api() {
  echo "==> poker-api gameplay pytest suite"
  (
    cd "$ROOT_DIR/poker-api"
    "$PYTHON_BIN" -m pytest -m gameplay tests/gameplay/test_tables_gameplay.py -q
  )
}

run_poker_ui() {
  echo "==> poker-ui build"
  (cd "$ROOT_DIR/poker-ui" && npm run build)

  echo "==> poker-ui component tests"
  (cd "$ROOT_DIR/poker-ui" && npm test)

  echo "==> poker-ui gameplay smoke"
  (cd "$ROOT_DIR/poker-ui" && npm run test:e2e:gameplay)
}

case "$MODE" in
  pr|full)
    run_gameimplementation
    run_poker_api
    run_poker_ui
    ;;
  *)
    echo "Usage: $0 [pr|full]" >&2
    exit 1
    ;;
esac

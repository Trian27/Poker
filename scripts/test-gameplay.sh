#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-pr}"
shift || true
EXTRA_ARGS=("$@")
PYTHON_BIN="${PYTHON_BIN:-$HOME/.virtualenvs/poker/bin/python}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-poker-gameplay-e2e}"
POSTGRES_HOST_PORT="${POSTGRES_HOST_PORT:-15432}"
REDIS_HOST_PORT="${REDIS_HOST_PORT:-16379}"
AUTH_API_HOST_PORT="${AUTH_API_HOST_PORT:-18000}"
GAME_SERVER_HOST_PORT="${GAME_SERVER_HOST_PORT:-18001}"
REACT_UI_HOST_PORT="${REACT_UI_HOST_PORT:-18002}"
AGENT_API_HOST_PORT="${AGENT_API_HOST_PORT:-18003}"
ENABLE_TEST_FIXTURE_API="${ENABLE_TEST_FIXTURE_API:-true}"
ENV_MODE="${ENV_MODE:-dev}"
ADMIN_USERNAME="${ADMIN_USERNAME:-e2e_admin}"
ADMIN_EMAIL="${ADMIN_EMAIL:-e2e-admin@example.test}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-E2EAdminPass123!}"
ADMIN_RESET_PASSWORD="${ADMIN_RESET_PASSWORD:-true}"
ARTIFACT_DIR=""
COMPOSE_SERVICES=()
COMPOSE_ACTIVE=0

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Could not find PYTHON_BIN: $PYTHON_BIN" >&2
  echo "Expected local default: ~/.virtualenvs/poker/bin/python" >&2
  echo "Set PYTHON_BIN=python or run the documented bootstrap command." >&2
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

compose_cmd() {
  docker compose -p "$COMPOSE_PROJECT_NAME" "$@"
}

wait_for_url() {
  local label="$1"
  local url="$2"
  local attempts="${3:-60}"
  local delay_seconds="${4:-2}"
  local i
  for ((i = 1; i <= attempts; i++)); do
    if curl -fsS "$url" > /dev/null 2>&1; then
      echo "==> $label reachable: $url"
      return 0
    fi
    sleep "$delay_seconds"
  done
  echo "Timed out waiting for $label at $url" >&2
  return 1
}

cleanup_compose() {
  local exit_code="$?"
  trap - EXIT INT TERM

  if [[ "$COMPOSE_ACTIVE" == "1" ]]; then
    mkdir -p "$ARTIFACT_DIR"
    compose_cmd ps > "$ARTIFACT_DIR/compose-ps.txt" 2>&1 || true
    compose_cmd logs --no-color "${COMPOSE_SERVICES[@]}" > "$ARTIFACT_DIR/compose.log" 2>&1 || true
    compose_cmd down -v --remove-orphans > "$ARTIFACT_DIR/compose-down.log" 2>&1 || true
  fi

  exit "$exit_code"
}

run_compose_mode() {
  local gameplay_mode="$1"
  local service_log_dir="$2"
  shift 2
  COMPOSE_SERVICES=("$@")
  COMPOSE_ACTIVE=1

  local timestamp
  timestamp="$(date +%Y%m%d-%H%M%S)"
  ARTIFACT_DIR="$ROOT_DIR/logs/$service_log_dir/$timestamp"
  mkdir -p "$ARTIFACT_DIR"

  trap cleanup_compose EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  export COMPOSE_PROJECT_NAME
  export POSTGRES_HOST_PORT
  export REDIS_HOST_PORT
  export AUTH_API_HOST_PORT
  export GAME_SERVER_HOST_PORT
  export REACT_UI_HOST_PORT
  export AGENT_API_HOST_PORT
  export ENABLE_TEST_FIXTURE_API
  export ENV_MODE
  export ADMIN_USERNAME
  export ADMIN_EMAIL
  export ADMIN_PASSWORD
  export ADMIN_RESET_PASSWORD

  echo "==> Compose project: $COMPOSE_PROJECT_NAME"
  echo "==> Artifact dir: $ARTIFACT_DIR"
  echo "==> Resetting isolated compose project"
  compose_cmd down -v --remove-orphans > "$ARTIFACT_DIR/compose-preclean.log" 2>&1 || true

  echo "==> Starting services: ${COMPOSE_SERVICES[*]}"
  compose_cmd up -d --build "${COMPOSE_SERVICES[@]}"

  wait_for_url "auth-api" "http://localhost:${AUTH_API_HOST_PORT}/health"
  wait_for_url "game-server" "http://localhost:${GAME_SERVER_HOST_PORT}/health"
  if [[ "$gameplay_mode" == "human-vs-bot" ]]; then
    wait_for_url "react-ui" "http://localhost:${REACT_UI_HOST_PORT}"
  fi

  echo "==> Running autonomous gameplay driver"
  local driver_log="$ARTIFACT_DIR/driver.log"
  "$PYTHON_BIN" "$ROOT_DIR/scripts/test_autonomous_bot_gameplay.py" \
    --mode "$gameplay_mode" \
    --auth-api-url "http://localhost:${AUTH_API_HOST_PORT}" \
    --game-server-url "http://localhost:${GAME_SERVER_HOST_PORT}" \
    --ui-url "http://localhost:${REACT_UI_HOST_PORT}" \
    --admin-username "$ADMIN_USERNAME" \
    --admin-password "$ADMIN_PASSWORD" \
    --artifact-dir "$ARTIFACT_DIR" \
    "${EXTRA_ARGS[@]}" 2>&1 | tee "$driver_log"
}

case "$MODE" in
  pr|full)
    run_gameimplementation
    run_poker_api
    run_poker_ui
    ;;
  compose-autonomous)
    run_compose_mode "bot-vs-bot" "compose-autonomous" postgres-db redis-cache auth-api game-server
    ;;
  compose-human-vs-bot)
    run_compose_mode "human-vs-bot" "compose-human-vs-bot" postgres-db redis-cache auth-api game-server react-ui
    ;;
  *)
    echo "Usage: $0 [pr|full|compose-autonomous|compose-human-vs-bot] [driver args...]" >&2
    exit 1
    ;;
esac

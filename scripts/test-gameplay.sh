#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/python-env.sh"
MODE="${1:-pr}"
shift || true
EXTRA_ARGS=("$@")
PYTHON_BIN="${PYTHON_BIN:-$(resolve_repo_python_bin "$ROOT_DIR")}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-poker-gameplay-e2e}"
POSTGRES_HOST_PORT="${POSTGRES_HOST_PORT:-15432}"
REDIS_HOST_PORT="${REDIS_HOST_PORT:-16379}"
AUTH_API_HOST_PORT="${AUTH_API_HOST_PORT:-18000}"
GAME_SERVER_HOST_PORT="${GAME_SERVER_HOST_PORT:-18001}"
REACT_UI_HOST_PORT="${REACT_UI_HOST_PORT:-18002}"
AGENT_API_HOST_PORT="${AGENT_API_HOST_PORT:-18003}"
ENABLE_TEST_FIXTURE_API="${ENABLE_TEST_FIXTURE_API:-true}"
ENV_MODE="${ENV_MODE:-dev}"
G5_ADVISOR_ENABLED="${G5_ADVISOR_ENABLED:-true}"
ADMIN_USERNAME="${ADMIN_USERNAME:-e2e_admin}"
ADMIN_EMAIL="${ADMIN_EMAIL:-e2e-admin@example.test}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-E2EAdminPass123!}"
ADMIN_RESET_PASSWORD="${ADMIN_RESET_PASSWORD:-true}"
ARTIFACT_DIR=""
COMPOSE_SERVICES=()
COMPOSE_ACTIVE=0

resolve_python_bin() {
  if [[ -x "$PYTHON_BIN" ]]; then
    return 0
  fi
  if command -v "$PYTHON_BIN" > /dev/null 2>&1; then
    PYTHON_BIN="$(command -v "$PYTHON_BIN")"
    return 0
  fi
  if [[ "$PYTHON_BIN" == "python" ]] && command -v python3 > /dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3)"
    return 0
  fi

  echo "Could not find PYTHON_BIN: $PYTHON_BIN" >&2
  echo "Expected configured interpreter from .env or local default: ~/.virtualenvs/poker/bin/python" >&2
  echo "Set PYTHON_BIN or PYTHON_VENV in .env, or export PYTHON_BIN explicitly." >&2
  exit 1
}

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
  resolve_python_bin
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
  local teardown_exit_code=0
  trap - EXIT INT TERM

  if [[ "$COMPOSE_ACTIVE" == "1" ]]; then
    mkdir -p "$ARTIFACT_DIR"
    compose_cmd config > "$ARTIFACT_DIR/compose-config.yaml" 2>&1 || true
    compose_cmd ps > "$ARTIFACT_DIR/compose-ps.txt" 2>&1 || true
    compose_cmd logs --no-color "${COMPOSE_SERVICES[@]}" > "$ARTIFACT_DIR/compose.log" 2>&1 || true
    if compose_cmd down -v --remove-orphans > "$ARTIFACT_DIR/compose-down.log" 2>&1; then
      printf 'compose_teardown_succeeded=true\n' > "$ARTIFACT_DIR/compose-teardown-status.txt"
    else
      teardown_exit_code="$?"
      printf 'compose_teardown_succeeded=false\n' > "$ARTIFACT_DIR/compose-teardown-status.txt"
    fi
  fi

  if [[ "$teardown_exit_code" -ne 0 && "$exit_code" -eq 0 ]]; then
    exit_code="$teardown_exit_code"
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
  export G5_ADVISOR_ENABLED
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

  resolve_python_bin
  echo "==> Running autonomous gameplay driver"
  local driver_log="$ARTIFACT_DIR/driver.log"
  if ((${#EXTRA_ARGS[@]} > 0)); then
    "$PYTHON_BIN" "$ROOT_DIR/scripts/test_autonomous_bot_gameplay.py" \
      --mode "$gameplay_mode" \
      --auth-api-url "http://localhost:${AUTH_API_HOST_PORT}" \
      --game-server-url "http://localhost:${GAME_SERVER_HOST_PORT}" \
      --ui-url "http://localhost:${REACT_UI_HOST_PORT}" \
      --admin-username "$ADMIN_USERNAME" \
      --admin-password "$ADMIN_PASSWORD" \
      --artifact-dir "$ARTIFACT_DIR" \
      "${EXTRA_ARGS[@]}" 2>&1 | tee "$driver_log"
  else
    "$PYTHON_BIN" "$ROOT_DIR/scripts/test_autonomous_bot_gameplay.py" \
      --mode "$gameplay_mode" \
      --auth-api-url "http://localhost:${AUTH_API_HOST_PORT}" \
      --game-server-url "http://localhost:${GAME_SERVER_HOST_PORT}" \
      --ui-url "http://localhost:${REACT_UI_HOST_PORT}" \
      --admin-username "$ADMIN_USERNAME" \
      --admin-password "$ADMIN_PASSWORD" \
      --artifact-dir "$ARTIFACT_DIR" 2>&1 | tee "$driver_log"
  fi
}

run_compose_browser_suite() {
  local service_log_dir="$1"
  local npm_script="$2"
  local full_stack_mode="$3"
  COMPOSE_SERVICES=(postgres-db redis-cache auth-api game-server react-ui)
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
  export G5_ADVISOR_ENABLED
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
  wait_for_url "react-ui" "http://localhost:${REACT_UI_HOST_PORT}"

  echo "==> Running browser full-stack gameplay E2E"
  local browser_log="$ARTIFACT_DIR/browser-e2e.log"
  (
    cd "$ROOT_DIR/poker-ui"
    # PR smoke and queue shadow modes intentionally target a single spec via the npm script.
    PLAYWRIGHT_FULL_STACK=1 \
    PLAYWRIGHT_FULL_STACK_MODE="$full_stack_mode" \
    PLAYWRIGHT_SKIP_WEB_SERVER=1 \
    PLAYWRIGHT_BASE_URL="http://localhost:${REACT_UI_HOST_PORT}" \
    PLAYWRIGHT_AUTH_API_URL="http://localhost:${AUTH_API_HOST_PORT}" \
    PLAYWRIGHT_GAME_SERVER_URL="http://localhost:${GAME_SERVER_HOST_PORT}" \
    PLAYWRIGHT_ARTIFACT_DIR="$ARTIFACT_DIR" \
    PLAYWRIGHT_REPORT_DIR="$ARTIFACT_DIR/playwright-report" \
    PLAYWRIGHT_OUTPUT_DIR="$ARTIFACT_DIR/test-results" \
    ADMIN_USERNAME="$ADMIN_USERNAME" \
    ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    npm run "$npm_script"
  ) 2>&1 | tee "$browser_log"
}

case "$MODE" in
  pr|full)
    run_gameimplementation
    run_poker_api
    run_poker_ui
    ;;
  compose-autonomous)
    G5_ADVISOR_ENABLED=false run_compose_mode "bot-vs-bot" "compose-autonomous" postgres-db redis-cache auth-api game-server
    ;;
  compose-human-vs-bot)
    G5_ADVISOR_ENABLED=false run_compose_mode "human-vs-bot" "compose-human-vs-bot" postgres-db redis-cache auth-api game-server react-ui
    ;;
  compose-browser-pr-smoke)
    G5_ADVISOR_ENABLED=false run_compose_browser_suite "compose-browser-pr-smoke" "test:e2e:gameplay:full-stack:smoke" "compose-browser-pr-smoke"
    ;;
  compose-browser-queue-pr)
    G5_ADVISOR_ENABLED=false run_compose_browser_suite "compose-browser-queue-pr" "test:e2e:gameplay:full-stack:queue" "compose-browser-queue-pr"
    ;;
  compose-browser-e2e)
    G5_ADVISOR_ENABLED=false run_compose_browser_suite "compose-browser-e2e" "test:e2e:gameplay:full-stack" "compose-browser-e2e"
    ;;
  *)
    echo "Usage: $0 [pr|full|compose-autonomous|compose-human-vs-bot|compose-browser-pr-smoke|compose-browser-queue-pr|compose-browser-e2e] [driver args...]" >&2
    exit 1
    ;;
esac

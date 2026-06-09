#!/usr/bin/env bash

set -euo pipefail

COMPOSE_FILE_PATH="${1:-docker-compose.beta.yml}"
OUTPUT_DIR="${2:-backups/postgres}"
COMPOSE_ENV_FILE="${3:-${COMPOSE_ENV_FILE:-}}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_PATH="${OUTPUT_DIR}/poker_db_${TIMESTAMP}.sql.gz"

if [[ -z "${COMPOSE_ENV_FILE}" && "${COMPOSE_FILE_PATH}" == "docker-compose.beta.yml" && -f "deploy/beta/.env.beta" ]]; then
  COMPOSE_ENV_FILE="deploy/beta/.env.beta"
fi

mkdir -p "${OUTPUT_DIR}"

compose_args=()
if [[ -n "${COMPOSE_ENV_FILE}" ]]; then
  compose_args+=(--env-file "${COMPOSE_ENV_FILE}")
fi
compose_args+=(-f "${COMPOSE_FILE_PATH}")

docker compose "${compose_args[@]}" exec -T postgres-db \
  pg_dump -U poker_user -d poker_db | gzip > "${OUTPUT_PATH}"

echo "Wrote ${OUTPUT_PATH}"

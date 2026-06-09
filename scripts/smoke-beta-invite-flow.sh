#!/usr/bin/env bash

set -euo pipefail

COMPOSE_FILE_PATH="${COMPOSE_FILE_PATH:-docker-compose.yml}"
UI_BASE_URL="${UI_BASE_URL:-http://localhost:5173}"
API_BASE_URL="${API_BASE_URL:-http://localhost:8000}"
ADMIN_USERNAME="${BETA_SMOKE_ADMIN_USERNAME:-beta_smoke_admin}"
ADMIN_EMAIL="${BETA_SMOKE_ADMIN_EMAIL:-beta-smoke-admin@example.com}"
ADMIN_PASSWORD="${BETA_SMOKE_ADMIN_PASSWORD:-BetaSmokeAdmin123!}"
RUN_ID="$(date -u +%Y%m%d%H%M%S)"
INVITE_EMAIL="beta-smoke-${RUN_ID}@example.com"
INVITE_USERNAME="betasmoke${RUN_ID}"
INVITE_PASSWORD="${BETA_SMOKE_INVITE_PASSWORD:-BetaSmokeUser123!}"

docker compose -f "${COMPOSE_FILE_PATH}" exec -T auth-api python - <<PY
from app.database import SessionLocal
from app.models import User
from app.auth import get_password_hash
import logging

db = SessionLocal()
try:
    logging.getLogger("sqlalchemy.engine").setLevel(logging.ERROR)
    username = "${ADMIN_USERNAME}"
    email = "${ADMIN_EMAIL}"
    password = "${ADMIN_PASSWORD}"
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        user = db.query(User).filter(User.email == email).first()
    if user is None:
        user = User(
            username=username,
            email=email,
            hashed_password=get_password_hash(password),
            is_admin=True,
            is_active=True,
            email_verified=True,
        )
        db.add(user)
    else:
        user.username = username
        user.email = email
        user.hashed_password = get_password_hash(password)
        user.is_admin = True
        user.is_active = True
        user.email_verified = True
    db.commit()
finally:
    db.close()
PY
ADMIN_TOKEN="$(docker compose -f "${COMPOSE_FILE_PATH}" exec -T auth-api python - <<PY | sed -n 's/^ADMIN_TOKEN:://p' | tail -n 1
from app.database import SessionLocal
from app.models import User
from app.main import _issue_access_token_for_user
import logging

logging.getLogger("sqlalchemy.engine").setLevel(logging.ERROR)
db = SessionLocal()
try:
    user = db.query(User).filter(User.username == "${ADMIN_USERNAME}").first()
    if user is None:
        raise RuntimeError("Smoke admin user missing after bootstrap")
    print(f"ADMIN_TOKEN::{_issue_access_token_for_user(user)}")
finally:
    db.close()
PY
)"

INVITE_JSON="$(curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Origin: ${UI_BASE_URL}" \
  -H "X-Dormstacks-UI: web" \
  "${API_BASE_URL}/api/admin/beta-invites" \
  -d "{\"email\":\"${INVITE_EMAIL}\",\"notes\":\"beta smoke ${RUN_ID}\"}")"

INVITE_URL="$(printf '%s' "${INVITE_JSON}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["invite_url"])')"

node scripts/run-beta-invite-browser-smoke.cjs \
  "${UI_BASE_URL}" \
  "${INVITE_URL}" \
  "${INVITE_EMAIL}" \
  "${INVITE_USERNAME}" \
  "${INVITE_PASSWORD}"

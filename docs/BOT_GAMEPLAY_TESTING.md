# Autonomous Bot Gameplay Testing

This guide covers the compose-backed backend/runtime gameplay E2E flow.

## What This Validates
- admin login against the real `auth-api`
- fixture provisioning through `POST /api/admin/test-fixtures/gameplay-stack`
- real `game-server` websocket gameplay via `WebSocketPokerAgent`
- persisted hand history for both seated participants
- ordinary admin invisibility to test-run league/community/table/hand data
- spectator websocket denial for ordinary admin access
- runtime purge and fixture cleanup via `DELETE /api/admin/test-fixtures/runs/{run_tag}`

## Provisioning Model
This flow no longer creates leagues, communities, or tables through ordinary product APIs.

It uses the dedicated fixture API only.

That is intentional:
- normal product semantics stay clean
- test users remain run-scoped
- cleanup is deterministic
- compose-backed E2E does not contaminate normal dev data

## Local Python Environment
Local execution should go through the `poker` virtualenv.

Bootstrap once:

```bash
~/.virtualenvs/poker/bin/python -m pip install \
  -r poker-api/requirements.txt \
  -r poker-api/requirements-dev.txt \
  -r poker-agent-api/requirements.txt
```

If you keep a different interpreter, set `PYTHON_BIN=python` explicitly when invoking the shell runner.

## Main Entry Points
### Automated compose-backed backend/runtime E2E
Run from repo root:

```bash
./scripts/test-gameplay.sh compose-autonomous
```

What it does:
- starts an isolated compose project on alternate host ports
- enables the fixture API in `auth-api`
- boots `postgres-db`, `redis-cache`, `auth-api`, and `game-server`
- provisions a same-run test league/community/table/users
- runs two autonomous bots against the real game server
- waits for a common persisted hand
- validates ordinary-admin outsider denial
- cleans up the run and tears the compose project down

Artifacts are written under:
- `logs/compose-autonomous/<timestamp>/`

### Manual human-vs-bot compose mode
Run:

```bash
./scripts/test-gameplay.sh compose-human-vs-bot --human-timeout-seconds 900
```

What it does:
- starts the same isolated compose project shape, plus `react-ui`
- provisions a fixture table with two same-run users
- starts one autonomous bot
- writes human credentials to:
  - `.tmp/human-fixtures/<run_tag>/human_credentials.txt`
- prints only the credentials file path and the URLs you need
- waits for one real completed hand, then runs the same persistence and outsider assertions
- always attempts cleanup on success, timeout, or `Ctrl-C`

The credentials file is intentionally kept outside uploaded artifact directories.

## Direct Driver Usage Against an Already-Running Stack
You can still run the gameplay driver directly if you already have services running.

Automated bot-vs-bot example:

```bash
~/.virtualenvs/poker/bin/python scripts/test_autonomous_bot_gameplay.py \
  --mode bot-vs-bot \
  --auth-api-url http://localhost:8000 \
  --game-server-url http://localhost:3000 \
  --ui-url http://localhost:5173 \
  --admin-username e2e_admin \
  --admin-password E2EAdminPass123!
```

Human-vs-bot example:

```bash
~/.virtualenvs/poker/bin/python scripts/test_autonomous_bot_gameplay.py \
  --mode human-vs-bot \
  --auth-api-url http://localhost:8000 \
  --game-server-url http://localhost:3000 \
  --ui-url http://localhost:5173 \
  --admin-username e2e_admin \
  --admin-password E2EAdminPass123! \
  --human-timeout-seconds 900
```

## Useful Driver Flags
- `--run-tag <explicit-tag>`
- `--artifact-dir <path>`
- `--starting-balance 10000`
- `--buy-in 1000`
- `--small-blind 10 --big-blind 20`
- `--action-timeout-seconds 10`
- `--timeout-seconds 240`
- `--human-timeout-seconds 900`
- `--poll-interval-seconds 2`

## Compose Safety Defaults
The compose runner isolates itself by default with:
- project name: `poker-gameplay-e2e`
- alternate host ports:
  - auth-api: `18000`
  - game-server: `18001`
  - react-ui: `18002`
  - postgres: `15432`
  - redis: `16379`

This means `down -v` targets only the E2E project instead of a developer's normal local stack.

## What the Automated Assertion Actually Proves
A successful automated run proves all of the following together:
- both fixture users can log in through the normal auth flow
- both can see the same fixture community/table/seats through ordinary APIs
- autonomous bots can connect to the real game server and play a real hand
- `/api/me/hands` for both users contains a common hand id
- `/api/hands/{hand_id}` for both users resolves to the fixture table and both expected participants
- ordinary admin product access cannot see or act on the fixture league/community/table/hand
- ordinary admin websocket spectator attempts receive `table_not_found`
- cleanup removes the run cleanly

## Troubleshooting
1. `Could not find PYTHON_BIN`:
   - Use `~/.virtualenvs/poker/bin/python`, or export `PYTHON_BIN=python` if your environment is already active.
2. `Admin login failed after readiness retry window`:
   - Confirm `ENV_MODE=dev`, bootstrap admin credentials, and `ENABLE_TEST_FIXTURE_API=true`.
3. `run_tag already exists`:
   - Use a new run tag. Fixture run tags are single-use.
4. `Timed out waiting for bot websocket connections`:
   - Check `game-server` logs in the artifact directory.
5. `Timed out waiting for a persisted common hand`:
   - Check both `auth-api` and `game-server` logs under the compose artifact directory.
6. `Expected table_not_found for admin spectate_table, got no response`:
   - Check game-server websocket logs and verify the test table runtime was created.
7. Cleanup failure:
   - Inspect `summary.json`, `compose.log`, and `compose-down.log` in the artifact directory.

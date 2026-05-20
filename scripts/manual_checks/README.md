# Manual Checks

This directory contains manual localhost-dependent verification scripts.

These files are intentionally **not** part of automated pytest collection.

Typical prerequisites:
- local services running on the documented localhost ports
- the repo `.env` configured with `PYTHON_BIN`
- any required fixture users, tables, or database state created first

Recommended invocation pattern:

```bash
source scripts/python-env.sh
PYTHON_BIN="$(resolve_repo_python_bin "$PWD")"
```

Common entrypoints:
- `"$PYTHON_BIN" scripts/manual_checks/action_timeout_check.py`
- `"$PYTHON_BIN" scripts/manual_checks/auto_seat_queue_check.py`
- `"$PYTHON_BIN" scripts/manual_checks/chunk5_buyin_check.py`
- `"$PYTHON_BIN" scripts/manual_checks/check_user_history.py <username>`
- `"$PYTHON_BIN" scripts/manual_checks/websocket_agent_check.py`

If one of these checks becomes important enough for CI or broad local automation, convert it into a real hermetic pytest suite in a separate change rather than moving it back under `tests/`.

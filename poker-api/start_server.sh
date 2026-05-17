#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$ROOT_DIR/scripts/python-env.sh"
PYTHON_BIN="$(resolve_repo_python_bin "$ROOT_DIR")"

cd "$SCRIPT_DIR"
"$PYTHON_BIN" -m uvicorn app.main:app --host 0.0.0.0 --port 8000

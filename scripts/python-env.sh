#!/usr/bin/env bash

dotenv_get_value() {
  local env_file="$1"
  local target_key="$2"

  [[ -f "$env_file" ]] || return 1

  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    [[ "$line" != *=* ]] && continue

    local key="${line%%=*}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    if [[ "$key" != "$target_key" ]]; then
      continue
    fi

    local value="${line#*=}"
    value="${value%$'\r'}"
    if [[ "$value" =~ ^\".*\"$ ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" =~ ^\'.*\'$ ]]; then
      value="${value:1:${#value}-2}"
    fi
    printf '%s' "$value"
    return 0
  done < "$env_file"

  return 1
}

resolve_repo_python_bin() {
  local repo_root="$1"
  local env_file="${repo_root}/.env"
  local python_bin="${PYTHON_BIN:-}"
  local python_venv="${PYTHON_VENV:-}"

  if [[ -z "$python_bin" ]]; then
    python_bin="$(dotenv_get_value "$env_file" "PYTHON_BIN" || true)"
  fi

  if [[ -z "$python_venv" ]]; then
    python_venv="$(dotenv_get_value "$env_file" "PYTHON_VENV" || true)"
  fi

  if [[ -z "$python_bin" && -n "$python_venv" ]]; then
    python_bin="${python_venv}/bin/python"
  fi

  if [[ -z "$python_bin" ]]; then
    python_bin="$HOME/.virtualenvs/poker/bin/python"
  fi

  printf '%s\n' "$python_bin"
}

resolve_repo_python_venv() {
  local repo_root="$1"
  local python_venv="${PYTHON_VENV:-}"

  if [[ -z "$python_venv" ]]; then
    python_venv="$(dotenv_get_value "${repo_root}/.env" "PYTHON_VENV" || true)"
  fi

  if [[ -z "$python_venv" ]]; then
    local python_bin
    python_bin="$(resolve_repo_python_bin "$repo_root")"
    python_venv="$(cd "$(dirname "$python_bin")/.." && pwd)"
  fi

  printf '%s\n' "$python_venv"
}

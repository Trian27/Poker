#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENGINE_ROOT="$REPO_ROOT/.runtime/engines/g5"
DOWNLOADS_DIR="$ENGINE_ROOT/downloads"
WORK_DIR="$ENGINE_ROOT/work"
VERSIONS_DIR="$ENGINE_ROOT/versions"
METADATA_DIR="$ENGINE_ROOT/metadata"
CURRENT_LINK="$ENGINE_ROOT/current"
ACTIVE_APP_RELATIVE=".runtime/engines/g5/current/app"
ACTIVE_APP_DIR="$CURRENT_LINK/app"
METADATA_FILE="$METADATA_DIR/install.json"
RUNTIME_HELPER="$SCRIPT_DIR/g5_runtime_common.py"
SMOKE_TEST_IMAGE="${G5_SMOKE_TEST_IMAGE:-python:3.12-alpine}"
BUILDER_DOCKERFILE="$REPO_ROOT/docker/g5-runtime-builder.Dockerfile"
PROBE_SOURCE_DIR="$REPO_ROOT/tools/g5-runtime-probe"

TMP_DOWNLOAD=""
TMP_EXTRACT_DIR=""
TMP_STAGED_DIR=""

usage() {
  cat <<'EOF'
Usage:
  scripts/install_g5_runtime.sh <command> [--url URL] [--sha256 SHA256]

Commands:
  install       Download, verify, extract, and activate a G5 runtime bundle
  verify        Validate the active G5 runtime layout and install metadata
  smoke-test    Validate Docker can mount and read the active runtime bundle
  probe         Validate the installed runtime can load G5 and execute a minimal decision path
  clean         Remove all local G5 runtime files under .runtime/engines/g5

Options:
  --url URL         Override G5_RUNTIME_BUNDLE_URL for install
  --sha256 SHA256   Override G5_RUNTIME_BUNDLE_SHA256 for install
  -h, --help        Show this message

Environment:
  G5_RUNTIME_BUNDLE_URL
  G5_RUNTIME_BUNDLE_SHA256
  G5_SMOKE_TEST_IMAGE   Optional Docker image for smoke-test (default: python:3.12-alpine)
  G5_PROBE_IMAGE        Optional Docker image for probe (default: pinned .NET SDK image)
EOF
}

log() {
  printf '%s\n' "$*"
}

warn() {
  printf 'WARNING: %s\n' "$*" >&2
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [ -n "${TMP_DOWNLOAD:-}" ] && [ -f "$TMP_DOWNLOAD" ]; then
    rm -f "$TMP_DOWNLOAD"
  fi
  if [ -n "${TMP_EXTRACT_DIR:-}" ] && [ -d "$TMP_EXTRACT_DIR" ]; then
    rm -rf "$TMP_EXTRACT_DIR"
  fi
  if [ -n "${TMP_STAGED_DIR:-}" ] && [ -d "$TMP_STAGED_DIR" ]; then
    rm -rf "$TMP_STAGED_DIR"
  fi
}

trap cleanup EXIT

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

ensure_base_dirs() {
  mkdir -p "$DOWNLOADS_DIR" "$WORK_DIR" "$VERSIONS_DIR" "$METADATA_DIR"
}

runtime_helper() {
  need_cmd python3
  python3 "$RUNTIME_HELPER" "$@"
}

get_manifest_field() {
  runtime_helper manifest-field "$1" "$2"
}

validate_manifest_file() {
  runtime_helper validate-manifest "$1" >/dev/null
}

validate_runtime_layout() {
  runtime_helper validate-layout "$1" "$2"
}

write_install_metadata() {
  runtime_helper write-install-metadata "$@"
}

validate_install_metadata() {
  runtime_helper validate-metadata "$@"
}

make_version_key() {
  runtime_helper version-key "$1" "$2"
}

activate_current_link() {
  runtime_helper activate-current "$1" "$2"
}

normalize_sha() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

download_archive_path_for_version() {
  printf '%s/%s.tar.gz' "$DOWNLOADS_DIR" "$1"
}

download_archive_relative_path_for_version() {
  printf '.runtime/engines/g5/downloads/%s.tar.gz' "$1"
}

resolve_bundle_root() {
  local extracted_root="$1"
  if [ -f "$extracted_root/bundle-manifest.json" ]; then
    printf '%s\n' "$extracted_root"
    return 0
  fi

  local first_dir=""
  local dir_count=0
  while IFS= read -r candidate; do
    dir_count=$((dir_count + 1))
    first_dir="$candidate"
  done < <(find "$extracted_root" -mindepth 1 -maxdepth 1 -type d)

  if [ "$dir_count" -eq 1 ] && [ -f "$first_dir/bundle-manifest.json" ]; then
    printf '%s\n' "$first_dir"
    return 0
  fi

  die "Could not locate bundle-manifest.json at the archive root or a single top-level directory"
}

check_docker_available() {
  local command_name="${1:-this command}"
  need_cmd docker
  docker info >/dev/null 2>&1 || die "Docker is required for ${command_name}. Start Docker Desktop and try again."
}

resolve_probe_image() {
  local configured_image="${G5_PROBE_IMAGE:-}"
  if [ -n "$configured_image" ]; then
    printf '%s\n' "$configured_image"
    return 0
  fi

  [ -f "$BUILDER_DOCKERFILE" ] || die "Missing builder Dockerfile: $BUILDER_DOCKERFILE"
  local default_image
  default_image="$(
    python3 - "$BUILDER_DOCKERFILE" <<'PY'
import re
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as handle:
    for line in handle:
        match = re.match(r"^ARG\s+BUILDER_BASE_IMAGE=(.+)$", line.strip())
        if match:
            print(match.group(1).strip())
            raise SystemExit(0)

raise SystemExit("ERROR: Could not locate ARG BUILDER_BASE_IMAGE in Dockerfile")
PY
  )"
  printf '%s\n' "$default_image"
}

install_runtime() {
  local bundle_url="$1"
  local expected_sha="$2"

  need_cmd curl
  need_cmd shasum
  need_cmd tar
  need_cmd python3

  [ -n "$bundle_url" ] || die "install requires G5_RUNTIME_BUNDLE_URL or --url"
  [ -n "$expected_sha" ] || die "install requires G5_RUNTIME_BUNDLE_SHA256 or --sha256"

  ensure_base_dirs

  local normalized_expected_sha
  normalized_expected_sha="$(normalize_sha "$expected_sha")"

  TMP_DOWNLOAD="$(mktemp "$DOWNLOADS_DIR/g5-bundle.XXXXXX.tar.gz")"
  TMP_EXTRACT_DIR="$(mktemp -d "$WORK_DIR/g5-extract.XXXXXX")"

  log "Downloading G5 runtime bundle..."
  curl -fsSL "$bundle_url" -o "$TMP_DOWNLOAD"

  local actual_sha
  actual_sha="$(shasum -a 256 "$TMP_DOWNLOAD" | awk '{print $1}')"
  actual_sha="$(normalize_sha "$actual_sha")"
  if [ "$actual_sha" != "$normalized_expected_sha" ]; then
    die "Checksum mismatch for downloaded bundle"
  fi

  log "Extracting bundle..."
  tar -xf "$TMP_DOWNLOAD" -C "$TMP_EXTRACT_DIR"

  local bundle_root
  bundle_root="$(resolve_bundle_root "$TMP_EXTRACT_DIR")"
  local manifest_path="$bundle_root/bundle-manifest.json"

  validate_manifest_file "$manifest_path"
  validate_runtime_layout "$manifest_path" "$bundle_root"

  local version_key
  version_key="$(make_version_key "$manifest_path" "$actual_sha")"
  local final_version_dir="$VERSIONS_DIR/$version_key"
  local final_app_dir="$final_version_dir/app"
  local final_archive_path
  final_archive_path="$(download_archive_path_for_version "$version_key")"
  local final_archive_relative
  final_archive_relative="$(download_archive_relative_path_for_version "$version_key")"

  TMP_STAGED_DIR="$(mktemp -d "$VERSIONS_DIR/${version_key}.XXXXXX")"
  mkdir -p "$TMP_STAGED_DIR/app"
  cp -R "$bundle_root"/. "$TMP_STAGED_DIR/app"/

  if [ -e "$final_version_dir" ] || [ -L "$final_version_dir" ]; then
    rm -rf "$final_version_dir"
  fi
  mv "$TMP_STAGED_DIR" "$final_version_dir"
  TMP_STAGED_DIR=""

  if [ -e "$final_archive_path" ]; then
    rm -f "$final_archive_path"
  fi
  mv "$TMP_DOWNLOAD" "$final_archive_path"
  TMP_DOWNLOAD=""

  activate_current_link "$ENGINE_ROOT" "$version_key"

  write_install_metadata \
    "$METADATA_FILE" \
    "$final_app_dir/bundle-manifest.json" \
    "$bundle_url" \
    "$normalized_expected_sha" \
    "$actual_sha" \
    "$ACTIVE_APP_RELATIVE" \
    "$version_key" \
    "$final_archive_relative"

  validate_runtime

  log "Installed G5 runtime version: $version_key"
  warn "Docker Desktop is required for 'smoke-test' and future runtime execution on macOS."
}

validate_runtime() {
  need_cmd python3

  [ -L "$CURRENT_LINK" ] || die "Active runtime pointer is missing: $CURRENT_LINK"
  [ -d "$ACTIVE_APP_DIR" ] || die "Active runtime app directory is missing: $ACTIVE_APP_DIR"
  [ -f "$METADATA_FILE" ] || die "Install metadata is missing: $METADATA_FILE"

  local manifest_path="$ACTIVE_APP_DIR/bundle-manifest.json"
  [ -f "$manifest_path" ] || die "Active bundle manifest is missing: $manifest_path"

  validate_manifest_file "$manifest_path"
  validate_runtime_layout "$manifest_path" "$ACTIVE_APP_DIR"
  validate_install_metadata "$METADATA_FILE" "$manifest_path" "$CURRENT_LINK" "$ACTIVE_APP_RELATIVE" "$REPO_ROOT"

  log "G5 runtime verification passed."
}

smoke_test_runtime() {
  need_cmd python3
  validate_runtime
  check_docker_available "smoke-test"

  log "Running Docker smoke-test with image: $SMOKE_TEST_IMAGE"
  docker run --rm -i --platform linux/amd64 \
    -v "$ACTIVE_APP_DIR:/opt/g5:ro" \
    "$SMOKE_TEST_IMAGE" \
    python3 - /opt/g5/bundle-manifest.json /opt/g5 <<'PY'
import json
import os
import pathlib
import sys


def fail(message: str) -> None:
    raise SystemExit(f"ERROR: {message}")


def normalize_manifest_path(raw: str):
    if not isinstance(raw, str):
        fail("Manifest path entries must be strings")
    value = raw.strip()
    if not value:
        fail("Manifest path entries must not be empty")
    if "\\" in value:
        fail(f"Manifest path must use forward slashes only: {raw}")
    expects_dir = value.endswith("/")
    normalized = value.rstrip("/")
    path = pathlib.PurePosixPath(normalized)
    if path.is_absolute():
        fail(f"Manifest path must be relative: {raw}")
    for part in path.parts:
        if part in ("", ".", ".."):
            fail(f"Manifest path contains unsupported segment '{part}': {raw}")
    return str(path), expects_dir


manifest_path, app_root = sys.argv[1], sys.argv[2]
if not os.path.isdir(app_root):
    fail(f"Mounted runtime root is missing: {app_root}")
if not os.path.isfile(manifest_path):
    fail(f"Mounted bundle manifest is missing: {manifest_path}")

with open(manifest_path, "r", encoding="utf-8") as handle:
    data = json.load(handle)

if data.get("engine") != "g5":
    fail("Manifest engine must be 'g5'")
if data.get("platform") != "linux-x64":
    fail("Manifest platform must be 'linux-x64'")
if data.get("table_profile_schema_version") != 1:
    fail("Manifest table_profile_schema_version must be 1")

required_files = data.get("required_files")
if not isinstance(required_files, list) or not required_files:
    fail("Manifest field 'required_files' must be a non-empty array")

table_profiles = data.get("table_profiles")
if not isinstance(table_profiles, list) or not table_profiles:
    fail("Manifest field 'table_profiles' must be a non-empty array")

expected_profiles = {
    "heads_up": (2, 2, "HeadsUp"),
    "six_max": (3, 6, "SixMax"),
}
seen_profiles = set()
coverage = set()

for field in ("required_files", "managed_assemblies", "native_libraries"):
    entries = data.get(field)
    if not isinstance(entries, list) or not entries:
        fail(f"Manifest field '{field}' must be a non-empty array")
    for raw_entry in entries:
        normalized, expects_dir = normalize_manifest_path(raw_entry)
        target = os.path.join(app_root, *normalized.split("/"))
        if field in ("managed_assemblies", "native_libraries"):
            if not os.path.isfile(target):
                fail(f"Missing required file inside container: {normalized}")
        elif expects_dir:
            if not os.path.isdir(target):
                fail(f"Missing required directory inside container: {normalized}")
        elif not os.path.exists(target):
            fail(f"Missing required path inside container: {normalized}")

for profile in table_profiles:
    if not isinstance(profile, dict):
        fail("Manifest table_profiles entries must be objects")
    profile_name = profile.get("profile")
    if profile_name not in expected_profiles:
        fail(f"Unsupported table profile: {profile_name}")
    if profile_name in seen_profiles:
        fail(f"Duplicate table profile: {profile_name}")
    seen_profiles.add(profile_name)

    player_count_min, player_count_max, table_type = expected_profiles[profile_name]
    if profile.get("player_count_min") != player_count_min or profile.get("player_count_max") != player_count_max:
        fail(f"Profile {profile_name} must cover exactly {player_count_min}..{player_count_max}")
    if profile.get("table_type") != table_type:
        fail(f"Profile {profile_name} must use table_type {table_type}")

    stats_file = profile.get("opponent_stats_file")
    normalized_stats, expects_dir = normalize_manifest_path(stats_file)
    if expects_dir:
        fail(f"Profile {profile_name} opponent_stats_file must be a file path")
    if normalized_stats not in required_files:
        fail(f"Profile {profile_name} opponent_stats_file must also appear in required_files")
    target = os.path.join(app_root, *normalized_stats.split("/"))
    if not os.path.isfile(target):
        fail(f"Missing table profile stats file inside container: {normalized_stats}")

    for player_count in range(player_count_min, player_count_max + 1):
        coverage.add(player_count)

if seen_profiles != set(expected_profiles):
    fail("Manifest table_profiles must include exactly heads_up and six_max")
if coverage != set(range(2, 7)):
    fail("Manifest table_profiles must cover exactly player counts 2..6")

print("G5 runtime smoke-test passed.")
PY
}

probe_runtime() {
  need_cmd python3
  validate_runtime
  check_docker_available "probe"
  [ -d "$PROBE_SOURCE_DIR" ] || die "Missing tracked probe source directory: $PROBE_SOURCE_DIR"
  [ -f "$PROBE_SOURCE_DIR/G5RuntimeProbe.csproj" ] || die "Missing probe project file: $PROBE_SOURCE_DIR/G5RuntimeProbe.csproj"

  local probe_image
  probe_image="$(resolve_probe_image)"

  log "Running G5 runtime probe with image: $probe_image"
  docker run --rm -i --platform linux/amd64 \
    -v "$ACTIVE_APP_DIR:/opt/g5:ro" \
    -v "$PROBE_SOURCE_DIR:/probe-src:ro" \
    "$probe_image" \
    /bin/bash -lc '
set -euo pipefail
rm -rf /tmp/g5-probe
mkdir -p /tmp/g5-probe/runtime /tmp/g5-probe/probe-src
cp -R /opt/g5/. /tmp/g5-probe/runtime/
cp -R /probe-src/. /tmp/g5-probe/probe-src/
export LD_LIBRARY_PATH=/tmp/g5-probe/runtime:${LD_LIBRARY_PATH:-}
dotnet restore /tmp/g5-probe/probe-src/G5RuntimeProbe.csproj --ignore-failed-sources >/dev/null
dotnet run --no-restore --project /tmp/g5-probe/probe-src/G5RuntimeProbe.csproj -- --runtime-dir /tmp/g5-probe/runtime
'
}

clean_runtime() {
  if [ -d "$ENGINE_ROOT" ] || [ -L "$ENGINE_ROOT" ]; then
    rm -rf "$ENGINE_ROOT"
    log "Removed $ENGINE_ROOT"
  else
    log "Nothing to clean at $ENGINE_ROOT"
  fi
}

COMMAND="${1:-}"
if [ -z "$COMMAND" ]; then
  usage
  exit 1
fi
shift

G5_URL="${G5_RUNTIME_BUNDLE_URL:-}"
G5_SHA256="${G5_RUNTIME_BUNDLE_SHA256:-}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --url)
      [ "$#" -ge 2 ] || die "Missing value for --url"
      G5_URL="$2"
      shift 2
      ;;
    --sha256)
      [ "$#" -ge 2 ] || die "Missing value for --sha256"
      G5_SHA256="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

case "$COMMAND" in
  install)
    install_runtime "$G5_URL" "$G5_SHA256"
    ;;
  verify)
    validate_runtime
    ;;
  smoke-test)
    smoke_test_runtime
    ;;
  probe)
    probe_runtime
    ;;
  clean)
    clean_runtime
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage
    die "Unknown command: $COMMAND"
    ;;
esac

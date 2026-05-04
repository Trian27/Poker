#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PIN_FILE="$SCRIPT_DIR/g5_runtime_source_pin.json"
RUNTIME_HELPER="$SCRIPT_DIR/g5_runtime_common.py"
DOCKERFILE_PATH="$REPO_ROOT/docker/g5-runtime-builder.Dockerfile"

TMP_ROOT=""
TMP_SOURCE_DIR=""
TMP_STAGE_DIR=""
TMP_OUTPUT_STAGE_DIR=""

usage() {
  cat <<'EOF'
Usage:
  scripts/build_g5_runtime_bundle.sh --output-dir PATH [options]

Required:
  --output-dir PATH            Directory that will receive the bundle outputs

Optional:
  --source-repo URL            Experimental override for the upstream G5 repo
  --source-ref REF             Experimental override for the upstream G5 ref
  --bundle-version VERSION     Override the derived bundle version
  --source-date-epoch EPOCH    Override SOURCE_DATE_EPOCH for deterministic packaging
  -h, --help                   Show this message

Environment overrides:
  G5_SOURCE_REPO_OVERRIDE
  G5_SOURCE_REF_OVERRIDE
  G5_BUNDLE_VERSION_OVERRIDE
  G5_SOURCE_DATE_EPOCH
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
  if [ -n "${TMP_ROOT:-}" ] && [ -d "$TMP_ROOT" ]; then
    rm -rf "$TMP_ROOT"
  fi
}

trap cleanup EXIT

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

runtime_helper() {
  python3 "$RUNTIME_HELPER" "$@"
}

json_string_field() {
  python3 - "$1" "$2" <<'PY'
import json
import sys
path, field = sys.argv[1], sys.argv[2]
with open(path, 'r', encoding='utf-8') as handle:
    data = json.load(handle)
value = data.get(field, "")
if value is None:
    value = ""
if not isinstance(value, str):
    raise SystemExit(f"ERROR: {path}: field {field!r} must be a string")
print(value)
PY
}

json_string_array_lines() {
  python3 - "$1" "$2" <<'PY'
import json
import sys
path, field = sys.argv[1], sys.argv[2]
with open(path, 'r', encoding='utf-8') as handle:
    data = json.load(handle)
value = data.get(field, [])
if value is None:
    value = []
if not isinstance(value, list):
    raise SystemExit(f"ERROR: {path}: field {field!r} must be an array")
for item in value:
    if not isinstance(item, str):
        raise SystemExit(f"ERROR: {path}: field {field!r} entries must be strings")
    print(item)
PY
}

json_array_from_args() {
  python3 - "$@" <<'PY'
import json
import sys
print(json.dumps(sys.argv[1:]))
PY
}

abspath() {
  python3 - "$1" <<'PY'
import os
import sys
print(os.path.abspath(sys.argv[1]))
PY
}

epoch_to_utc() {
  python3 - "$1" <<'PY'
import datetime as dt
import sys
print(dt.datetime.fromtimestamp(int(sys.argv[1]), tz=dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))
PY
}

compute_patch_fingerprint() {
  python3 - "$@" <<'PY'
import hashlib
import sys
h = hashlib.sha256()
for path in sys.argv[1:]:
    h.update(path.encode('utf-8'))
    h.update(b'\0')
    with open(path, 'rb') as handle:
        h.update(handle.read())
    h.update(b'\0')
print(h.hexdigest())
PY
}

derive_bundle_version() {
  python3 - "$1" "$2" "$3" <<'PY'
import re
import sys

template, commit_short, patch_hash = sys.argv[1:4]
value = template.replace('{source_commit_short}', commit_short).replace('{patch_set_hash8}', patch_hash[:8])
value = re.sub(r'[^A-Za-z0-9._-]+', '-', value).strip('-')
if not value:
    raise SystemExit('ERROR: Derived bundle version is empty')
print(value)
PY
}

validate_bundle_version() {
  python3 - "$1" <<'PY'
import re
import sys
value = sys.argv[1].strip()
if not value:
    raise SystemExit("ERROR: bundle version must not be empty")
if not re.fullmatch(r"[A-Za-z0-9._-]+", value):
    raise SystemExit("ERROR: bundle version must match [A-Za-z0-9._-]+")
print(value)
PY
}

check_docker_available() {
  need_cmd docker
  docker info >/dev/null 2>&1 || die "Docker is required to build the G5 bundle. Start Docker Desktop and try again."
}

resolve_builder_base_image_ref() {
  python3 - "$DOCKERFILE_PATH" <<'PY'
import re
import sys
with open(sys.argv[1], 'r', encoding='utf-8') as handle:
    for line in handle:
        match = re.match(r'^ARG\s+BUILDER_BASE_IMAGE=(.+)$', line.strip())
        if match:
            print(match.group(1).strip())
            raise SystemExit(0)
raise SystemExit('ERROR: Could not locate ARG BUILDER_BASE_IMAGE in Dockerfile')
PY
}

OUTPUT_DIR=""
SOURCE_REPO_OVERRIDE="${G5_SOURCE_REPO_OVERRIDE:-}"
SOURCE_REF_OVERRIDE="${G5_SOURCE_REF_OVERRIDE:-}"
BUNDLE_VERSION_OVERRIDE="${G5_BUNDLE_VERSION_OVERRIDE:-}"
SOURCE_DATE_EPOCH_OVERRIDE="${G5_SOURCE_DATE_EPOCH:-}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output-dir)
      [ "$#" -ge 2 ] || die "Missing value for --output-dir"
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --source-repo)
      [ "$#" -ge 2 ] || die "Missing value for --source-repo"
      SOURCE_REPO_OVERRIDE="$2"
      shift 2
      ;;
    --source-ref)
      [ "$#" -ge 2 ] || die "Missing value for --source-ref"
      SOURCE_REF_OVERRIDE="$2"
      shift 2
      ;;
    --bundle-version)
      [ "$#" -ge 2 ] || die "Missing value for --bundle-version"
      BUNDLE_VERSION_OVERRIDE="$2"
      shift 2
      ;;
    --source-date-epoch)
      [ "$#" -ge 2 ] || die "Missing value for --source-date-epoch"
      SOURCE_DATE_EPOCH_OVERRIDE="$2"
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

[ -n "$OUTPUT_DIR" ] || die "build requires --output-dir"
[ -f "$PIN_FILE" ] || die "Missing source pin manifest: $PIN_FILE"
[ -f "$RUNTIME_HELPER" ] || die "Missing runtime helper: $RUNTIME_HELPER"
[ -f "$DOCKERFILE_PATH" ] || die "Missing builder Dockerfile: $DOCKERFILE_PATH"

need_cmd git
need_cmd python3
need_cmd shasum
need_cmd tar
check_docker_available

if [ -e "$OUTPUT_DIR" ] && [ ! -d "$OUTPUT_DIR" ]; then
  die "Output path exists and is not a directory: $OUTPUT_DIR"
fi
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(abspath "$OUTPUT_DIR")"

PIN_SOURCE_REPO="$(json_string_field "$PIN_FILE" source_repo)"
PIN_SOURCE_REF="$(json_string_field "$PIN_FILE" source_ref)"
PIN_SOURCE_COMMIT_EXPECTED="$(json_string_field "$PIN_FILE" source_commit_expected)"
PIN_BUILDER_PLATFORM="$(json_string_field "$PIN_FILE" builder_platform)"
PIN_DOTNET_TARGET="$(json_string_field "$PIN_FILE" dotnet_target)"
PIN_ENTRYPOINT_HINT="$(json_string_field "$PIN_FILE" entrypoint_hint)"
PIN_BUNDLE_VERSION_TEMPLATE="$(json_string_field "$PIN_FILE" default_bundle_version_template)"

SOURCE_REPO="$PIN_SOURCE_REPO"
SOURCE_REF="$PIN_SOURCE_REF"
SOURCE_COMMIT_EXPECTED="$PIN_SOURCE_COMMIT_EXPECTED"
SOURCE_PIN_MODE="tracked"
if [ -n "$SOURCE_REPO_OVERRIDE" ] || [ -n "$SOURCE_REF_OVERRIDE" ]; then
  SOURCE_PIN_MODE="override"
  [ -n "$SOURCE_REPO_OVERRIDE" ] && SOURCE_REPO="$SOURCE_REPO_OVERRIDE"
  [ -n "$SOURCE_REF_OVERRIDE" ] && SOURCE_REF="$SOURCE_REF_OVERRIDE"
fi

PATCH_REL_PATHS=()
while IFS= read -r patch_path; do
  [ -n "$patch_path" ] || continue
  PATCH_REL_PATHS+=("$patch_path")
done < <(json_string_array_lines "$PIN_FILE" patches)

PATCH_ABS_PATHS=()
for patch_rel in "${PATCH_REL_PATHS[@]}"; do
  patch_abs="$REPO_ROOT/$patch_rel"
  [ -f "$patch_abs" ] || die "Tracked patch is missing: $patch_rel"
  PATCH_ABS_PATHS+=("$patch_abs")
done

PATCH_FINGERPRINT="$(compute_patch_fingerprint "${PATCH_ABS_PATHS[@]}")"

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/g5-bundle-build.XXXXXX")"
TMP_SOURCE_DIR="$TMP_ROOT/source"
TMP_STAGE_DIR="$TMP_ROOT/stage"
TMP_OUTPUT_STAGE_DIR="$TMP_ROOT/output"
mkdir -p "$TMP_STAGE_DIR" "$TMP_OUTPUT_STAGE_DIR" "$TMP_ROOT/container-work"

BUILDER_BASE_IMAGE_REF="$(resolve_builder_base_image_ref)"
BUILDER_BASE_IMAGE="${BUILDER_BASE_IMAGE_REF%@*}"
BUILDER_BASE_IMAGE_DIGEST="${BUILDER_BASE_IMAGE_REF#*@}"
[ "$BUILDER_BASE_IMAGE" != "$BUILDER_BASE_IMAGE_DIGEST" ] || die "Builder base image must include a digest: $BUILDER_BASE_IMAGE_REF"

DOCKERFILE_SHA256="$(shasum -a 256 "$DOCKERFILE_PATH" | awk '{print $1}')"
SCRIPT_SHA256="$(shasum -a 256 "$0" | awk '{print $1}')"
BUILD_SCRIPT_VERSION="sha256:${SCRIPT_SHA256}"
BUILDER_IMAGE_TAG="local/g5-runtime-builder:${DOCKERFILE_SHA256:0:12}"

log "Cloning pinned G5 source..."
git clone "$SOURCE_REPO" "$TMP_SOURCE_DIR" >/dev/null 2>&1 || die "Failed to clone upstream source: $SOURCE_REPO"
git -C "$TMP_SOURCE_DIR" checkout --quiet "$SOURCE_REF" || die "Failed to checkout source ref: $SOURCE_REF"
SOURCE_COMMIT_RESOLVED="$(git -C "$TMP_SOURCE_DIR" rev-parse HEAD)"
if [ "$SOURCE_PIN_MODE" = "tracked" ] && [ -n "$SOURCE_COMMIT_EXPECTED" ] && [ "$SOURCE_COMMIT_RESOLVED" != "$SOURCE_COMMIT_EXPECTED" ]; then
  die "Resolved source commit does not match tracked source_commit_expected"
fi
SOURCE_COMMIT_SHORT="$(printf '%s' "$SOURCE_COMMIT_RESOLVED" | cut -c1-12)"

if [ -n "$SOURCE_DATE_EPOCH_OVERRIDE" ]; then
  SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH_OVERRIDE"
else
  SOURCE_DATE_EPOCH="$(git -C "$TMP_SOURCE_DIR" show -s --format=%ct "$SOURCE_COMMIT_RESOLVED")"
fi
case "$SOURCE_DATE_EPOCH" in
  ''|*[!0-9]*) die "source-date-epoch must be an integer Unix timestamp" ;;
esac
BUILT_AT_UTC="$(epoch_to_utc "$SOURCE_DATE_EPOCH")"

if [ -n "$BUNDLE_VERSION_OVERRIDE" ]; then
  BUNDLE_VERSION="$(validate_bundle_version "$BUNDLE_VERSION_OVERRIDE")"
else
  BUNDLE_VERSION="$(derive_bundle_version "$PIN_BUNDLE_VERSION_TEMPLATE" "$SOURCE_COMMIT_SHORT" "$PATCH_FINGERPRINT")"
fi
BUNDLE_VERSION="$(validate_bundle_version "$BUNDLE_VERSION")"

if [ "${#PATCH_ABS_PATHS[@]}" -gt 0 ]; then
  log "Applying tracked patches..."
  for patch_abs in "${PATCH_ABS_PATHS[@]}"; do
    git -C "$TMP_SOURCE_DIR" apply --check "$patch_abs" || die "Tracked patch does not apply cleanly: ${patch_abs#$REPO_ROOT/}"
    git -C "$TMP_SOURCE_DIR" apply "$patch_abs"
  done
fi

log "Building G5 builder image..."
docker build --platform "$PIN_BUILDER_PLATFORM" -f "$DOCKERFILE_PATH" -t "$BUILDER_IMAGE_TAG" "$REPO_ROOT" >/dev/null \
  || die "Failed to build the G5 builder image"

log "Compiling upstream G5 into a staged runtime..."
if ! docker run --rm -i --platform "$PIN_BUILDER_PLATFORM" \
  -v "$TMP_SOURCE_DIR:/input/source:ro" \
  -v "$TMP_ROOT/container-work:/work" \
  -v "$TMP_STAGE_DIR:/stage" \
  "$BUILDER_IMAGE_TAG" \
  bash -s -- "$PIN_DOTNET_TARGET" <<'EOF'
set -euo pipefail

dotnet_target="$1"
mkdir -p /work/source
cp -R /input/source/. /work/source/

cd /work/source/src/DecisionMaking
make clean >/dev/null 2>&1 || true
make >/dev/null

cd /work/source
DOTNET_CLI_TELEMETRY_OPTOUT=1 dotnet build src/G5Gym/G5Gym.csproj -c Release -f "$dotnet_target" >/dev/null

managed_dir="/work/source/src/G5Gym/bin/Release/${dotnet_target}"
[ -f "$managed_dir/G5Gym.dll" ] || { echo "ERROR: Missing G5Gym.dll after build" >&2; exit 1; }
[ -f "$managed_dir/G5.Logic.dll" ] || { echo "ERROR: Missing G5.Logic.dll after build" >&2; exit 1; }

rm -rf /stage/*
mkdir -p /stage
cp -R "$managed_dir"/. /stage/
cp /work/source/redist/PreFlopEquities.txt /stage/
cp /work/source/redist/full_stats_list_6max.bin /stage/
cp -R /work/source/redist/PreFlopCharts /stage/
cp /work/source/src/DecisionMaking/libdec_making.so /stage/DecisionMaking.dll

libtbb_path="$(ldconfig -p | awk '/libtbb\.so\.[0-9]+/ { print $NF; exit }')"
[ -n "$libtbb_path" ] || { echo "ERROR: Could not locate libtbb runtime library" >&2; exit 1; }
cp "$libtbb_path" "/stage/$(basename "$libtbb_path")"

find /stage -type d -exec chmod 0755 {} +
find /stage -type f -exec chmod 0644 {} +
EOF
then
  die "Failed to compile upstream G5 into a staged runtime"
fi

MANAGED_ASSEMBLIES=("G5Gym.dll" "G5.Logic.dll")
NATIVE_TBB_BASENAME="$(find "$TMP_STAGE_DIR" -maxdepth 1 -type f -name 'libtbb.so*' -print | sed 's#^.*/##' | head -n 1)"
[ -n "$NATIVE_TBB_BASENAME" ] || die "Failed to locate bundled libtbb runtime in staged app"
NATIVE_LIBRARIES=("DecisionMaking.dll" "$NATIVE_TBB_BASENAME")
REQUIRED_FILES=("bundle-manifest.json" "full_stats_list_6max.bin" "PreFlopEquities.txt" "PreFlopCharts/")

REQUIRED_FILES_JSON="$(json_array_from_args "${REQUIRED_FILES[@]}")"
MANAGED_ASSEMBLIES_JSON="$(json_array_from_args "${MANAGED_ASSEMBLIES[@]}")"
NATIVE_LIBRARIES_JSON="$(json_array_from_args "${NATIVE_LIBRARIES[@]}")"
PATCHES_JSON="$(json_array_from_args "${PATCH_REL_PATHS[@]}")"

MANIFEST_DRAFT="$TMP_ROOT/bundle-manifest.draft.json"
export BUNDLE_VERSION BUILT_AT_UTC PIN_ENTRYPOINT_HINT MANAGED_ASSEMBLIES_JSON NATIVE_LIBRARIES_JSON
export PIN_DOTNET_TARGET REQUIRED_FILES_JSON SOURCE_REPO SOURCE_REF SOURCE_COMMIT_RESOLVED
export SOURCE_PIN_MODE PATCHES_JSON BUILDER_IMAGE_TAG BUILDER_BASE_IMAGE BUILDER_BASE_IMAGE_DIGEST
export PIN_BUILDER_PLATFORM DOCKERFILE_SHA256 BUILD_SCRIPT_VERSION
python3 - "$MANIFEST_DRAFT" <<'PY'
import json
import os
import sys

output_path = sys.argv[1]
payload = {
    "engine": "g5",
    "platform": "linux-x64",
    "bundle_version": os.environ["BUNDLE_VERSION"],
    "built_at_utc": os.environ["BUILT_AT_UTC"],
    "entrypoint_hint": os.environ["PIN_ENTRYPOINT_HINT"],
    "managed_assemblies": json.loads(os.environ["MANAGED_ASSEMBLIES_JSON"]),
    "native_libraries": json.loads(os.environ["NATIVE_LIBRARIES_JSON"]),
    "dotnet_target": os.environ["PIN_DOTNET_TARGET"],
    "required_files": json.loads(os.environ["REQUIRED_FILES_JSON"]),
    "source_repo": os.environ["SOURCE_REPO"],
    "source_ref_requested": os.environ["SOURCE_REF"],
    "source_commit_resolved": os.environ["SOURCE_COMMIT_RESOLVED"],
    "source_pin_mode": os.environ["SOURCE_PIN_MODE"],
    "source_patches_applied": json.loads(os.environ["PATCHES_JSON"]),
    "builder_image": os.environ["BUILDER_IMAGE_TAG"],
    "builder_base_image": os.environ["BUILDER_BASE_IMAGE"],
    "builder_base_image_digest": os.environ["BUILDER_BASE_IMAGE_DIGEST"],
    "builder_platform": os.environ["PIN_BUILDER_PLATFORM"],
    "builder_dockerfile_sha256": os.environ["DOCKERFILE_SHA256"],
    "build_script_version": os.environ["BUILD_SCRIPT_VERSION"],
}
with open(output_path, 'w', encoding='utf-8') as handle:
    json.dump(payload, handle, indent=2, sort_keys=True)
    handle.write('\n')
PY

runtime_helper validate-manifest-strict "$MANIFEST_DRAFT" > "$TMP_STAGE_DIR/bundle-manifest.json"
runtime_helper validate-layout "$TMP_STAGE_DIR/bundle-manifest.json" "$TMP_STAGE_DIR"

FINAL_ARCHIVE_FILENAME="g5-runtime-linux-x64-${BUNDLE_VERSION}.tar.gz"
FINAL_SHA_FILENAME="g5-runtime-linux-x64-${BUNDLE_VERSION}.sha256"
FINAL_BUILD_REPORT_FILENAME="g5-runtime-linux-x64-${BUNDLE_VERSION}.build.json"

TEMP_ARCHIVE_PATH="$TMP_OUTPUT_STAGE_DIR/${FINAL_ARCHIVE_FILENAME}.tmp"

if ! docker run --rm -i --platform "$PIN_BUILDER_PLATFORM" \
  -e SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" \
  -v "$TMP_STAGE_DIR:/stage:ro" \
  -v "$TMP_OUTPUT_STAGE_DIR:/out" \
  "$BUILDER_IMAGE_TAG" \
  bash -s -- "/out/${FINAL_ARCHIVE_FILENAME}.tmp" <<'EOF'
set -euo pipefail

archive_path="$1"
rm -f "$archive_path"
tar --sort=name \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  --mtime="@${SOURCE_DATE_EPOCH}" \
  -cf - -C /stage . | gzip -n > "$archive_path"
EOF
then
  die "Failed to package the staged runtime bundle"
fi

ARCHIVE_SHA256="$(shasum -a 256 "$TEMP_ARCHIVE_PATH" | awk '{print $1}')"
printf '%s  %s\n' "$ARCHIVE_SHA256" "$FINAL_ARCHIVE_FILENAME" > "$TMP_OUTPUT_STAGE_DIR/${FINAL_SHA_FILENAME}.tmp"
runtime_helper write-build-report \
  "$TMP_OUTPUT_STAGE_DIR/${FINAL_BUILD_REPORT_FILENAME}.tmp" \
  "$TMP_STAGE_DIR/bundle-manifest.json" \
  "$FINAL_ARCHIVE_FILENAME" \
  "$ARCHIVE_SHA256" \
  "$OUTPUT_DIR"

mv "$TEMP_ARCHIVE_PATH" "$OUTPUT_DIR/$FINAL_ARCHIVE_FILENAME"
mv "$TMP_OUTPUT_STAGE_DIR/${FINAL_SHA_FILENAME}.tmp" "$OUTPUT_DIR/$FINAL_SHA_FILENAME"
mv "$TMP_OUTPUT_STAGE_DIR/${FINAL_BUILD_REPORT_FILENAME}.tmp" "$OUTPUT_DIR/$FINAL_BUILD_REPORT_FILENAME"

log "Built G5 runtime bundle: $OUTPUT_DIR/$FINAL_ARCHIVE_FILENAME"
log "SHA256: $ARCHIVE_SHA256"
log ""
log "Next steps:"
log "  export G5_RUNTIME_BUNDLE_URL=\"file://$OUTPUT_DIR/$FINAL_ARCHIVE_FILENAME\""
log "  export G5_RUNTIME_BUNDLE_SHA256=\"$ARCHIVE_SHA256\""
log "  ./scripts/install_g5_runtime.sh install"
log "  ./scripts/install_g5_runtime.sh verify"
log "  ./scripts/install_g5_runtime.sh smoke-test"

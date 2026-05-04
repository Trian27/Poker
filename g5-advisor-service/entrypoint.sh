#!/usr/bin/env sh
set -eu

runtime_dir="${G5_RUNTIME_WORK_DIR:-/var/lib/g5-runtime/current}"
source_dir="${G5_RUNTIME_BUNDLE_SOURCE_DIR:-/opt/g5-bundle}"

if [ -n "${LD_LIBRARY_PATH:-}" ]; then
  export LD_LIBRARY_PATH="${runtime_dir}:${LD_LIBRARY_PATH}"
else
  export LD_LIBRARY_PATH="${runtime_dir}"
fi

if [ -d "${source_dir}" ]; then
  mkdir -p "$(dirname "${runtime_dir}")"
  rm -rf "${runtime_dir}"
  mkdir -p "${runtime_dir}"
  cp -R "${source_dir}/." "${runtime_dir}/"
fi

exec dotnet G5AdvisorService.dll

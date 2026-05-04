# G5 Runtime Setup

This guide bootstraps a pinned Linux `x64` G5 runtime bundle on a macOS developer machine for later containerized use.

G5 is **not** run natively on macOS in this first step. The local workflow is:
- macOS host
- Linux `x64` runtime bundle stored under `.runtime/`
- later execution through Docker Desktop

## Related Guide

To build a local G5 runtime bundle from the pinned upstream source before installing it, see [G5_BUNDLE_BUILD.md](G5_BUNDLE_BUILD.md).

## Why This Exists

The repo should not commit large runtime artifacts or native libraries to Git. Instead, this setup script:
- downloads a prebuilt Linux bundle from an operator-supplied URL
- verifies its SHA256 checksum
- installs it into a versioned local runtime directory
- validates the runtime layout and metadata
- verifies the bundle can be mounted into a Linux container from macOS

## Prerequisites

### For `install`
- `python3`
- `curl`
- `shasum`
- `tar`

### For `smoke-test` and `probe`
- Docker Desktop installed
- Docker Desktop running

### Optional for local probe debugging
- `.NET 8 SDK`

The tracked probe does not require host `dotnet` for normal use. It runs inside Docker.

### Apple Silicon note
The smoke test uses a `linux/amd64` container. That is expected, because the runtime bundle is Linux `x64`.

## Runtime Layout

The installer creates this local-only structure:

```text
.runtime/
  engines/
    g5/
      downloads/
      work/
      versions/
        <bundle_version_or_sha>/
          app/
      current -> versions/<bundle_version_or_sha>
      metadata/
        install.json
```

Future container mount point:

```text
.runtime/engines/g5/current/app:/opt/g5:ro
```

## Bundle Contract

The installer expects a prebuilt `linux-x64` archive that contains an app root with:

- `bundle-manifest.json`
- `full_stats_list_6max.bin`
- `PreFlopEquities.txt`
- `PreFlopCharts/`
- required G5 managed assemblies
- required native decision library or libraries

### `bundle-manifest.json`

At minimum, the manifest must include:

```json
{
  "engine": "g5",
  "platform": "linux-x64",
  "bundle_version": "2026.05.03",
  "built_at_utc": "2026-05-03T20:15:00Z",
  "entrypoint_hint": "G5.Runtime.dll",
  "managed_assemblies": [
    "G5.Runtime.dll"
  ],
  "native_libraries": [
    "DecisionMaking/libdec_making.so"
  ],
  "dotnet_target": "net8.0",
  "required_files": [
    "bundle-manifest.json",
    "full_stats_list_6max.bin",
    "PreFlopEquities.txt",
    "PreFlopCharts/"
  ]
}
```

The manifest is the source of truth for verification and smoke-test validation.

### `metadata/install.json`

The installer writes local activation metadata with fields including:

- `engine`
- `bundle_url`
- `bundle_sha256_expected`
- `bundle_sha256_actual`
- `bundle_version`
- `platform`
- `installed_at_utc`
- `active_path`
- `version_key`
- `downloaded_archive`

## Commands

### Install

For independent collaborators, the simplest v1 workflow is a **local bundle file** plus env vars.

Provide a local file URL and SHA256 checksum through env vars:

```bash
export G5_RUNTIME_BUNDLE_URL="file:///Users/yourname/Downloads/g5-runtime-linux-x64.tar.gz"
export G5_RUNTIME_BUNDLE_SHA256="replace-with-real-sha256"

./scripts/install_g5_runtime.sh install
```

You can also point at a remotely hosted bundle:

```bash
export G5_RUNTIME_BUNDLE_URL="https://example.com/g5-linux-x64.tar.gz"
export G5_RUNTIME_BUNDLE_SHA256="replace-with-real-sha256"

./scripts/install_g5_runtime.sh install
```

Or with CLI flags:

```bash
./scripts/install_g5_runtime.sh install \
  --url "https://example.com/g5-linux-x64.tar.gz" \
  --sha256 "replace-with-real-sha256"
```

What `install` does:
- downloads the archive into `.runtime/engines/g5/downloads/`
- verifies the SHA256 checksum
- extracts it into `.runtime/engines/g5/work/`
- validates the manifest and final runtime paths
- activates the bundle under `.runtime/engines/g5/current`
- writes `.runtime/engines/g5/metadata/install.json`

`install` does **not** require Docker Desktop. It only prepares the runtime.

### Verify

```bash
./scripts/install_g5_runtime.sh verify
```

What `verify` checks:
- `current` resolves correctly
- metadata exists and is well-formed
- `bundle-manifest.json` exists and is well-formed
- manifest declares `engine == g5`
- manifest declares `platform == linux-x64`
- all manifest-declared `required_files` entries exist
- all manifest-declared `managed_assemblies` entries exist
- all manifest-declared `native_libraries` entries exist
- the downloaded archive still matches the installed SHA metadata

### Smoke-test

```bash
./scripts/install_g5_runtime.sh smoke-test
```

What `smoke-test` does:
- verifies the local runtime first
- starts a lightweight `linux/amd64` container
- mounts `.runtime/engines/g5/current/app` at `/opt/g5`
- reads `/opt/g5/bundle-manifest.json`
- validates manifest-declared runtime paths inside the container

This does **not** run real G5 analysis logic yet. It only proves that the installed bundle is visible and readable from Docker on macOS.

### Probe

```bash
./scripts/install_g5_runtime.sh probe
```

What `probe` does:
- runs `verify` first
- starts a pinned `linux/amd64` `.NET` SDK container
- mounts `.runtime/engines/g5/current/app` at `/opt/g5` as read-only
- mounts the tracked probe source read-only
- copies both into writable temp directories inside the container
- sets `LD_LIBRARY_PATH` to the writable runtime copy
- runs a tiny `.NET` console probe against the copied runtime

Why the writable copies are required:
- upstream G5 opens `full_stats_list_6max.bin` in a way that fails on a read-only runtime mount
- `dotnet run` needs a writable project directory for build outputs

What `probe` validates:
- `bundle-manifest.json` is present and readable
- `G5Gym.dll` loads from the installed runtime
- managed dependencies resolve from the installed runtime directory
- native dependencies resolve inside Linux Docker
- `PythonAPI(6, 15)` constructs successfully
- a minimal six-max preflop sequence reaches `calculateHeroAction`

Expected probe stages:
- `manifest check`
- `G5Gym.dll load`
- `dependency resolution`
- `PythonAPI construction`
- `createGame`
- `startNewHand`
- `dealHoleCards`
- `calculateHeroAction`

Expected success output looks like:

```text
probe success: actionType=... byAmount=... checkCallEV=... betRaiseEV=... timeSpentSeconds=... message=...
```

`probe` is stronger than `smoke-test`:
- `smoke-test` proves Docker can mount and read the runtime
- `probe` proves the managed/native G5 runtime can initialize and execute one minimal decision path

### Clean

```bash
./scripts/install_g5_runtime.sh clean
```

This removes all local runtime state under `.runtime/engines/g5/`.

## Debugging and Version Matching

For collaborator debugging, the important question is not whether the original bundle lived at the same path. The important question is whether the installed runtime bytes match.

Use these identifiers:
- `bundle_version` from `bundle-manifest.json`
- `bundle_sha256_actual` from `.runtime/engines/g5/metadata/install.json`

The SHA256 value is a **checksum/hash**, not encryption.

If two collaborators report the same:
- `bundle_version`
- `bundle_sha256_actual`
- `platform`

then they are debugging the same installed runtime, even if their original archive paths differ.

When reporting a runtime issue, include:
- the output of `./scripts/install_g5_runtime.sh verify`
- the contents of `.runtime/engines/g5/metadata/install.json`

## Current Tested Bundle Reference

As of `2026-05-03`, this repository does **not** publish a team-owned known-good G5 bundle URL or SHA256.

When your team publishes a bundle, update this section with:
- the exact bundle URL
- the exact SHA256
- the validation timestamp

The documentation is informational only. The installer always uses the operator-supplied `G5_RUNTIME_BUNDLE_URL` and `G5_RUNTIME_BUNDLE_SHA256` values.

## Troubleshooting

### Checksum mismatch
- Confirm the bundle URL points to the expected archive
- Re-copy the SHA256 and avoid truncation or whitespace
- If the upstream artifact changed, publish a new bundle and update the SHA256 used for install

### Missing or malformed manifest
- Ensure the extracted app root contains `bundle-manifest.json`
- Ensure the manifest is valid JSON
- Ensure required manifest fields are present and non-empty

### Missing runtime files
- Ensure the bundle contains the exact paths declared in `required_files`, `managed_assemblies`, and `native_libraries`
- Ensure directory entries such as `PreFlopCharts/` are directories in the final layout

### Docker smoke-test fails
- Start Docker Desktop
- Confirm `docker info` succeeds locally
- On Apple Silicon, let Docker run the `linux/amd64` image under emulation

### Probe fails
- Run `./scripts/install_g5_runtime.sh verify` first and confirm it passes
- If the failure mentions managed or native load, treat it as a runtime bundle or tracked-patch issue, not a probe-app issue
- If the failure mentions a missing stage method or signature mismatch, compare the installed runtime against the pinned G5 source and patch set
- If you want to debug the probe app interactively on the host, install `.NET 8 SDK` and run it manually against a writable runtime copy

### Reinstall a bundle
- Re-run `install` with the new URL/SHA
- The script installs a versioned runtime and repoints `current`
- Run `verify` and then `smoke-test` after reinstall

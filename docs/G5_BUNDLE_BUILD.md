# G5 Bundle Build

This guide builds a reproducible local `linux-x64` G5 runtime bundle that the repo's existing installer can consume.

The builder stops at bundle creation. It does **not** install the bundle automatically and it does **not** add advisor-service wiring, hand replay, or gameplay integration.

## What This Step Produces

Running the builder emits three files into a user-selected output directory:

- `g5-runtime-linux-x64-<bundle_version>.tar.gz`
- `g5-runtime-linux-x64-<bundle_version>.sha256`
- `g5-runtime-linux-x64-<bundle_version>.build.json`

The archive contains an app root with:

- `bundle-manifest.json`
- `full_stats_list_6max.bin`
- `PreFlopEquities.txt`
- `PreFlopCharts/`
- `G5Gym.dll`
- `G5.Logic.dll`
- `DecisionMaking.dll`
- bundled `libtbb.so.*`

## Prerequisites

- macOS host
- Docker Desktop installed and running
- `git`
- `python3`
- `shasum`
- network access to fetch the pinned upstream G5 source

The builder runs in a `linux/amd64` Docker environment even on Apple Silicon hosts.

## Tracked Source Pin

Default source inputs live in [`scripts/g5_runtime_source_pin.json`](/Users/trian/Projects/Poker/scripts/g5_runtime_source_pin.json).

That file tracks:

- upstream repo URL
- pinned source ref and expected commit
- builder platform
- `.NET` target
- bundle entrypoint hint
- ordered patch list
- default bundle-version template

The current tracked upstream ref is the `g5-poker-bot` commit `a2403f558f18f2d1a80effdb4102b3e49bd1e0ff`.

## Tracked Patches

The builder applies repo-tracked patches in the exact order listed in the pin manifest.

Current patch set:

- [`patches/g5/0001-use-portable-preflop-chart-path.patch`](/Users/trian/Projects/Poker/patches/g5/0001-use-portable-preflop-chart-path.patch)
- [`patches/g5/0002-disable-windows-only-g5gym-postbuild.patch`](/Users/trian/Projects/Poker/patches/g5/0002-disable-windows-only-g5gym-postbuild.patch)
- [`patches/g5/0003-add-origin-rpath-to-decisionmaking.patch`](/Users/trian/Projects/Poker/patches/g5/0003-add-origin-rpath-to-decisionmaking.patch)

These patches are part of the reproducible build contract. If the patch list or patch contents change, the derived bundle version changes too.

## Build Command

Default tracked build:

```bash
./scripts/build_g5_runtime_bundle.sh --output-dir ./local-artifacts/g5
```

The output directory is required.

The builder will:

1. clone the pinned upstream G5 source
2. checkout the tracked ref
3. apply tracked local patches
4. build inside a pinned `linux/amd64` Docker image
5. assemble the runtime app root
6. validate the runtime layout against the shared manifest rules
7. package a deterministic tarball
8. write the matching `.sha256` and `.build.json`

## Experimental Overrides

You can override the upstream repo or ref for experiments.

CLI example:

```bash
./scripts/build_g5_runtime_bundle.sh \
  --output-dir ./local-artifacts/g5 \
  --source-repo https://github.com/Nemandza82/g5-poker-bot.git \
  --source-ref some-branch-or-commit
```

Environment example:

```bash
export G5_SOURCE_REF_OVERRIDE="some-branch-or-commit"
./scripts/build_g5_runtime_bundle.sh --output-dir ./local-artifacts/g5
```

Override builds are marked with `source_pin_mode: override` in both the bundle manifest and the sibling `.build.json`.

## Bundle Versioning

By default, the builder derives the bundle version from:

- resolved source commit
- tracked patch-set fingerprint

You can override it manually:

```bash
./scripts/build_g5_runtime_bundle.sh \
  --output-dir ./local-artifacts/g5 \
  --bundle-version my-test-build
```

## Deterministic Packaging

The packaging layer is deterministic.

The builder packages the staged app tree using:

- sorted file order
- normalized owner/group
- normalized timestamps via `SOURCE_DATE_EPOCH`
- `gzip -n` to omit gzip timestamp metadata

By default, `SOURCE_DATE_EPOCH` comes from the resolved upstream source commit timestamp.

You can override it explicitly:

```bash
./scripts/build_g5_runtime_bundle.sh \
  --output-dir ./local-artifacts/g5 \
  --source-date-epoch 1714867200
```

Important distinction:

- deterministic packaging means identical staged app bytes produce the same final archive SHA256
- it does **not** guarantee the upstream G5 compile itself is fully deterministic

## Install the Built Bundle

After a successful build, the script prints the exact `file://...` install commands.

Example:

```bash
export G5_RUNTIME_BUNDLE_URL="file:///absolute/path/to/g5-runtime-linux-x64-<bundle_version>.tar.gz"
export G5_RUNTIME_BUNDLE_SHA256="<sha256>"

./scripts/install_g5_runtime.sh install
./scripts/install_g5_runtime.sh verify
./scripts/install_g5_runtime.sh smoke-test
./scripts/install_g5_runtime.sh probe
docker compose up g5-advisor-service
```

## Output Metadata

The bundle archive contains `bundle-manifest.json` with:

- runtime fields such as `engine`, `platform`, `bundle_version`, `required_files`, `managed_assemblies`, and `native_libraries`
- source/build trace fields such as `source_repo`, `source_ref_requested`, `source_commit_resolved`, `source_pin_mode`, `source_patches_applied`, `builder_image`, `builder_base_image`, `builder_base_image_digest`, `builder_platform`, `builder_dockerfile_sha256`, and `build_script_version`

The sibling `.build.json` mirrors the same source/build trace data and adds:

- output archive filename
- output archive SHA256
- output directory path

## Debugging

When comparing builds across collaborator machines, check:

- `bundle_version`
- `source_commit_resolved`
- `source_pin_mode`
- `source_patches_applied`
- output archive SHA256

If the source/build metadata matches but the final SHA differs, treat that as upstream build nondeterminism, not packaging nondeterminism.

## Failure Modes

### Docker is unavailable

The builder fails before cloning or compiling if Docker Desktop is missing or not running.

### Upstream ref changed unexpectedly

Tracked builds compare the resolved commit to `source_commit_expected` from the pin manifest and fail on mismatch.

### A tracked patch does not apply

The builder fails before compiling.

### Required runtime files are missing

The builder validates the staged app root before packaging. Missing required files, managed assemblies, or native libraries abort the build.

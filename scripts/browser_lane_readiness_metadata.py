"""CLI entrypoint for emitting queue-readiness metadata artifacts."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from scripts.browser_lane_readiness import (
    HEAVY_JOB_NAME,
    QUEUE_PR_JOB_NAME,
    build_queue_metadata_from_mode_root,
    write_json_file,
)


def main() -> int:
    """Write one queue-readiness metadata JSON file for the requested mode."""
    parser = argparse.ArgumentParser(
        description="Emit queue readiness metadata from local browser artifacts"
    )
    parser.add_argument("--mode", choices=[QUEUE_PR_JOB_NAME, HEAVY_JOB_NAME], required=True)
    parser.add_argument("--artifact-root", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    payload = build_queue_metadata_from_mode_root(Path(args.artifact_root), args.mode)
    write_json_file(Path(args.output), payload)

    if payload["metadata_error"]:
        print(
            f"warning: mode={args.mode} artifact_root={args.artifact_root} {payload['metadata_error']}",
            file=sys.stderr,
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

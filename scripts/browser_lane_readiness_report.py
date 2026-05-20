"""CLI entrypoint for the browser lane readiness report."""

from __future__ import annotations

import argparse
import json
import sys

from scripts.browser_lane_readiness import (
    CLI_ERROR_EXIT_CODE,
    DEFAULT_REPORT_LIMIT,
    collect_queue_samples,
    evaluate_readiness,
    render_text_report,
)


def main() -> int:
    """Print the readiness report and optionally fail when the lane is not ready."""
    parser = argparse.ArgumentParser(
        description="Report whether the queue browser lane is ready to become required"
    )
    parser.add_argument("--repo", default=None)
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_REPORT_LIMIT,
        help="Raw Gameplay Tests workflow-run fetch limit before filtering to eligible samples.",
    )
    parser.add_argument("--json", action="store_true", dest="json_output")
    parser.add_argument("--require-merge-group-sample", action="store_true")
    parser.add_argument("--fail-if-not-ready", action="store_true")
    args = parser.parse_args()

    try:
        pr_samples, heavy_samples = collect_queue_samples(limit=args.limit, repo=args.repo)
        evaluation = evaluate_readiness(
            pr_samples,
            heavy_samples,
            require_merge_group_sample=args.require_merge_group_sample,
        )

        if args.json_output:
            print(json.dumps(evaluation, indent=2, sort_keys=True, default=str))
        else:
            print(render_text_report(evaluation))

        if args.fail_if_not_ready and not evaluation["ready_to_require"]:
            return 1
        return 0
    except Exception as exc:
        print(f"error: browser lane readiness report failed: {exc}", file=sys.stderr)
        return CLI_ERROR_EXIT_CODE


if __name__ == "__main__":
    raise SystemExit(main())

"""Shared helpers for browser lane readiness metadata and evaluation."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
QUEUE_SCENARIO_NAME = "full table queue promotion reserves buy-in, promotes, and rejoins"
QUEUE_SCENARIO_SLUG = "full-table-queue-promotion-reserves-buy-in-promotes-and-rejoins"
QUEUE_PR_JOB_NAME = "compose-browser-queue-pr"
HEAVY_JOB_NAME = "compose-browser-e2e"


def missing_metadata_payload(mode: str, error_text: str) -> dict[str, Any]:
    """Create a synthetic red metadata payload for extraction or download failures."""
    return {
        "schema_version": SCHEMA_VERSION,
        "mode": mode,
        "run_dir_name": None,
        "compose_teardown_succeeded": None,
        "metadata_error": error_text,
        "queue_summary": {
            "found": False,
            "scenario": QUEUE_SCENARIO_NAME,
            "status": None,
            "error": None,
            "cleanup_attempted": None,
            "cleanup_succeeded": None,
            "cleanup_error": None,
            "promotion_observed_at": None,
            "banner_observed_at": None,
            "phase_timings": {},
            "scenario_duration_seconds": None,
        },
    }


def latest_timestamp_dir(root: Path) -> Path:
    """Return the newest timestamp-named run directory under a mode root."""
    if not root.exists():
        raise FileNotFoundError(f"Mode root does not exist: {root}")
    candidates = sorted(path for path in root.iterdir() if path.is_dir())
    if not candidates:
        raise FileNotFoundError(f"No run directories found under {root}")
    return candidates[-1]


def read_json_object(path: Path) -> dict[str, Any]:
    """Read a UTF-8 JSON object from disk."""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object in {path}")
    return payload


def write_json_file(path: Path, payload: dict[str, Any]) -> None:
    """Write a stable JSON object for machine consumption and test assertions."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def read_compose_teardown_status(path: Path) -> bool | None:
    """Parse the compose teardown sentinel file into true/false/unknown."""
    if not path.exists():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip() == "compose_teardown_succeeded=true":
            return True
        if line.strip() == "compose_teardown_succeeded=false":
            return False
    return None


def scenario_duration_seconds(phase_timings: Any) -> float | None:
    """Sum scenario phase timings into a single rounded duration."""
    if phase_timings is None:
        return None
    if not isinstance(phase_timings, dict):
        raise ValueError(
            f"Invalid phase_timings payload: expected object, got {type(phase_timings).__name__}"
        )
    if not phase_timings:
        return None
    try:
        values = [float(value) for value in phase_timings.values()]
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid phase_timings values: {phase_timings}") from exc
    return round(sum(values), 3)


def cleanup_summary(cleanup_payload: Any) -> dict[str, Any]:
    """Validate and normalize the queue summary cleanup payload."""
    if cleanup_payload is None:
        return {}
    if not isinstance(cleanup_payload, dict):
        raise ValueError(
            f"Invalid cleanup payload: expected object, got {type(cleanup_payload).__name__}"
        )
    return cleanup_payload


def build_queue_metadata_from_run_dir(run_dir: Path, mode: str) -> dict[str, Any]:
    """Build readiness metadata from one gameplay artifact run directory."""
    teardown_succeeded = read_compose_teardown_status(run_dir / "compose-teardown-status.txt")
    metadata = missing_metadata_payload(mode, error_text="")
    metadata["run_dir_name"] = run_dir.name
    metadata["compose_teardown_succeeded"] = teardown_succeeded
    metadata["metadata_error"] = None

    summary_paths = sorted(
        path for path in run_dir.rglob("summary.json") if path.parent.name == QUEUE_SCENARIO_SLUG
    )
    if not summary_paths:
        metadata["metadata_error"] = f"Queue scenario summary not found under {run_dir}"
        return metadata

    try:
        summary_payload = read_json_object(summary_paths[0])
        if summary_payload.get("scenario") != QUEUE_SCENARIO_NAME:
            metadata["metadata_error"] = (
                f"Queue scenario summary did not match expected scenario in {summary_paths[0]}"
            )
            return metadata
        cleanup = cleanup_summary(summary_payload.get("cleanup"))
        phase_timings = summary_payload.get("phase_timings")
        scenario_duration = scenario_duration_seconds(phase_timings)
    except ValueError as exc:
        metadata["metadata_error"] = str(exc)
        return metadata

    queue_summary = metadata["queue_summary"]
    queue_summary["found"] = True
    queue_summary["status"] = summary_payload.get("status")
    queue_summary["error"] = summary_payload.get("error")
    queue_summary["cleanup_attempted"] = cleanup.get("attempted")
    queue_summary["cleanup_succeeded"] = cleanup.get("succeeded")
    queue_summary["cleanup_error"] = cleanup.get("error")
    queue_summary["promotion_observed_at"] = summary_payload.get("promotion_observed_at")
    queue_summary["banner_observed_at"] = summary_payload.get("banner_observed_at")
    queue_summary["phase_timings"] = phase_timings or {}
    queue_summary["scenario_duration_seconds"] = scenario_duration
    return metadata


def build_queue_metadata_from_mode_root(mode_root: Path, mode: str) -> dict[str, Any]:
    """Build readiness metadata from the newest run directory for one mode."""
    try:
        return build_queue_metadata_from_run_dir(latest_timestamp_dir(mode_root), mode)
    except FileNotFoundError as exc:
        return missing_metadata_payload(mode, str(exc))

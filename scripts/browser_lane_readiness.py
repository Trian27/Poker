"""Shared helpers for browser lane readiness metadata and evaluation."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import statistics
from typing import Any

SCHEMA_VERSION = 1
QUEUE_SCENARIO_NAME = "full table queue promotion reserves buy-in, promotes, and rejoins"
QUEUE_SCENARIO_SLUG = "full-table-queue-promotion-reserves-buy-in-promotes-and-rejoins"
QUEUE_PR_JOB_NAME = "compose-browser-queue-pr"
HEAVY_JOB_NAME = "compose-browser-e2e"
REQUIRED_GREEN_STREAK = 10
MAX_PR_MEDIAN_JOB_DURATION_SECONDS = 720.0
MAX_PR_P95_JOB_DURATION_SECONDS = 1080.0
MAX_HEAVY_MEDIAN_QUEUE_DURATION_SECONDS = 720.0
MAX_HEAVY_P95_QUEUE_DURATION_SECONDS = 1080.0
MIN_STREAK_SPAN_DAYS = 3.0


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


def parse_iso8601(value: str | None) -> datetime | None:
    """Parse an ISO 8601 UTC timestamp from GitHub JSON payloads."""
    if value is None:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


@dataclass(frozen=True)
class WorkflowJobInfo:
    """Normalized GitHub Actions job timing and identity information."""

    run_id: int
    run_attempt: int
    created_at: datetime
    event: str
    head_branch: str
    job_name: str
    job_conclusion: str
    job_started_at: datetime | None
    job_completed_at: datetime | None

    @property
    def job_duration_seconds(self) -> float | None:
        """Return job runtime in seconds when both timestamps are available."""
        if self.job_started_at is None or self.job_completed_at is None:
            return None
        return round((self.job_completed_at - self.job_started_at).total_seconds(), 3)


@dataclass(frozen=True)
class QueueLaneSample:
    """One classified queue-lane sample used for readiness calculations."""

    lane: str
    run_id: int
    run_attempt: int
    created_at: datetime
    event: str
    head_branch: str
    job_name: str
    job_conclusion: str
    queue_summary_status: str | None
    cleanup_succeeded: bool | None
    compose_teardown_succeeded: bool | None
    metadata_error: str | None
    scenario_duration_seconds: float | None
    job_duration_seconds: float | None

    @property
    def is_green(self) -> bool:
        """Return whether this sample satisfies the lane-specific green criteria."""
        # Heavy e2e is multi-scenario. A failed heavy job can still be queue-green
        # when the queue scenario passed and cleanup/teardown also succeeded.
        shared_checks = (
            self.queue_summary_status == "passed"
            and self.cleanup_succeeded is True
            and self.compose_teardown_succeeded is True
            and self.metadata_error is None
        )
        if self.job_name == QUEUE_PR_JOB_NAME:
            return self.job_conclusion == "success" and shared_checks
        return shared_checks


def classify_pr_queue_sample(job: WorkflowJobInfo, metadata: dict[str, Any]) -> QueueLaneSample | None:
    """Convert one PR queue job plus metadata into a report sample."""
    if job.job_conclusion == "skipped":
        return None
    queue_summary = metadata.get("queue_summary") or {}
    return QueueLaneSample(
        lane="pr_queue_shadow",
        run_id=job.run_id,
        run_attempt=job.run_attempt,
        created_at=job.created_at,
        event=job.event,
        head_branch=job.head_branch,
        job_name=job.job_name,
        job_conclusion=job.job_conclusion,
        queue_summary_status=queue_summary.get("status"),
        cleanup_succeeded=queue_summary.get("cleanup_succeeded"),
        compose_teardown_succeeded=metadata.get("compose_teardown_succeeded"),
        metadata_error=metadata.get("metadata_error"),
        scenario_duration_seconds=queue_summary.get("scenario_duration_seconds"),
        job_duration_seconds=job.job_duration_seconds,
    )


def classify_heavy_queue_sample(job: WorkflowJobInfo, metadata: dict[str, Any]) -> QueueLaneSample | None:
    """Convert one heavy queue job plus metadata into a report sample."""
    if job.job_conclusion == "skipped":
        return None
    queue_summary = metadata.get("queue_summary") or {}
    return QueueLaneSample(
        lane="heavy_queue",
        run_id=job.run_id,
        run_attempt=job.run_attempt,
        created_at=job.created_at,
        event=job.event,
        head_branch=job.head_branch,
        job_name=job.job_name,
        job_conclusion=job.job_conclusion,
        queue_summary_status=queue_summary.get("status"),
        cleanup_succeeded=queue_summary.get("cleanup_succeeded"),
        compose_teardown_succeeded=metadata.get("compose_teardown_succeeded"),
        metadata_error=metadata.get("metadata_error"),
        scenario_duration_seconds=queue_summary.get("scenario_duration_seconds"),
        job_duration_seconds=job.job_duration_seconds,
    )


def consecutive_green_streak(samples: list[QueueLaneSample | None]) -> int:
    """Count the newest consecutive green samples and stop at the first red sample."""
    streak = 0
    filtered = [sample for sample in samples if sample is not None]
    for sample in sorted(filtered, key=lambda item: item.created_at, reverse=True):
        if not sample.is_green:
            break
        streak += 1
    return streak


def percentile(values: list[float], pct: int) -> float | None:
    """Return a simple nearest-rank percentile for a non-empty numeric list."""
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    rank = math.ceil((pct / 100) * len(ordered)) - 1
    bounded_rank = max(0, min(rank, len(ordered) - 1))
    return float(ordered[bounded_rank])


def median(values: list[float]) -> float | None:
    """Return the standard median for a numeric list."""
    if not values:
        return None
    return float(statistics.median(values))


def span_days(samples: list[QueueLaneSample]) -> float:
    """Return the elapsed day span between the oldest and newest sample."""
    if len(samples) < 2:
        return 0.0
    ordered = sorted(samples, key=lambda item: item.created_at)
    return round((ordered[-1].created_at - ordered[0].created_at).total_seconds() / 86400, 3)


def failure_breakdown(samples: list[QueueLaneSample]) -> dict[str, int]:
    """Break red samples down by metadata, cleanup, teardown, and other failure buckets."""
    metadata_failures = 0
    cleanup_failures = 0
    teardown_failures = 0
    other_failures = 0
    for sample in samples:
        if sample.is_green:
            continue
        if sample.metadata_error is not None:
            metadata_failures += 1
        elif sample.cleanup_succeeded is False:
            cleanup_failures += 1
        elif sample.compose_teardown_succeeded is False:
            teardown_failures += 1
        else:
            other_failures += 1
    return {
        "metadata_failures": metadata_failures,
        "cleanup_failures": cleanup_failures,
        "teardown_failures": teardown_failures,
        "other_failures": other_failures,
    }


def most_recent_red_sample(samples: list[QueueLaneSample]) -> dict[str, Any] | None:
    """Return a concise summary of the newest red sample, if one exists."""
    red_samples = [
        sample
        for sample in sorted(samples, key=lambda item: item.created_at, reverse=True)
        if not sample.is_green
    ]
    if not red_samples:
        return None
    sample = red_samples[0]
    return {
        "run_id": sample.run_id,
        "run_attempt": sample.run_attempt,
        "event": sample.event,
        "job_conclusion": sample.job_conclusion,
        "queue_summary_status": sample.queue_summary_status,
        "metadata_error": sample.metadata_error,
        "cleanup_succeeded": sample.cleanup_succeeded,
        "compose_teardown_succeeded": sample.compose_teardown_succeeded,
    }


def take_green_prefix(samples: list[QueueLaneSample]) -> list[QueueLaneSample]:
    """Return the newest consecutive green samples in descending time order."""
    green_prefix: list[QueueLaneSample] = []
    for sample in sorted(samples, key=lambda item: item.created_at, reverse=True):
        if not sample.is_green:
            break
        green_prefix.append(sample)
    return green_prefix


def evaluate_readiness(
    pr_samples: list[QueueLaneSample | None],
    heavy_samples: list[QueueLaneSample | None],
    *,
    require_merge_group_sample: bool = False,
) -> dict[str, Any]:
    """Evaluate whether queue PR shadow and heavy soak satisfy promotion gates."""
    filtered_pr = [sample for sample in pr_samples if sample is not None]
    filtered_heavy = [sample for sample in heavy_samples if sample is not None]

    pr_green_prefix = take_green_prefix(filtered_pr)
    heavy_green_prefix = take_green_prefix(filtered_heavy)

    pr_job_durations = [
        sample.job_duration_seconds
        for sample in pr_green_prefix
        if sample.job_duration_seconds is not None
    ]
    heavy_queue_durations = [
        sample.scenario_duration_seconds
        for sample in heavy_green_prefix
        if sample.scenario_duration_seconds is not None
    ]
    merge_group_samples = sum(1 for sample in pr_green_prefix if sample.event == "merge_group")
    missing_pr_job_duration_count = sum(1 for sample in pr_green_prefix if sample.job_duration_seconds is None)
    missing_heavy_queue_duration_count = sum(
        1 for sample in heavy_green_prefix if sample.scenario_duration_seconds is None
    )

    pr_stats = {
        "sample_count": len(filtered_pr),
        "green_streak": len(pr_green_prefix),
        "median_job_duration_seconds": median(pr_job_durations),
        "p95_job_duration_seconds": percentile(pr_job_durations, 95),
        "missing_job_duration_count": missing_pr_job_duration_count,
        "span_days": span_days(pr_green_prefix),
        "merge_group_samples_in_streak": merge_group_samples,
        "most_recent_red_sample": most_recent_red_sample(filtered_pr),
        **failure_breakdown(filtered_pr),
    }
    heavy_stats = {
        "sample_count": len(filtered_heavy),
        "green_streak": len(heavy_green_prefix),
        "median_queue_duration_seconds": median(heavy_queue_durations),
        "p95_queue_duration_seconds": percentile(heavy_queue_durations, 95),
        "missing_queue_duration_count": missing_heavy_queue_duration_count,
        "span_days": span_days(heavy_green_prefix),
        "most_recent_red_sample": most_recent_red_sample(filtered_heavy),
        **failure_breakdown(filtered_heavy),
    }

    reasons: list[str] = []
    if pr_stats["green_streak"] < REQUIRED_GREEN_STREAK:
        reasons.append(f"PR queue shadow streak is {pr_stats['green_streak']}, need {REQUIRED_GREEN_STREAK}")
    if heavy_stats["green_streak"] < REQUIRED_GREEN_STREAK:
        reasons.append(f"Heavy queue streak is {heavy_stats['green_streak']}, need {REQUIRED_GREEN_STREAK}")
    if pr_stats["green_streak"] >= REQUIRED_GREEN_STREAK:
        if pr_stats["missing_job_duration_count"] > 0:
            reasons.append("PR queue shadow streak has samples with missing job duration data")
        if (
            pr_stats["median_job_duration_seconds"] is None
            or pr_stats["median_job_duration_seconds"] >= MAX_PR_MEDIAN_JOB_DURATION_SECONDS
        ):
            reasons.append(
                f"PR queue shadow median job duration is not under {MAX_PR_MEDIAN_JOB_DURATION_SECONDS:.0f} seconds"
            )
        if (
            pr_stats["p95_job_duration_seconds"] is None
            or pr_stats["p95_job_duration_seconds"] >= MAX_PR_P95_JOB_DURATION_SECONDS
        ):
            reasons.append(
                f"PR queue shadow p95 job duration is not under {MAX_PR_P95_JOB_DURATION_SECONDS:.0f} seconds"
            )
        if pr_stats["span_days"] < MIN_STREAK_SPAN_DAYS:
            reasons.append(f"PR queue shadow streak does not span at least {MIN_STREAK_SPAN_DAYS:.1f} days")
    if heavy_stats["green_streak"] >= REQUIRED_GREEN_STREAK:
        if heavy_stats["missing_queue_duration_count"] > 0:
            reasons.append("Heavy queue streak has samples with missing queue scenario duration data")
        if (
            heavy_stats["median_queue_duration_seconds"] is None
            or heavy_stats["median_queue_duration_seconds"] >= MAX_HEAVY_MEDIAN_QUEUE_DURATION_SECONDS
        ):
            reasons.append(
                f"Heavy queue median scenario duration is not under {MAX_HEAVY_MEDIAN_QUEUE_DURATION_SECONDS:.0f} seconds"
            )
        if (
            heavy_stats["p95_queue_duration_seconds"] is None
            or heavy_stats["p95_queue_duration_seconds"] >= MAX_HEAVY_P95_QUEUE_DURATION_SECONDS
        ):
            reasons.append(
                f"Heavy queue p95 scenario duration is not under {MAX_HEAVY_P95_QUEUE_DURATION_SECONDS:.0f} seconds"
            )
        if heavy_stats["span_days"] < MIN_STREAK_SPAN_DAYS:
            reasons.append(f"Heavy queue streak does not span at least {MIN_STREAK_SPAN_DAYS:.1f} days")
    if require_merge_group_sample and merge_group_samples < 1:
        reasons.append("No merge_group sample is present in the PR queue shadow streak")

    return {
        "ready_to_require": len(reasons) == 0,
        "reasons": reasons,
        "pr_queue_shadow": pr_stats,
        "heavy_queue": heavy_stats,
    }


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

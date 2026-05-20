from pathlib import Path
import json
import subprocess
import sys

from scripts.browser_lane_readiness import (
    QUEUE_SCENARIO_NAME,
    WorkflowJobInfo,
    build_queue_metadata_from_mode_root,
    classify_heavy_queue_sample,
    classify_pr_queue_sample,
    consecutive_green_streak,
    evaluate_readiness,
    parse_iso8601,
)

REPO_ROOT = Path(__file__).resolve().parents[1]


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def queue_summary_payload(mode: str, status: str = "passed") -> dict:
    return {
        "mode": mode,
        "scenario": QUEUE_SCENARIO_NAME,
        "status": status,
        "error": None,
        "cleanup": {
            "attempted": True,
            "succeeded": True,
            "error": None,
        },
        "promotion_observed_at": "2026-05-17T18:00:40.779Z",
        "banner_observed_at": "2026-05-17T18:00:43.652Z",
        "phase_timings": {
            "preflight": 0.5,
            "fixture_create": 1.0,
            "browser_login": 0.5,
        },
    }


def test_build_queue_metadata_for_queue_pr_success(tmp_path: Path) -> None:
    mode_root = tmp_path / "logs" / "compose-browser-queue-pr"
    run_dir = mode_root / "20260517-135954"
    scenario_dir = run_dir / "full-table-queue-promotion-reserves-buy-in-promotes-and-rejoins"
    scenario_dir.mkdir(parents=True)
    (run_dir / "compose-teardown-status.txt").write_text(
        "compose_teardown_succeeded=true\n",
        encoding="utf-8",
    )
    write_json(scenario_dir / "summary.json", queue_summary_payload("compose-browser-queue-pr"))

    metadata = build_queue_metadata_from_mode_root(mode_root, "compose-browser-queue-pr")

    assert metadata["mode"] == "compose-browser-queue-pr"
    assert metadata["compose_teardown_succeeded"] is True
    assert metadata["metadata_error"] is None
    assert metadata["queue_summary"]["found"] is True
    assert metadata["queue_summary"]["status"] == "passed"
    assert metadata["queue_summary"]["scenario_duration_seconds"] == 2.0


def test_build_queue_metadata_for_heavy_run_selects_queue_summary(tmp_path: Path) -> None:
    mode_root = tmp_path / "logs" / "compose-browser-e2e"
    run_dir = mode_root / "20260516-193331"
    happy_path_dir = run_dir / "happy-path-joins-through-lobby-completes-a-real-hand-and-cleans-up"
    queue_dir = run_dir / "full-table-queue-promotion-reserves-buy-in-promotes-and-rejoins"
    happy_path_dir.mkdir(parents=True)
    queue_dir.mkdir(parents=True)
    (run_dir / "compose-teardown-status.txt").write_text(
        "compose_teardown_succeeded=true\n",
        encoding="utf-8",
    )
    write_json(
        happy_path_dir / "summary.json",
        {
            "mode": "compose-browser-e2e",
            "scenario": "happy path joins through lobby, completes a real hand, and cleans up",
            "status": "passed",
            "cleanup": {"attempted": True, "succeeded": True, "error": None},
            "phase_timings": {"preflight": 1.0},
        },
    )
    write_json(queue_dir / "summary.json", queue_summary_payload("compose-browser-e2e"))

    metadata = build_queue_metadata_from_mode_root(mode_root, "compose-browser-e2e")

    assert metadata["mode"] == "compose-browser-e2e"
    assert metadata["queue_summary"]["scenario"] == QUEUE_SCENARIO_NAME
    assert metadata["queue_summary"]["status"] == "passed"
    assert metadata["queue_summary"]["found"] is True


def test_build_queue_metadata_ignores_malformed_non_queue_summary(tmp_path: Path) -> None:
    mode_root = tmp_path / "logs" / "compose-browser-e2e"
    run_dir = mode_root / "20260516-193332"
    happy_path_dir = run_dir / "happy-path-joins-through-lobby-completes-a-real-hand-and-cleans-up"
    queue_dir = run_dir / "full-table-queue-promotion-reserves-buy-in-promotes-and-rejoins"
    happy_path_dir.mkdir(parents=True)
    queue_dir.mkdir(parents=True)
    (run_dir / "compose-teardown-status.txt").write_text(
        "compose_teardown_succeeded=true\n",
        encoding="utf-8",
    )
    (happy_path_dir / "summary.json").write_text("{not-json", encoding="utf-8")
    write_json(queue_dir / "summary.json", queue_summary_payload("compose-browser-e2e"))

    metadata = build_queue_metadata_from_mode_root(mode_root, "compose-browser-e2e")

    assert metadata["metadata_error"] is None
    assert metadata["run_dir_name"] == "20260516-193332"
    assert metadata["compose_teardown_succeeded"] is True
    assert metadata["queue_summary"]["found"] is True
    assert metadata["queue_summary"]["status"] == "passed"


def test_build_queue_metadata_for_invalid_cleanup_payload_returns_red_metadata(tmp_path: Path) -> None:
    mode_root = tmp_path / "logs" / "compose-browser-queue-pr"
    run_dir = mode_root / "20260517-140002"
    scenario_dir = run_dir / "full-table-queue-promotion-reserves-buy-in-promotes-and-rejoins"
    scenario_dir.mkdir(parents=True)
    (run_dir / "compose-teardown-status.txt").write_text(
        "compose_teardown_succeeded=true\n",
        encoding="utf-8",
    )
    write_json(
        scenario_dir / "summary.json",
        {
            "mode": "compose-browser-queue-pr",
            "scenario": QUEUE_SCENARIO_NAME,
            "status": "passed",
            "cleanup": [1],
            "phase_timings": {"preflight": 0.5},
        },
    )

    metadata = build_queue_metadata_from_mode_root(mode_root, "compose-browser-queue-pr")

    assert metadata["queue_summary"]["found"] is False
    assert metadata["run_dir_name"] == "20260517-140002"
    assert metadata["compose_teardown_succeeded"] is True
    assert "Invalid cleanup payload" in metadata["metadata_error"]


def test_build_queue_metadata_for_non_dict_phase_timings_returns_red_metadata(tmp_path: Path) -> None:
    mode_root = tmp_path / "logs" / "compose-browser-queue-pr"
    run_dir = mode_root / "20260517-140003"
    scenario_dir = run_dir / "full-table-queue-promotion-reserves-buy-in-promotes-and-rejoins"
    scenario_dir.mkdir(parents=True)
    (run_dir / "compose-teardown-status.txt").write_text(
        "compose_teardown_succeeded=true\n",
        encoding="utf-8",
    )
    write_json(
        scenario_dir / "summary.json",
        {
            "mode": "compose-browser-queue-pr",
            "scenario": QUEUE_SCENARIO_NAME,
            "status": "passed",
            "cleanup": {"attempted": True, "succeeded": True, "error": None},
            "phase_timings": [],
        },
    )

    metadata = build_queue_metadata_from_mode_root(mode_root, "compose-browser-queue-pr")

    assert metadata["queue_summary"]["found"] is False
    assert metadata["run_dir_name"] == "20260517-140003"
    assert metadata["compose_teardown_succeeded"] is True
    assert "Invalid phase_timings payload" in metadata["metadata_error"]


def test_build_queue_metadata_surfaces_missing_summary_without_crashing(tmp_path: Path) -> None:
    mode_root = tmp_path / "logs" / "compose-browser-e2e"
    run_dir = mode_root / "20260516-204113"
    run_dir.mkdir(parents=True)
    (run_dir / "compose-teardown-status.txt").write_text(
        "compose_teardown_succeeded=false\n",
        encoding="utf-8",
    )

    metadata = build_queue_metadata_from_mode_root(mode_root, "compose-browser-e2e")

    assert metadata["compose_teardown_succeeded"] is False
    assert metadata["queue_summary"]["found"] is False
    assert "Queue scenario summary not found" in metadata["metadata_error"]


def test_metadata_cli_writes_queue_readiness_json(tmp_path: Path) -> None:
    mode_root = tmp_path / "logs" / "compose-browser-queue-pr"
    run_dir = mode_root / "20260517-135954"
    scenario_dir = run_dir / "full-table-queue-promotion-reserves-buy-in-promotes-and-rejoins"
    scenario_dir.mkdir(parents=True)
    (run_dir / "compose-teardown-status.txt").write_text(
        "compose_teardown_succeeded=true\n",
        encoding="utf-8",
    )
    write_json(scenario_dir / "summary.json", queue_summary_payload("compose-browser-queue-pr"))

    output_path = tmp_path / "queue-readiness-metadata.json"
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "scripts.browser_lane_readiness_metadata",
            "--mode",
            "compose-browser-queue-pr",
            "--artifact-root",
            str(mode_root),
            "--output",
            str(output_path),
        ],
        check=False,
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )

    assert result.returncode == 0
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["mode"] == "compose-browser-queue-pr"
    assert payload["queue_summary"]["status"] == "passed"


def test_metadata_cli_writes_red_metadata_for_missing_mode_root(tmp_path: Path) -> None:
    mode_root = tmp_path / "logs" / "compose-browser-e2e"
    output_path = tmp_path / "queue-readiness-metadata.json"

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "scripts.browser_lane_readiness_metadata",
            "--mode",
            "compose-browser-e2e",
            "--artifact-root",
            str(mode_root),
            "--output",
            str(output_path),
        ],
        check=False,
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )

    assert result.returncode == 0
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    assert payload["mode"] == "compose-browser-e2e"
    assert payload["queue_summary"]["found"] is False
    assert "Mode root does not exist" in payload["metadata_error"]


def test_build_queue_metadata_for_missing_mode_root_returns_red_metadata(tmp_path: Path) -> None:
    mode_root = tmp_path / "logs" / "compose-browser-queue-pr"

    metadata = build_queue_metadata_from_mode_root(mode_root, "compose-browser-queue-pr")

    assert metadata["mode"] == "compose-browser-queue-pr"
    assert metadata["queue_summary"]["found"] is False
    assert "Mode root does not exist" in metadata["metadata_error"]


def test_build_queue_metadata_for_invalid_summary_json_returns_red_metadata(tmp_path: Path) -> None:
    mode_root = tmp_path / "logs" / "compose-browser-e2e"
    run_dir = mode_root / "20260516-204113"
    queue_dir = run_dir / "full-table-queue-promotion-reserves-buy-in-promotes-and-rejoins"
    queue_dir.mkdir(parents=True)
    (run_dir / "compose-teardown-status.txt").write_text(
        "compose_teardown_succeeded=true\n",
        encoding="utf-8",
    )
    (queue_dir / "summary.json").write_text("{not-json", encoding="utf-8")

    metadata = build_queue_metadata_from_mode_root(mode_root, "compose-browser-e2e")

    assert metadata["mode"] == "compose-browser-e2e"
    assert metadata["queue_summary"]["found"] is False
    assert metadata["run_dir_name"] == "20260516-204113"
    assert metadata["compose_teardown_succeeded"] is True
    assert "Invalid JSON" in metadata["metadata_error"]


def test_build_queue_metadata_for_non_object_summary_returns_red_metadata(tmp_path: Path) -> None:
    mode_root = tmp_path / "logs" / "compose-browser-e2e"
    run_dir = mode_root / "20260516-204114"
    queue_dir = run_dir / "full-table-queue-promotion-reserves-buy-in-promotes-and-rejoins"
    queue_dir.mkdir(parents=True)
    (run_dir / "compose-teardown-status.txt").write_text(
        "compose_teardown_succeeded=false\n",
        encoding="utf-8",
    )
    (queue_dir / "summary.json").write_text('["not", "an", "object"]', encoding="utf-8")

    metadata = build_queue_metadata_from_mode_root(mode_root, "compose-browser-e2e")

    assert metadata["mode"] == "compose-browser-e2e"
    assert metadata["queue_summary"]["found"] is False
    assert metadata["run_dir_name"] == "20260516-204114"
    assert metadata["compose_teardown_succeeded"] is False
    assert "Expected JSON object" in metadata["metadata_error"]


def test_build_queue_metadata_for_invalid_phase_timings_returns_red_metadata(tmp_path: Path) -> None:
    mode_root = tmp_path / "logs" / "compose-browser-queue-pr"
    run_dir = mode_root / "20260517-140001"
    scenario_dir = run_dir / "full-table-queue-promotion-reserves-buy-in-promotes-and-rejoins"
    scenario_dir.mkdir(parents=True)
    (run_dir / "compose-teardown-status.txt").write_text(
        "compose_teardown_succeeded=true\n",
        encoding="utf-8",
    )
    write_json(
        scenario_dir / "summary.json",
        {
            "mode": "compose-browser-queue-pr",
            "scenario": QUEUE_SCENARIO_NAME,
            "status": "passed",
            "cleanup": {"attempted": True, "succeeded": True, "error": None},
            "phase_timings": {"preflight": "not-a-number"},
        },
    )

    metadata = build_queue_metadata_from_mode_root(mode_root, "compose-browser-queue-pr")

    assert metadata["mode"] == "compose-browser-queue-pr"
    assert metadata["queue_summary"]["found"] is False
    assert metadata["run_dir_name"] == "20260517-140001"
    assert metadata["compose_teardown_succeeded"] is True
    assert "Invalid phase_timings" in metadata["metadata_error"]


def make_job_info(
    run_id: int,
    *,
    event: str,
    head_branch: str,
    job_name: str,
    conclusion: str,
    created_at: str,
    started_at: str,
    completed_at: str | None,
) -> WorkflowJobInfo:
    return WorkflowJobInfo(
        run_id=run_id,
        run_attempt=1,
        created_at=parse_iso8601(created_at),
        event=event,
        head_branch=head_branch,
        job_name=job_name,
        job_conclusion=conclusion,
        job_started_at=parse_iso8601(started_at),
        job_completed_at=parse_iso8601(completed_at),
    )


def test_classify_pr_queue_sample_ignores_skipped_jobs() -> None:
    job = make_job_info(
        100,
        event="pull_request",
        head_branch="feature-branch",
        job_name="compose-browser-queue-pr",
        conclusion="skipped",
        created_at="2026-05-19T16:54:28Z",
        started_at="2026-05-19T16:56:31Z",
        completed_at="2026-05-19T16:56:31Z",
    )
    metadata = {
        "compose_teardown_succeeded": None,
        "metadata_error": None,
        "queue_summary": {
            "status": None,
            "cleanup_succeeded": None,
            "scenario_duration_seconds": None,
        },
    }

    assert classify_pr_queue_sample(job, metadata) is None


def test_heavy_sample_can_be_green_when_the_job_failed_but_queue_passed() -> None:
    job = make_job_info(
        101,
        event="schedule",
        head_branch="main",
        job_name="compose-browser-e2e",
        conclusion="failure",
        created_at="2026-05-18T12:29:16Z",
        started_at="2026-05-18T12:29:16Z",
        completed_at="2026-05-18T13:05:16Z",
    )
    metadata = {
        "compose_teardown_succeeded": True,
        "metadata_error": None,
        "queue_summary": {
            "found": True,
            "status": "passed",
            "error": None,
            "cleanup_succeeded": True,
            "cleanup_error": None,
            "scenario_duration_seconds": 8.5,
        },
    }

    sample = classify_heavy_queue_sample(job, metadata)

    assert sample is not None
    assert sample.job_conclusion == "failure"
    assert sample.queue_summary_status == "passed"
    assert sample.is_green is True


def test_heavy_sample_is_red_when_queue_status_failed() -> None:
    job = make_job_info(
        102,
        event="schedule",
        head_branch="main",
        job_name="compose-browser-e2e",
        conclusion="success",
        created_at="2026-05-18T12:29:16Z",
        started_at="2026-05-18T12:29:16Z",
        completed_at="2026-05-18T13:05:16Z",
    )
    sample = classify_heavy_queue_sample(
        job,
        {
            "compose_teardown_succeeded": True,
            "metadata_error": None,
            "queue_summary": {
                "found": True,
                "status": "failed",
                "error": "queue broke",
                "cleanup_succeeded": True,
                "cleanup_error": None,
                "scenario_duration_seconds": 8.5,
            },
        },
    )

    assert sample is not None
    assert sample.is_green is False


def test_heavy_sample_is_red_when_cleanup_failed() -> None:
    job = make_job_info(
        103,
        event="schedule",
        head_branch="main",
        job_name="compose-browser-e2e",
        conclusion="success",
        created_at="2026-05-18T12:29:16Z",
        started_at="2026-05-18T12:29:16Z",
        completed_at="2026-05-18T13:05:16Z",
    )
    sample = classify_heavy_queue_sample(
        job,
        {
            "compose_teardown_succeeded": True,
            "metadata_error": None,
            "queue_summary": {
                "found": True,
                "status": "passed",
                "error": None,
                "cleanup_succeeded": False,
                "cleanup_error": "fixture cleanup failed",
                "scenario_duration_seconds": 8.5,
            },
        },
    )

    assert sample is not None
    assert sample.is_green is False


def test_heavy_sample_is_red_when_teardown_failed() -> None:
    job = make_job_info(
        104,
        event="schedule",
        head_branch="main",
        job_name="compose-browser-e2e",
        conclusion="success",
        created_at="2026-05-18T12:29:16Z",
        started_at="2026-05-18T12:29:16Z",
        completed_at="2026-05-18T13:05:16Z",
    )
    sample = classify_heavy_queue_sample(
        job,
        {
            "compose_teardown_succeeded": False,
            "metadata_error": None,
            "queue_summary": {
                "found": True,
                "status": "passed",
                "error": None,
                "cleanup_succeeded": True,
                "cleanup_error": None,
                "scenario_duration_seconds": 8.5,
            },
        },
    )

    assert sample is not None
    assert sample.is_green is False


def test_consecutive_green_streak_stops_on_first_non_green() -> None:
    green = classify_pr_queue_sample(
        make_job_info(
            1,
            event="pull_request",
            head_branch="feature-a",
            job_name="compose-browser-queue-pr",
            conclusion="success",
            created_at="2026-05-19T16:54:28Z",
            started_at="2026-05-19T16:56:31Z",
            completed_at="2026-05-19T16:58:12Z",
        ),
        {
            "compose_teardown_succeeded": True,
            "metadata_error": None,
            "queue_summary": {
                "found": True,
                "status": "passed",
                "error": None,
                "cleanup_succeeded": True,
                "cleanup_error": None,
                "scenario_duration_seconds": 10.0,
            },
        },
    )
    red = classify_pr_queue_sample(
        make_job_info(
            2,
            event="pull_request",
            head_branch="feature-b",
            job_name="compose-browser-queue-pr",
            conclusion="failure",
            created_at="2026-05-18T16:54:28Z",
            started_at="2026-05-18T16:56:31Z",
            completed_at="2026-05-18T16:58:12Z",
        ),
        {
            "compose_teardown_succeeded": True,
            "metadata_error": None,
            "queue_summary": {
                "found": True,
                "status": "failed",
                "error": "queue broke",
                "cleanup_succeeded": True,
                "cleanup_error": None,
                "scenario_duration_seconds": 12.0,
            },
        },
    )

    assert consecutive_green_streak([green, red]) == 1


def test_evaluate_readiness_requires_streaks_runtime_and_span() -> None:
    pr_samples = []
    heavy_samples = []
    for index in range(10):
        pr_samples.append(
            classify_pr_queue_sample(
                make_job_info(
                    200 + index,
                    event="merge_group" if index == 0 else "pull_request",
                    head_branch=f"feature-{index}",
                    job_name="compose-browser-queue-pr",
                    conclusion="success",
                    created_at=f"2026-05-{10 + index:02d}T12:00:00Z",
                    started_at=f"2026-05-{10 + index:02d}T12:00:00Z",
                    completed_at=f"2026-05-{10 + index:02d}T12:02:00Z",
                ),
                {
                    "compose_teardown_succeeded": True,
                    "metadata_error": None,
                    "queue_summary": {
                        "found": True,
                        "status": "passed",
                        "error": None,
                        "cleanup_succeeded": True,
                        "cleanup_error": None,
                        "scenario_duration_seconds": 9.0,
                    },
                },
            )
        )
        heavy_samples.append(
            classify_heavy_queue_sample(
                make_job_info(
                    300 + index,
                    event="schedule",
                    head_branch="main",
                    job_name="compose-browser-e2e",
                    conclusion="success",
                    created_at=f"2026-05-{10 + index:02d}T09:00:00Z",
                    started_at=f"2026-05-{10 + index:02d}T09:00:00Z",
                    completed_at=f"2026-05-{10 + index:02d}T09:30:00Z",
                ),
                {
                    "compose_teardown_succeeded": True,
                    "metadata_error": None,
                    "queue_summary": {
                        "found": True,
                        "status": "passed",
                        "error": None,
                        "cleanup_succeeded": True,
                        "cleanup_error": None,
                        "scenario_duration_seconds": 11.0,
                    },
                },
            )
        )

    evaluation = evaluate_readiness(pr_samples, heavy_samples, require_merge_group_sample=True)

    assert evaluation["ready_to_require"] is True
    assert evaluation["pr_queue_shadow"]["green_streak"] == 10
    assert evaluation["heavy_queue"]["green_streak"] == 10
    assert evaluation["pr_queue_shadow"]["merge_group_samples_in_streak"] == 1


def test_evaluate_readiness_fails_when_green_prefix_duration_data_is_missing() -> None:
    pr_samples = []
    heavy_samples = []
    for index in range(10):
        pr_samples.append(
            classify_pr_queue_sample(
                make_job_info(
                    400 + index,
                    event="pull_request",
                    head_branch=f"feature-{index}",
                    job_name="compose-browser-queue-pr",
                    conclusion="success",
                    created_at=f"2026-05-{10 + index:02d}T12:00:00Z",
                    started_at=f"2026-05-{10 + index:02d}T12:00:00Z",
                    completed_at=f"2026-05-{10 + index:02d}T12:02:00Z" if index else None,
                ),
                {
                    "compose_teardown_succeeded": True,
                    "metadata_error": None,
                    "queue_summary": {
                        "found": True,
                        "status": "passed",
                        "error": None,
                        "cleanup_succeeded": True,
                        "cleanup_error": None,
                        "scenario_duration_seconds": 9.0,
                    },
                },
            )
        )
        heavy_samples.append(
            classify_heavy_queue_sample(
                make_job_info(
                    500 + index,
                    event="schedule",
                    head_branch="main",
                    job_name="compose-browser-e2e",
                    conclusion="success",
                    created_at=f"2026-05-{10 + index:02d}T09:00:00Z",
                    started_at=f"2026-05-{10 + index:02d}T09:00:00Z",
                    completed_at=f"2026-05-{10 + index:02d}T09:30:00Z",
                ),
                {
                    "compose_teardown_succeeded": True,
                    "metadata_error": None,
                    "queue_summary": {
                        "found": True,
                        "status": "passed",
                        "error": None,
                        "cleanup_succeeded": True,
                        "cleanup_error": None,
                        "scenario_duration_seconds": 11.0,
                    },
                },
            )
        )

    evaluation = evaluate_readiness(pr_samples, heavy_samples)

    assert evaluation["ready_to_require"] is False
    assert evaluation["pr_queue_shadow"]["missing_job_duration_count"] == 1


def test_evaluate_readiness_with_short_streak_does_not_emit_duration_noise() -> None:
    pr_samples = [
        classify_pr_queue_sample(
            make_job_info(
                600,
                event="pull_request",
                head_branch="feature-short",
                job_name="compose-browser-queue-pr",
                conclusion="success",
                created_at="2026-05-19T12:00:00Z",
                started_at="2026-05-19T12:00:00Z",
                completed_at="2026-05-19T12:02:00Z",
            ),
            {
                "compose_teardown_succeeded": True,
                "metadata_error": None,
                "queue_summary": {
                    "found": True,
                    "status": "passed",
                    "error": None,
                    "cleanup_succeeded": True,
                    "cleanup_error": None,
                    "scenario_duration_seconds": 9.0,
                },
            },
        )
    ]
    heavy_samples = [
        classify_heavy_queue_sample(
            make_job_info(
                700,
                event="schedule",
                head_branch="main",
                job_name="compose-browser-e2e",
                conclusion="success",
                created_at="2026-05-19T09:00:00Z",
                started_at="2026-05-19T09:00:00Z",
                completed_at="2026-05-19T09:30:00Z",
            ),
            {
                "compose_teardown_succeeded": True,
                "metadata_error": None,
                "queue_summary": {
                    "found": True,
                    "status": "passed",
                    "error": None,
                    "cleanup_succeeded": True,
                    "cleanup_error": None,
                    "scenario_duration_seconds": 11.0,
                },
            },
        )
    ]

    evaluation = evaluate_readiness(pr_samples, heavy_samples)

    assert evaluation["ready_to_require"] is False
    assert any("need 10" in reason for reason in evaluation["reasons"])
    assert not any("median" in reason for reason in evaluation["reasons"])
    assert not any("p95" in reason for reason in evaluation["reasons"])
    assert not any("span" in reason for reason in evaluation["reasons"])

from pathlib import Path
import json
import subprocess
import sys

from scripts.browser_lane_readiness import (
    QUEUE_SCENARIO_NAME,
    build_queue_metadata_from_mode_root,
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

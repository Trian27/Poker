"""Regression guards for documented manual-check locations."""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
README_PATH = REPO_ROOT / "README.md"
DOCKER_GUIDE_PATH = REPO_ROOT / "docs" / "DOCKER_GUIDE.md"
MANUAL_CHECKS_README_PATH = REPO_ROOT / "scripts" / "manual_checks" / "README.md"
ROOT_TESTS_README_PATH = REPO_ROOT / "tests" / "README.md"


def test_docs_point_to_the_new_manual_check_paths() -> None:
    """Primary docs must reference the new scripts/manual_checks entrypoints."""
    readme_text = README_PATH.read_text(encoding="utf-8")
    docker_guide_text = DOCKER_GUIDE_PATH.read_text(encoding="utf-8")

    assert "scripts/manual_checks/action_timeout_check.py" in readme_text
    assert "scripts/manual_checks/auto_seat_queue_check.py" in readme_text
    assert "scripts/manual_checks/chunk5_buyin_check.py" in docker_guide_text


def test_boundary_readmes_exist_and_old_root_paths_are_gone() -> None:
    """The repo should document the new boundary and stop pointing at root test-script paths."""
    readme_text = README_PATH.read_text(encoding="utf-8")
    docker_guide_text = DOCKER_GUIDE_PATH.read_text(encoding="utf-8")

    assert MANUAL_CHECKS_README_PATH.exists()
    assert ROOT_TESTS_README_PATH.exists()
    assert "test_action_timeout.py" not in readme_text
    assert "test_auto_seat_queue.py" not in readme_text
    assert "test_chunk5_buyin.py" not in docker_guide_text

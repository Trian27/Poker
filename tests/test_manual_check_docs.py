"""Regression guards for documented manual-check locations."""

from __future__ import annotations

from pathlib import Path
import re

REPO_ROOT = Path(__file__).resolve().parents[1]
README_PATH = REPO_ROOT / "README.md"
DOCKER_GUIDE_PATH = REPO_ROOT / "docs" / "DOCKER_GUIDE.md"
MANUAL_CHECKS_README_PATH = REPO_ROOT / "scripts" / "manual_checks" / "README.md"
ROOT_TESTS_README_PATH = REPO_ROOT / "tests" / "README.md"
LEGACY_ROOT_SCRIPT_PATTERN = re.compile(r'(?<!manual_checks/)(?:\./)?(?:tests/)?test_[^\s`"]+\.py')


def test_docs_point_to_the_new_manual_check_paths() -> None:
    """Primary docs must reference the new scripts/manual_checks entrypoints."""
    readme_text = README_PATH.read_text(encoding="utf-8")
    docker_guide_text = DOCKER_GUIDE_PATH.read_text(encoding="utf-8")

    assert "scripts/manual_checks/action_timeout_check.py" in readme_text
    assert "scripts/manual_checks/auto_seat_queue_check.py" in readme_text
    assert "scripts/manual_checks/chunk5_buyin_check.py" in docker_guide_text


def test_boundary_readmes_exist() -> None:
    """The repo should document the new manual-check and root-test boundaries."""
    readme_text = README_PATH.read_text(encoding="utf-8")
    docker_guide_text = DOCKER_GUIDE_PATH.read_text(encoding="utf-8")
    manual_checks_readme_text = MANUAL_CHECKS_README_PATH.read_text(encoding="utf-8")
    root_tests_readme_text = ROOT_TESTS_README_PATH.read_text(encoding="utf-8")

    assert MANUAL_CHECKS_README_PATH.exists()
    assert ROOT_TESTS_README_PATH.exists()
    assert re.search(r"`scripts/manual_checks/[^`]+\.py`", readme_text)
    assert re.search(r"scripts/manual_checks/[^\s]+\.py", docker_guide_text)
    assert "PYTHON_BIN" in manual_checks_readme_text
    assert '"$PYTHON_BIN" -m pytest' in root_tests_readme_text
    assert "PYTHON_BIN" in docker_guide_text
    assert re.search(r'"\$PYTHON_BIN"\s+scripts/manual_checks/[^\s]+\.py', manual_checks_readme_text)
    assert re.search(r'"\$PYTHON_BIN"\s+scripts/manual_checks/[^\s]+\.py', docker_guide_text)
    for text in (
        readme_text,
        docker_guide_text,
        manual_checks_readme_text,
        root_tests_readme_text,
    ):
        assert LEGACY_ROOT_SCRIPT_PATTERN.search(text) is None

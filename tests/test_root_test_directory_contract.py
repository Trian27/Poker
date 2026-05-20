"""Regression guards for repo-root pytest collection behavior."""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
ROOT_TESTS_DIR = REPO_ROOT / "tests"
APPROVED_ROOT_TEST_FILES = {
    "test_root_test_directory_contract.py",
    "test_manual_check_docs.py",
}


def test_repo_root_pytest_collects_cleanly() -> None:
    """Bare repo-root pytest collection must succeed without import-time side effects."""
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "--collect-only", "-q"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, (
        "Repo-root pytest collection must succeed.\n"
        f"stdout:\n{result.stdout}\n"
        f"stderr:\n{result.stderr}"
    )


def test_only_approved_repo_root_pytest_files_exist() -> None:
    """Repo-root pytest suite should stay limited to the approved import-safe files."""
    discovered = {
        str(path.relative_to(ROOT_TESTS_DIR))
        for path in ROOT_TESTS_DIR.rglob("test_*.py")
    }
    unexpected = sorted(discovered - APPROVED_ROOT_TEST_FILES)
    assert unexpected == [], f"Unexpected repo-root pytest files: {unexpected}"

"""Regression guards for repo-root pytest collection behavior."""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
ROOT_TESTS_DIR = REPO_ROOT / "tests"
APPROVED_ROOT_TEST_FILES = {
    "test_browser_lane_readiness.py",
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
    collected_node_ids = [
        line.strip()
        for line in result.stdout.splitlines()
        if "::" in line
    ]
    approved_prefixes = {
        f"tests/{name}::"
        for name in APPROVED_ROOT_TEST_FILES
    }
    assert collected_node_ids, "Expected bare repo-root pytest collection to return node ids."
    assert all(
        any(node_id.startswith(prefix) for prefix in approved_prefixes)
        for node_id in collected_node_ids
    ), f"Unexpected repo-root collected node ids: {collected_node_ids}"


def test_only_approved_repo_root_pytest_files_exist() -> None:
    """Repo-root pytest suite should stay limited to the approved import-safe files."""
    discovered = {
        str(path.relative_to(ROOT_TESTS_DIR))
        for path in ROOT_TESTS_DIR.rglob("test_*.py")
    }
    unexpected = sorted(discovered - APPROVED_ROOT_TEST_FILES)
    assert unexpected == [], f"Unexpected repo-root pytest files: {unexpected}"

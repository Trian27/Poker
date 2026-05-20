"""Tests for gameplay workflow scope decisions and workflow contracts."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys

from scripts.gameplay_workflow_scope import (
    GAMEPLAY_PATH_EXACT,
    GAMEPLAY_PATH_PREFIXES,
    GameplayScopeDecision,
    is_gameplay_relevant_path,
    matching_gameplay_paths,
    scope_for_event,
)

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_is_gameplay_relevant_path_matches_existing_filter_contract() -> None:
    assert is_gameplay_relevant_path("poker-ui/src/App.tsx") is True
    assert is_gameplay_relevant_path("GameImplementation/src/server.ts") is True
    assert is_gameplay_relevant_path("poker-api/app/main.py") is True
    assert is_gameplay_relevant_path("docker-compose.yml") is True
    assert is_gameplay_relevant_path("scripts/test-gameplay.sh") is True
    assert is_gameplay_relevant_path("README.md") is False
    assert is_gameplay_relevant_path("tests/test_root_test_directory_contract.py") is False
    assert is_gameplay_relevant_path("scripts/manual_checks/check_user_history.py") is False


def test_matching_gameplay_paths_preserves_input_order() -> None:
    paths = [
        "README.md",
        "poker-ui/src/App.tsx",
        "docs/DOCKER_GUIDE.md",
        ".github/workflows/gameplay-tests.yml",
    ]

    assert matching_gameplay_paths(paths) == [
        "poker-ui/src/App.tsx",
        ".github/workflows/gameplay-tests.yml",
    ]


def test_scope_for_pull_request_with_no_matching_paths_returns_false() -> None:
    decision = scope_for_event(
        "pull_request",
        ["README.md", "tests/test_root_test_directory_contract.py"],
    )

    assert decision == GameplayScopeDecision(
        run_gameplay_jobs=False,
        reason="pull_request changed files do not match gameplay workflow scope",
        matching_paths=(),
    )


def test_scope_for_pull_request_with_matching_paths_returns_true() -> None:
    decision = scope_for_event(
        "pull_request",
        ["README.md", "poker-ui/src/App.tsx", "docs/DOCKER_GUIDE.md"],
    )

    assert decision == GameplayScopeDecision(
        run_gameplay_jobs=True,
        reason="pull_request changed files match gameplay workflow scope",
        matching_paths=("poker-ui/src/App.tsx",),
    )


def test_scope_for_merge_group_always_runs() -> None:
    decision = scope_for_event("merge_group", ["README.md"])

    assert decision == GameplayScopeDecision(
        run_gameplay_jobs=True,
        reason="non-pull_request events always run gameplay jobs",
        matching_paths=(),
    )


def test_scope_cli_writes_github_output_file(tmp_path: Path) -> None:
    changed_files_path = tmp_path / "changed-files.txt"
    changed_files_path.write_text("README.md\npoker-ui/src/App.tsx\n", encoding="utf-8")
    output_path = tmp_path / "github-output.txt"

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "scripts.gameplay_workflow_scope",
            "--event-name",
            "pull_request",
            "--changed-files-file",
            str(changed_files_path),
            "--github-output",
            str(output_path),
        ],
        check=False,
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )

    assert result.returncode == 0
    lines = output_path.read_text(encoding="utf-8").splitlines()
    assert "run_gameplay_jobs=true" in lines
    assert "reason=pull_request changed files match gameplay workflow scope" in lines
    assert 'matching_paths_json=["poker-ui/src/App.tsx"]' in lines

WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "gameplay-tests.yml"


def test_gameplay_workflow_no_longer_uses_pull_request_paths_filter() -> None:
    workflow_text = WORKFLOW_PATH.read_text(encoding="utf-8")

    assert "pull_request:\n    paths:" not in workflow_text



def test_gameplay_workflow_uses_scope_job_and_required_smoke_noop_path() -> None:
    workflow_text = WORKFLOW_PATH.read_text(encoding="utf-8")

    assert "gameplay-scope:" in workflow_text
    assert "python3 -m scripts.gameplay_workflow_scope" in workflow_text
    assert "name: Skip compose-browser-pr-smoke on non-gameplay PR" in workflow_text
    assert "needs: [gameplay-scope, compose-browser-pr-smoke]" in workflow_text

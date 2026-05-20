"""Determine whether gameplay workflow jobs should run for a given event and changed-file set."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
from typing import Iterable

GAMEPLAY_PATH_PREFIXES = (
    "GameImplementation/",
    "poker-api/",
    "poker-ui/",
)
GAMEPLAY_PATH_EXACT = {
    "docker-compose.yml",
    "scripts/test_autonomous_bot_gameplay.py",
    "scripts/test-gameplay.sh",
    ".github/workflows/gameplay-tests.yml",
}
NON_PR_ALWAYS_RUN_REASON = "non-pull_request events always run gameplay jobs"
PR_SCOPE_MATCH_REASON = "pull_request changed files match gameplay workflow scope"
PR_SCOPE_MISS_REASON = "pull_request changed files do not match gameplay workflow scope"


@dataclass(frozen=True)
class GameplayScopeDecision:
    """One normalized decision about whether PR gameplay jobs should execute."""

    run_gameplay_jobs: bool
    reason: str
    matching_paths: tuple[str, ...]



def is_gameplay_relevant_path(path: str) -> bool:
    """Return whether one repository-relative path belongs to gameplay CI scope."""
    return path in GAMEPLAY_PATH_EXACT or path.startswith(GAMEPLAY_PATH_PREFIXES)



def matching_gameplay_paths(paths: Iterable[str]) -> list[str]:
    """Return gameplay-relevant paths in input order without modifying the path strings."""
    return [path for path in paths if is_gameplay_relevant_path(path)]



def scope_for_event(event_name: str, changed_paths: Iterable[str]) -> GameplayScopeDecision:
    """Return whether gameplay jobs should run for the given GitHub event and file list."""
    if event_name != "pull_request":
        return GameplayScopeDecision(
            run_gameplay_jobs=True,
            reason=NON_PR_ALWAYS_RUN_REASON,
            matching_paths=(),
        )

    matching_paths = tuple(matching_gameplay_paths(changed_paths))
    if matching_paths:
        return GameplayScopeDecision(
            run_gameplay_jobs=True,
            reason=PR_SCOPE_MATCH_REASON,
            matching_paths=matching_paths,
        )
    return GameplayScopeDecision(
        run_gameplay_jobs=False,
        reason=PR_SCOPE_MISS_REASON,
        matching_paths=(),
    )



def read_changed_paths(path: Path) -> list[str]:
    """Read newline-delimited changed file paths from disk."""
    if not path.exists():
        raise FileNotFoundError(f"Changed-files list does not exist: {path}")
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]



def write_github_output(path: Path, decision: GameplayScopeDecision) -> None:
    """Write GitHub Actions outputs for the workflow to consume."""
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized_matches = json.dumps(list(decision.matching_paths))
    with path.open("a", encoding="utf-8") as handle:
        handle.write(f"run_gameplay_jobs={'true' if decision.run_gameplay_jobs else 'false'}\n")
        handle.write(f"reason={decision.reason}\n")
        handle.write(f"matching_paths_json={serialized_matches}\n")



def main() -> int:
    """CLI entrypoint for GitHub Actions gameplay-scope evaluation."""
    parser = argparse.ArgumentParser(description="Evaluate gameplay workflow scope for one GitHub event")
    parser.add_argument("--event-name", required=True)
    parser.add_argument("--changed-files-file", default=None)
    parser.add_argument("--github-output", required=True)
    args = parser.parse_args()

    if args.event_name == "pull_request" and not args.changed_files_file:
        parser.error("--changed-files-file is required for pull_request events")

    changed_paths = []
    if args.changed_files_file is not None:
        changed_paths = read_changed_paths(Path(args.changed_files_file))

    decision = scope_for_event(args.event_name, changed_paths)
    write_github_output(Path(args.github_output), decision)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

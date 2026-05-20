# Root Tests

This directory is reserved for repo-level pytest-safe tests.

What belongs here:
- automated tests that are safe to collect and run with `"$PYTHON_BIN" -m pytest`
- repo-level operational tooling tests, such as browser-lane readiness helpers
- tests that do not require ad-hoc command-line arguments or import-time network calls

What does not belong here:
- manual localhost-dependent API scripts
- one-off data repair or inspection scripts
- scripts that expect `sys.argv` at import time
- scripts that call `sys.exit()` during module import

Manual checks now live under [`scripts/manual_checks/`](../scripts/manual_checks/README.md).

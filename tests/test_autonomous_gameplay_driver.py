"""Regression coverage for autonomous gameplay driver health gating."""

from __future__ import annotations

from pathlib import Path

import pytest

from scripts import test_autonomous_bot_gameplay as driver

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_auth_health_check_requires_healthy_status_even_when_optional_g5_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = {
        "status": "degraded",
        "database": "connected",
        "g5_advisor": {
            "status": "degraded",
            "ready": False,
            "http_status": None,
            "startup_stage": None,
            "error": "temporary failure in name resolution",
        },
    }

    monkeypatch.setattr(driver, "_request_json", lambda *args, **kwargs: payload)

    with pytest.raises(driver.SmokeTestError, match="unexpected payload"):
        driver._health_check("http://auth.example.test", "Auth API")


def test_non_auth_health_check_still_rejects_degraded_status(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {
        "status": "degraded",
        "database": "connected",
        "g5_advisor": {
            "status": "degraded",
            "ready": False,
        },
    }

    monkeypatch.setattr(driver, "_request_json", lambda *args, **kwargs: payload)

    with pytest.raises(driver.SmokeTestError, match="unexpected payload"):
        driver._health_check("http://game.example.test", "Game Server")


def test_compose_gameplay_script_exports_g5_advisor_toggle() -> None:
    script_text = (REPO_ROOT / "scripts" / "test-gameplay.sh").read_text(encoding="utf-8")

    assert 'G5_ADVISOR_ENABLED="${G5_ADVISOR_ENABLED:-true}"' in script_text
    assert 'export G5_ADVISOR_ENABLED' in script_text
    assert 'G5_ADVISOR_ENABLED=false run_compose_mode "bot-vs-bot" "compose-autonomous"' in script_text

from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any, Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from app import main as main_module


class StubAdvisorClient:
    def __init__(self, response: httpx.Response):
        self._response = response
        self.requests: list[dict[str, Any]] = []

    async def post(self, url: str, json: dict[str, Any]) -> httpx.Response:
        self.requests.append({"url": url, "json": json})
        return self._response

    async def aclose(self) -> None:
        return None


@pytest.fixture(autouse=True)
def clear_dependency_overrides() -> Iterator[None]:
    main_module.app.dependency_overrides.clear()
    yield
    main_module.app.dependency_overrides.clear()


@contextmanager
def build_learning_client(
    monkeypatch: pytest.MonkeyPatch,
    *,
    hand_data: dict[str, Any],
    advisor_response: httpx.Response,
) -> Iterator[tuple[TestClient, StubAdvisorClient]]:
    advisor = StubAdvisorClient(advisor_response)

    monkeypatch.setattr(main_module, "ensure_schema", lambda: None)
    monkeypatch.setattr(main_module, "_bootstrap_admin_user", lambda: None)
    monkeypatch.setattr(main_module.httpx, "AsyncClient", lambda *args, **kwargs: advisor)
    monkeypatch.setattr(
        main_module,
        "_get_visible_hand_history_row",
        lambda db, hand_id, user_id: SimpleNamespace(hand_data=hand_data),
    )

    main_module.app.dependency_overrides[main_module.get_current_user] = lambda: {
        "user_id": 42,
        "username": "hero",
    }
    main_module.app.dependency_overrides[main_module.get_db] = lambda: object()

    with TestClient(main_module.app) as client:
        yield client, advisor


def test_learning_coach_forwards_supported_hero_decision_to_g5(monkeypatch: pytest.MonkeyPatch) -> None:
    hand_data = sample_hand_data()
    advisor_response = httpx.Response(
        200,
        json={
            "recommended_action": "call",
            "amount": 150,
            "raw_action_type": "Call",
            "raw_by_amount": 0,
            "check_call_ev": 1.25,
            "bet_raise_ev": 0.85,
            "time_spent_seconds": 0.31,
            "message": "Prefer the lower-variance continue.",
            "warnings": ["multiway_postflop_fallback"],
        },
    )

    with build_learning_client(monkeypatch, hand_data=hand_data, advisor_response=advisor_response) as (client, advisor):
        response = client.post(
            "/api/learning/coach/recommend",
            json={"hand_id": "hand-123", "decision_sequence": 6},
        )

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "engine": "g5",
        "hand_id": "hand-123",
        "decision_sequence": 6,
        "street": "flop",
        "recommended_action": "call",
        "amount": 150,
        "raw_action_type": "Call",
        "raw_by_amount": 0,
        "check_call_ev": 1.25,
        "bet_raise_ev": 0.85,
        "time_spent_seconds": 0.31,
        "message": "Prefer the lower-variance continue.",
        "warnings": ["multiway_postflop_fallback"],
        "unsupported_code": None,
        "unsupported_message": None,
    }
    assert advisor.requests == [
        {
            "url": "/api/v1/advisor/g5/analyze-decision",
            "json": {
                "hero_player_id": "hero-seat",
                "decision_sequence": 6,
                "hand_data": hand_data,
            },
        }
    ]


def test_learning_coach_returns_clear_unsupported_from_g5(monkeypatch: pytest.MonkeyPatch) -> None:
    hand_data = sample_hand_data()
    advisor_response = httpx.Response(
        422,
        json={
            "error": "unsupported_action",
            "message": "This decision cannot be replayed by the current adapter.",
        },
    )

    with build_learning_client(monkeypatch, hand_data=hand_data, advisor_response=advisor_response) as (client, advisor):
        response = client.post(
            "/api/learning/coach/recommend",
            json={"hand_id": "hand-456", "decision_sequence": 6},
        )

    assert response.status_code == 200
    assert response.json() == {
        "status": "unsupported",
        "engine": "g5",
        "hand_id": "hand-456",
        "decision_sequence": 6,
        "street": "flop",
        "recommended_action": None,
        "amount": None,
        "raw_action_type": None,
        "raw_by_amount": None,
        "check_call_ev": None,
        "bet_raise_ev": None,
        "time_spent_seconds": None,
        "message": None,
        "warnings": [],
        "unsupported_code": "unsupported_action",
        "unsupported_message": "This decision cannot be replayed by the current adapter.",
    }
    assert len(advisor.requests) == 1


def test_learning_coach_returns_clear_unsupported_for_heads_up_postflop_ordering(monkeypatch: pytest.MonkeyPatch) -> None:
    hand_data = sample_hand_data()
    advisor_response = httpx.Response(
        422,
        json={
            "error": "unsupported_heads_up_postflop_ordering",
            "message": "This heads-up hand uses dealer-first postflop action ordering that the current G5 replay cannot represent exactly.",
        },
    )

    with build_learning_client(monkeypatch, hand_data=hand_data, advisor_response=advisor_response) as (client, advisor):
        response = client.post(
            "/api/learning/coach/recommend",
            json={"hand_id": "hand-789", "decision_sequence": 6},
        )

    assert response.status_code == 200
    assert response.json() == {
        "status": "unsupported",
        "engine": "g5",
        "hand_id": "hand-789",
        "decision_sequence": 6,
        "street": "flop",
        "recommended_action": None,
        "amount": None,
        "raw_action_type": None,
        "raw_by_amount": None,
        "check_call_ev": None,
        "bet_raise_ev": None,
        "time_spent_seconds": None,
        "message": None,
        "warnings": [],
        "unsupported_code": "unsupported_heads_up_postflop_ordering",
        "unsupported_message": "This heads-up hand uses dealer-first postflop action ordering that the current G5 replay cannot represent exactly.",
    }
    assert len(advisor.requests) == 1


def sample_hand_data() -> dict[str, Any]:
    return {
        "players": [
            {"player_id": "villain-seat", "user_id": 7, "username": "villain"},
            {"player_id": "hero-seat", "user_id": 42, "username": "hero"},
        ],
        "action_log": [
            {
                "sequence": 1,
                "stage": "preflop",
                "player_id": "villain-seat",
                "action": "small-blind",
                "source": "forced",
                "pot_before": 0,
            },
            {
                "sequence": 2,
                "stage": "preflop",
                "player_id": "hero-seat",
                "action": "big-blind",
                "source": "forced",
                "pot_before": 50,
            },
            {
                "sequence": 3,
                "stage": "preflop",
                "player_id": "villain-seat",
                "action": "call",
            },
            {
                "sequence": 4,
                "stage": "preflop",
                "player_id": "hero-seat",
                "action": "check",
            },
            {
                "sequence": 5,
                "stage": "flop",
                "player_id": "villain-seat",
                "action": "bet",
            },
            {
                "sequence": 6,
                "stage": "flop",
                "player_id": "hero-seat",
                "action": "raise",
            },
        ],
    }

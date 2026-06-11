from __future__ import annotations

import httpx


class _StubG5Response:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict:
        return self._payload


class _StubG5Client:
    def __init__(self, *, response: _StubG5Response | None = None, error: Exception | None = None):
        self._response = response
        self._error = error

    async def get(self, path: str, timeout: float | None = None):
        assert path == "/health"
        assert timeout is not None
        if self._error is not None:
            raise self._error
        if self._response is None:
            raise AssertionError("Stub client requires either response or error")
        return self._response

    async def aclose(self) -> None:
        return None


def test_health_reports_healthy_g5_status(client, app_modules):
    main = app_modules["main"]
    main.app.state.g5_advisor_client = _StubG5Client(
        response=_StubG5Response(
            200,
            {
                "status": "ready",
                "ready": True,
                "startup_stage": "ready",
                "profiles": {"six_max": {"ready": True}},
            },
        )
    )

    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert body["database"] == "connected"
    assert body["g5_advisor"]["status"] == "healthy"
    assert body["g5_advisor"]["ready"] is True
    assert body["g5_advisor"]["http_status"] == 200
    assert body["g5_advisor"]["startup_stage"] == "ready"


def test_health_reports_degraded_when_g5_is_unready(client, app_modules):
    main = app_modules["main"]
    main.app.state.g5_advisor_client = _StubG5Client(
        response=_StubG5Response(
            503,
            {
                "status": "unready",
                "ready": False,
                "startup_stage": "bundle_missing",
                "error": "runtime bundle missing",
            },
        )
    )

    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "degraded"
    assert body["g5_advisor"]["status"] == "degraded"
    assert body["g5_advisor"]["ready"] is False
    assert body["g5_advisor"]["http_status"] == 503
    assert body["g5_advisor"]["startup_stage"] == "bundle_missing"
    assert body["g5_advisor"]["error"] == "runtime bundle missing"


def test_health_reports_degraded_when_g5_request_fails(client, app_modules):
    main = app_modules["main"]
    main.app.state.g5_advisor_client = _StubG5Client(
        error=httpx.ConnectError("g5 unavailable")
    )

    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "degraded"
    assert body["g5_advisor"]["status"] == "degraded"
    assert body["g5_advisor"]["ready"] is False
    assert body["g5_advisor"]["http_status"] is None
    assert body["g5_advisor"]["startup_stage"] is None
    assert body["g5_advisor"]["error"] == "g5 unavailable"


def test_health_reports_healthy_when_g5_is_explicitly_disabled(client, app_modules, monkeypatch):
    main = app_modules["main"]
    monkeypatch.setattr(main.settings, "G5_ADVISOR_ENABLED", False)
    main.app.state.g5_advisor_client = None

    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert body["database"] == "connected"
    assert body["g5_advisor"]["status"] == "disabled"
    assert body["g5_advisor"]["ready"] is False
    assert body["g5_advisor"]["http_status"] is None
    assert body["g5_advisor"]["startup_stage"] == "disabled"
    assert body["g5_advisor"]["error"] is None

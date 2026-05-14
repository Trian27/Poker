#!/usr/bin/env python3
"""
Autonomous gameplay E2E driver.

This script provisions a fixture stack via the admin fixture API, logs in the
fixture users through the ordinary auth flow, drives autonomous bot gameplay
against the real game server, asserts persisted hand history and partition
isolation, then cleans the run up.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import signal
import sys
import threading
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from queue import Empty, Queue
from typing import Any, Iterable, Optional

RUN_TAG_PATTERN = r"^[A-Za-z0-9._:-]{1,128}$"
DEFAULT_TIMEOUT_SECONDS = 240
DEFAULT_POLL_INTERVAL_SECONDS = 2.0
DEFAULT_SUMMARY_STATUS = "running"
SECRET_KEYS = {
    "password",
    "admin_password",
    "token",
    "access_token",
    "refresh_token",
    "authorization",
}


class SmokeTestError(RuntimeError):
    """Raised for deterministic gameplay E2E failures."""


class InterruptedRun(SmokeTestError):
    """Raised when a termination signal interrupts the run."""

    def __init__(self, signum: int):
        self.signum = signum
        super().__init__(f"Received signal {signum}; cleanup will be attempted")


class HTTPRequestError(SmokeTestError):
    """Raised when an HTTP response status is unexpected."""

    def __init__(self, method: str, url: str, status_code: int, response_text: str):
        self.method = method
        self.url = url
        self.status_code = status_code
        self.response_text = _redact_plaintext(response_text.strip())
        super().__init__(
            f"{method} {url} failed with {status_code}.\n"
            f"Response body:\n{self.response_text}"
        )


try:
    import requests
except ModuleNotFoundError as exc:  # pragma: no cover - startup dependency guard
    raise SystemExit(
        "Missing dependency 'requests'. Use ~/.virtualenvs/poker/bin/python or set PYTHON_BIN "
        "to an interpreter with the documented requirements installed."
    ) from exc

try:
    from jose import jwt
except ModuleNotFoundError as exc:  # pragma: no cover - startup dependency guard
    raise SystemExit(
        "Missing dependency 'python-jose'. Use ~/.virtualenvs/poker/bin/python or set PYTHON_BIN "
        "to an interpreter with the documented requirements installed."
    ) from exc

try:
    import socketio
except ModuleNotFoundError as exc:  # pragma: no cover - startup dependency guard
    raise SystemExit(
        "Missing dependency 'python-socketio[client]'. Use ~/.virtualenvs/poker/bin/python or set PYTHON_BIN "
        "to an interpreter with the documented requirements installed."
    ) from exc


PROJECT_ROOT = Path(__file__).resolve().parents[1]
AGENT_FILE = PROJECT_ROOT / "poker-agent-api" / "agent_websocket.py"
if not AGENT_FILE.exists():
    raise SystemExit(
        f"Missing {AGENT_FILE}. Run this script from the repository checkout, "
        "or ensure poker-agent-api is present."
    )


def _load_websocket_poker_agent() -> type[Any]:
    agent_dir = str(AGENT_FILE.parent)
    if agent_dir not in sys.path:
        sys.path.insert(0, agent_dir)
    try:
        from agent_websocket import WebSocketPokerAgent  # type: ignore
    except ModuleNotFoundError as exc:
        raise SystemExit(
            "Could not import poker-agent-api/agent_websocket.py. Use ~/.virtualenvs/poker/bin/python "
            "or set PYTHON_BIN to an interpreter with the documented requirements installed."
        ) from exc
    return WebSocketPokerAgent


@dataclass
class SessionUser:
    user_id: int
    username: str
    email: str
    password: str
    token: str
    is_bot: bool
    seat_number: Optional[int] = None
    queue_position: Optional[int] = None


@dataclass
class BotHandle:
    user: SessionUser
    agent: Any
    thread: threading.Thread


@dataclass
class CleanupSummary:
    attempted: bool = False
    succeeded: bool = False
    deleted_counts: dict[str, int] = field(default_factory=dict)
    error: Optional[str] = None


@dataclass
class RunSummary:
    mode: str
    run_tag: Optional[str] = None
    phase: str = "starting"
    status: str = DEFAULT_SUMMARY_STATUS
    error: Optional[str] = None
    admin_username: Optional[str] = None
    league_id: Optional[int] = None
    community_id: Optional[int] = None
    table_id: Optional[int] = None
    game_id: Optional[str] = None
    fixture_usernames: list[str] = field(default_factory=list)
    common_hand_id: Optional[str] = None
    cleanup: CleanupSummary = field(default_factory=CleanupSummary)
    phase_timings: dict[str, float] = field(default_factory=dict)


class PhaseTracker:
    def __init__(self, summary: RunSummary):
        self.summary = summary
        self._phase_started_at: Optional[float] = None
        self._current_phase: Optional[str] = None

    def start(self, phase: str) -> None:
        now = time.monotonic()
        if self._current_phase is not None and self._phase_started_at is not None:
            self.summary.phase_timings[self._current_phase] = round(now - self._phase_started_at, 3)
        self.summary.phase = phase
        self._current_phase = phase
        self._phase_started_at = now

    def finish(self) -> None:
        now = time.monotonic()
        if self._current_phase is not None and self._phase_started_at is not None:
            self.summary.phase_timings[self._current_phase] = round(now - self._phase_started_at, 3)
            self._current_phase = None
            self._phase_started_at = None


class InterruptState:
    def __init__(self) -> None:
        self.signum: Optional[int] = None

    def install(self) -> dict[int, Any]:
        previous: dict[int, Any] = {}

        def _handle(signum: int, _frame: Any) -> None:
            if self.signum is None:
                self.signum = signum
                print(f"\nReceived signal {signum}; cleanup will be attempted.", flush=True)

        for sig in (signal.SIGINT, signal.SIGTERM):
            previous[sig] = signal.getsignal(sig)
            signal.signal(sig, _handle)
        return previous

    def restore(self, previous: dict[int, Any]) -> None:
        for sig, handler in previous.items():
            signal.signal(sig, handler)

    def raise_if_interrupted(self) -> None:
        if self.signum is not None:
            raise InterruptedRun(self.signum)


@dataclass
class FixtureStack:
    run_tag: str
    league_id: int
    community_id: int
    table_id: int
    table_name: str
    game_id: str
    users: list[dict[str, Any]]


def _strip_trailing_slash(value: str) -> str:
    return value.rstrip("/")


def _redact_secrets(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            if key.lower() in SECRET_KEYS:
                redacted[key] = "<redacted>"
            else:
                redacted[key] = _redact_secrets(item)
        return redacted
    if isinstance(value, list):
        return [_redact_secrets(item) for item in value]
    return value


def _redact_plaintext(text: str) -> str:
    if not text:
        return text
    try:
        parsed = json.loads(text)
    except Exception:
        return text
    return json.dumps(_redact_secrets(parsed), ensure_ascii=True)


def _request_json(
    method: str,
    url: str,
    *,
    expected_statuses: Iterable[int],
    timeout_seconds: float = 15,
    **kwargs: Any,
) -> Any:
    try:
        response = requests.request(method, url, timeout=timeout_seconds, **kwargs)
    except requests.RequestException as exc:
        raise SmokeTestError(f"{method} {url} failed: {exc}") from exc

    expected = set(expected_statuses)
    if response.status_code not in expected:
        raise HTTPRequestError(method, url, response.status_code, response.text)
    if not response.content:
        return None
    try:
        return response.json()
    except ValueError as exc:
        raise SmokeTestError(f"{method} {url} returned non-JSON response") from exc


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _health_check(url: str, label: str) -> None:
    payload = _request_json("GET", f"{url}/health", expected_statuses=(200,), timeout_seconds=5)
    status = payload.get("status")
    if status not in {"healthy", "ok"}:
        raise SmokeTestError(f"{label} health check returned unexpected payload: {payload}")


def _decode_user_id(access_token: str) -> int:
    payload = jwt.decode(access_token, key="", options={"verify_signature": False})
    return int(payload["user_id"])


def _login_user(auth_api_url: str, username: str, password: str) -> tuple[str, int]:
    payload = _request_json(
        "POST",
        f"{auth_api_url}/auth/login",
        expected_statuses=(200,),
        params={"username": username, "password": password},
    )
    if payload.get("requires_2fa"):
        raise SmokeTestError(
            f"Login for {username} requires admin 2FA. Run this E2E flow with ENV_MODE=dev."
        )
    token = payload.get("access_token")
    if not token:
        raise SmokeTestError(f"Login did not return access_token for {username}")
    return token, _decode_user_id(token)


def _login_user_with_retry(auth_api_url: str, username: str, password: str, timeout_seconds: int = 90) -> tuple[str, int]:
    deadline = time.time() + timeout_seconds
    last_error: Optional[Exception] = None
    while time.time() < deadline:
        try:
            return _login_user(auth_api_url, username, password)
        except SmokeTestError as exc:
            last_error = exc
            time.sleep(2)
    raise SmokeTestError(f"Admin login failed after readiness retry window: {last_error}")


def _validate_run_tag(run_tag: str) -> str:
    normalized = run_tag.strip()
    if not re.fullmatch(RUN_TAG_PATTERN, normalized):
        raise SmokeTestError(
            f"Invalid run tag '{run_tag}'. It must match {RUN_TAG_PATTERN}."
        )
    return normalized


def _generate_run_tag(mode: str) -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    github_run_id = os.getenv("GITHUB_RUN_ID")
    github_run_attempt = os.getenv("GITHUB_RUN_ATTEMPT")
    mode_fragment = mode.replace("_", "-")
    if github_run_id and github_run_attempt:
        candidate = f"e2e-{mode_fragment}-gh-{github_run_id}-{github_run_attempt}"
    else:
        candidate = f"e2e-{mode_fragment}-{timestamp}-{secrets.token_hex(3)}"
    return _validate_run_tag(candidate)


def _create_fixture_stack(
    auth_api_url: str,
    admin_token: str,
    *,
    run_tag: str,
    starting_balance: int,
    buy_in: int,
    small_blind: int,
    big_blind: int,
    action_timeout_seconds: int,
) -> FixtureStack:
    payload = _request_json(
        "POST",
        f"{auth_api_url}/api/admin/test-fixtures/gameplay-stack",
        expected_statuses=(201,),
        headers=_auth_headers(admin_token),
        json={
            "run_tag": run_tag,
            "player_count": 2,
            "queued_player_count": 0,
            "starting_balance": starting_balance,
            "buy_in": buy_in,
            "small_blind": small_blind,
            "big_blind": big_blind,
            "max_seats": 2,
            "max_queue_size": 0,
            "action_timeout_seconds": action_timeout_seconds,
        },
    )
    return FixtureStack(
        run_tag=str(payload["run_tag"]),
        league_id=int(payload["league_id"]),
        community_id=int(payload["community_id"]),
        table_id=int(payload["table_id"]),
        table_name=str(payload["table_name"]),
        game_id=str(payload["game_id"]),
        users=list(payload["users"]),
    )


def _cleanup_fixture_stack(auth_api_url: str, admin_token: str, run_tag: str) -> tuple[str, dict[str, int]]:
    payload = _request_json(
        "DELETE",
        f"{auth_api_url}/api/admin/test-fixtures/runs/{run_tag}",
        expected_statuses=(200,),
        headers=_auth_headers(admin_token),
    )
    return str(payload["status"]), dict(payload.get("deleted", {}))


def _create_session_user(auth_api_url: str, fixture_user: dict[str, Any], *, is_bot: bool) -> SessionUser:
    token, user_id = _login_user(auth_api_url, str(fixture_user["username"]), str(fixture_user["password"]))
    return SessionUser(
        user_id=user_id,
        username=str(fixture_user["username"]),
        email=str(fixture_user["email"]),
        password=str(fixture_user["password"]),
        token=token,
        is_bot=is_bot,
        seat_number=fixture_user.get("seat_number"),
        queue_position=fixture_user.get("queue_position"),
    )


def _assert_fixture_access(
    auth_api_url: str,
    viewer: SessionUser,
    fixture: FixtureStack,
    expected_users: list[SessionUser],
) -> None:
    communities = _request_json(
        "GET",
        f"{auth_api_url}/api/communities",
        expected_statuses=(200,),
        headers=_auth_headers(viewer.token),
    )
    if fixture.community_id not in {int(item["id"]) for item in communities}:
        raise SmokeTestError(f"User {viewer.username} cannot see fixture community {fixture.community_id}")

    tables = _request_json(
        "GET",
        f"{auth_api_url}/api/communities/{fixture.community_id}/tables",
        expected_statuses=(200,),
        headers=_auth_headers(viewer.token),
    )
    if fixture.table_id not in {int(item["id"]) for item in tables}:
        raise SmokeTestError(f"User {viewer.username} cannot see fixture table {fixture.table_id}")

    seats = _request_json(
        "GET",
        f"{auth_api_url}/api/tables/{fixture.table_id}/seats",
        expected_statuses=(200,),
        headers=_auth_headers(viewer.token),
    )
    occupied = {int(seat["user_id"]): seat for seat in seats if seat.get("user_id") is not None}
    for expected_user in expected_users:
        if expected_user.user_id not in occupied:
            raise SmokeTestError(
                f"User {viewer.username} does not see seated fixture user {expected_user.username} on table {fixture.table_id}"
            )


def _start_bot_agent(
    bot_user: SessionUser,
    game_server_url: str,
    game_id: str,
    *,
    stop_event: threading.Event,
    error_queue: Queue[BaseException],
) -> BotHandle:
    WebSocketPokerAgent = _load_websocket_poker_agent()
    agent = WebSocketPokerAgent(
        token=bot_user.token,
        game_id=game_id,
        user_id=bot_user.user_id,
        server_url=game_server_url,
    )

    def _run() -> None:
        try:
            agent.connect_and_play()
            if not stop_event.is_set():
                error_queue.put(SmokeTestError(f"Bot agent {bot_user.username} exited unexpectedly"))
        except SystemExit as exc:
            exit_code = exc.code if isinstance(exc.code, int) else 1 if exc.code else 0
            if not stop_event.is_set() and exit_code not in (0, None):
                error_queue.put(SmokeTestError(f"Bot agent {bot_user.username} exited with code {exit_code}"))
        except BaseException as exc:  # pragma: no cover - defensive thread failure handling
            if not stop_event.is_set():
                error_queue.put(SmokeTestError(f"Bot agent {bot_user.username} crashed: {exc}"))

    thread = threading.Thread(target=_run, daemon=True, name=f"bot-agent-{bot_user.username}")
    thread.start()
    return BotHandle(user=bot_user, agent=agent, thread=thread)


def _raise_bot_error_if_any(error_queue: Queue[BaseException]) -> None:
    try:
        error = error_queue.get_nowait()
    except Empty:
        return
    if isinstance(error, SmokeTestError):
        raise error
    raise SmokeTestError(str(error)) from error


def _wait_for_bot_connections(
    bot_handles: list[BotHandle],
    *,
    error_queue: Queue[BaseException],
    interrupt_state: InterruptState,
    timeout_seconds: int = 20,
) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        interrupt_state.raise_if_interrupted()
        _raise_bot_error_if_any(error_queue)
        if all(handle.agent.connected for handle in bot_handles):
            return
        time.sleep(0.2)
    raise SmokeTestError("Timed out waiting for bot websocket connections")


def _disconnect_bots(bot_handles: list[BotHandle], stop_event: threading.Event) -> None:
    stop_event.set()
    for handle in bot_handles:
        try:
            if handle.agent.connected:
                handle.agent.sio.disconnect()
        except Exception:
            continue
    for handle in bot_handles:
        handle.thread.join(timeout=5)


def _validate_common_hand_detail(detail: dict[str, Any], fixture: FixtureStack, expected_users: list[SessionUser]) -> bool:
    if int(detail.get("table_id") or 0) != fixture.table_id:
        return False
    hand_data = detail.get("hand_data") or {}
    action_log = hand_data.get("action_log") or []
    if not action_log:
        return False
    players = hand_data.get("players") or []
    user_ids = {int(player.get("user_id")) for player in players if player.get("user_id") is not None}
    expected_user_ids = {user.user_id for user in expected_users}
    return expected_user_ids.issubset(user_ids)


def _wait_for_common_hand(
    auth_api_url: str,
    users: list[SessionUser],
    fixture: FixtureStack,
    *,
    timeout_seconds: int,
    poll_interval_seconds: float,
    bot_handles: list[BotHandle],
    error_queue: Queue[BaseException],
    interrupt_state: InterruptState,
    human_mode: bool,
) -> tuple[str, dict[str, Any]]:
    deadline = time.time() + timeout_seconds
    last_status_log = 0.0
    while time.time() < deadline:
        interrupt_state.raise_if_interrupted()
        _raise_bot_error_if_any(error_queue)
        for handle in bot_handles:
            if not handle.thread.is_alive():
                raise SmokeTestError(f"Bot agent thread for {handle.user.username} is no longer running")
            if not handle.agent.connected:
                raise SmokeTestError(f"Bot agent {handle.user.username} disconnected before hand completion")

        hand_rows_by_user: list[list[dict[str, Any]]] = []
        for user in users:
            payload = _request_json(
                "GET",
                f"{auth_api_url}/api/me/hands",
                expected_statuses=(200,),
                headers=_auth_headers(user.token),
                params={"limit": 50, "offset": 0},
            )
            hand_rows_by_user.append(list(payload))

        common_ids = set(str(row["id"]) for row in hand_rows_by_user[0])
        for rows in hand_rows_by_user[1:]:
            common_ids &= {str(row["id"]) for row in rows}

        if common_ids:
            ordered_candidates = [
                str(row["id"]) for row in hand_rows_by_user[0] if str(row["id"]) in common_ids
            ]
            for hand_id in ordered_candidates:
                detail_payloads = []
                for user in users:
                    detail = _request_json(
                        "GET",
                        f"{auth_api_url}/api/hands/{hand_id}",
                        expected_statuses=(200,),
                        headers=_auth_headers(user.token),
                    )
                    detail_payloads.append(detail)
                if all(_validate_common_hand_detail(detail, fixture, users) for detail in detail_payloads):
                    return hand_id, detail_payloads[0]

        if human_mode and time.time() - last_status_log >= 10:
            print("waiting for common hand; cleanup will run on timeout or Ctrl-C", flush=True)
            last_status_log = time.time()
        time.sleep(poll_interval_seconds)

    raise SmokeTestError("Timed out waiting for a persisted common hand for all expected participants")


def _assert_admin_outsider_checks(
    auth_api_url: str,
    game_server_url: str,
    admin_user: SessionUser,
    fixture: FixtureStack,
    common_hand_id: str,
) -> None:
    leagues = _request_json(
        "GET",
        f"{auth_api_url}/api/leagues",
        expected_statuses=(200,),
        headers=_auth_headers(admin_user.token),
    )
    if fixture.league_id in {int(item["id"]) for item in leagues}:
        raise SmokeTestError(f"Admin unexpectedly sees fixture league {fixture.league_id}")

    communities = _request_json(
        "GET",
        f"{auth_api_url}/api/communities",
        expected_statuses=(200,),
        headers=_auth_headers(admin_user.token),
    )
    if fixture.community_id in {int(item["id"]) for item in communities}:
        raise SmokeTestError(f"Admin unexpectedly sees fixture community {fixture.community_id}")

    _request_json(
        "GET",
        f"{auth_api_url}/api/communities/{fixture.community_id}/tables",
        expected_statuses=(404,),
        headers=_auth_headers(admin_user.token),
    )
    _request_json(
        "GET",
        f"{auth_api_url}/api/tables/{fixture.table_id}/seats",
        expected_statuses=(404,),
        headers=_auth_headers(admin_user.token),
    )
    _request_json(
        "POST",
        f"{auth_api_url}/api/tables/{fixture.table_id}/join",
        expected_statuses=(404,),
        headers=_auth_headers(admin_user.token),
        json={"buy_in_amount": 1000, "seat_number": 1},
    )
    _request_json(
        "GET",
        f"{auth_api_url}/api/hands/{common_hand_id}",
        expected_statuses=(404,),
        headers=_auth_headers(admin_user.token),
    )
    _assert_admin_spectator_denied(game_server_url, admin_user.token, fixture.table_id)


def _assert_admin_spectator_denied(game_server_url: str, admin_token: str, table_id: int, timeout_seconds: float = 5.0) -> None:
    sio = socketio.Client(logger=False, engineio_logger=False)
    response_event = threading.Event()
    response_payload: dict[str, Any] = {}

    @sio.on("connected")
    def _on_connected(_payload: Any) -> None:
        sio.emit("spectate_table", {"tableId": table_id})

    @sio.on("error")
    def _on_error(payload: Any) -> None:
        response_payload["event"] = "error"
        response_payload["payload"] = payload
        response_event.set()

    @sio.on("spectator_mode")
    def _on_spectator_mode(payload: Any) -> None:
        response_payload["event"] = "spectator_mode"
        response_payload["payload"] = payload
        response_event.set()

    @sio.on("game_state_update")
    def _on_game_state_update(payload: Any) -> None:
        response_payload["event"] = "game_state_update"
        response_payload["payload"] = payload
        response_event.set()

    @sio.event
    def connect_error(payload: Any) -> None:
        response_payload["event"] = "connect_error"
        response_payload["payload"] = payload
        response_event.set()

    try:
        sio.connect(
            game_server_url,
            auth={"token": admin_token, "spectator": True},
            wait_timeout=10,
        )
        if not response_event.wait(timeout_seconds):
            raise SmokeTestError("Expected table_not_found for admin spectate_table, got no response")
        if response_payload.get("event") != "error":
            raise SmokeTestError(
                f"Expected admin spectator denial, got {response_payload.get('event')}: {response_payload.get('payload')}"
            )
        payload = response_payload.get("payload") or {}
        if payload.get("code") != "table_not_found":
            raise SmokeTestError(f"Expected table_not_found spectator denial, got {payload}")
    finally:
        try:
            if sio.connected:
                sio.disconnect()
        except Exception:
            pass


def _write_human_credentials_file(
    human_user: SessionUser,
    *,
    run_tag: str,
    ui_url: str,
    community_id: int,
    table_id: int,
) -> Path:
    directory = PROJECT_ROOT / ".tmp" / "human-fixtures" / run_tag
    directory.mkdir(parents=True, exist_ok=True)
    credentials_path = directory / "human_credentials.txt"
    contents = (
        f"username={human_user.username}\n"
        f"password={human_user.password}\n"
        f"community_url={ui_url}/community/{community_id}\n"
        f"game_url={ui_url}/game/{table_id}?communityId={community_id}\n"
    )
    fd = os.open(credentials_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(contents)
    return credentials_path


def _write_summary(artifact_dir: Optional[Path], summary: RunSummary) -> None:
    if artifact_dir is None:
        return
    artifact_dir.mkdir(parents=True, exist_ok=True)
    summary_path = artifact_dir / "summary.json"
    summary_payload = _redact_secrets(asdict(summary))
    summary_path.write_text(json.dumps(summary_payload, indent=2, sort_keys=True), encoding="utf-8")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Autonomous gameplay E2E driver")
    parser.add_argument(
        "--mode",
        choices=("bot-vs-bot", "human-vs-bot"),
        default="bot-vs-bot",
        help="bot-vs-bot is automated; human-vs-bot waits for a real human to play the second seat",
    )
    parser.add_argument("--auth-api-url", default=os.getenv("AUTH_API_URL", "http://localhost:8000"))
    parser.add_argument("--game-server-url", default=os.getenv("GAME_SERVER_URL", "http://localhost:3000"))
    parser.add_argument("--ui-url", default=os.getenv("UI_URL", "http://localhost:5173"))
    parser.add_argument("--admin-username", default=os.getenv("ADMIN_USERNAME"))
    parser.add_argument("--admin-password", default=os.getenv("ADMIN_PASSWORD"))
    parser.add_argument("--run-tag", default=None)
    parser.add_argument("--artifact-dir", default=None)
    parser.add_argument("--starting-balance", type=int, default=10000)
    parser.add_argument("--buy-in", type=int, default=1000)
    parser.add_argument("--small-blind", type=int, default=10)
    parser.add_argument("--big-blind", type=int, default=20)
    parser.add_argument("--action-timeout-seconds", type=int, default=10)
    parser.add_argument("--timeout-seconds", type=int, default=DEFAULT_TIMEOUT_SECONDS)
    parser.add_argument("--human-timeout-seconds", type=int, default=None)
    parser.add_argument("--poll-interval-seconds", type=float, default=DEFAULT_POLL_INTERVAL_SECONDS)
    args = parser.parse_args()
    if not args.admin_username or not args.admin_password:
        parser.error("--admin-username and --admin-password are required (or set ADMIN_USERNAME / ADMIN_PASSWORD)")
    return args


def run() -> int:
    args = _parse_args()
    auth_api_url = _strip_trailing_slash(args.auth_api_url)
    game_server_url = _strip_trailing_slash(args.game_server_url)
    ui_url = _strip_trailing_slash(args.ui_url)
    run_tag = _validate_run_tag(args.run_tag) if args.run_tag else _generate_run_tag(args.mode)
    artifact_dir = Path(args.artifact_dir).resolve() if args.artifact_dir else None
    summary = RunSummary(mode=args.mode, run_tag=run_tag, admin_username=args.admin_username)
    tracker = PhaseTracker(summary)
    interrupt_state = InterruptState()
    previous_handlers = interrupt_state.install()
    stop_event = threading.Event()
    bot_error_queue: Queue[BaseException] = Queue()
    bot_handles: list[BotHandle] = []
    exit_code = 0
    admin_user: Optional[SessionUser] = None
    fixture: Optional[FixtureStack] = None
    fixture_users: list[SessionUser] = []
    fixture_create_dispatched = False
    cleanup_permitted = False

    try:
        print("=" * 84)
        print("AUTONOMOUS GAMEPLAY E2E")
        print("=" * 84)
        print(f"Mode: {args.mode}")
        print(f"Auth API: {auth_api_url}")
        print(f"Game Server: {game_server_url}")
        print(f"UI: {ui_url}")
        print(f"Run tag: {run_tag}")
        print()

        tracker.start("health_check")
        _health_check(auth_api_url, "Auth API")
        _health_check(game_server_url, "Game Server")
        interrupt_state.raise_if_interrupted()
        print("service health checks passed", flush=True)

        tracker.start("admin_login")
        admin_token, admin_user_id = _login_user_with_retry(auth_api_url, args.admin_username, args.admin_password)
        admin_user = SessionUser(
            user_id=admin_user_id,
            username=args.admin_username,
            email=f"{args.admin_username}@local.invalid",
            password=args.admin_password,
            token=admin_token,
            is_bot=False,
        )
        interrupt_state.raise_if_interrupted()
        print(f"admin login ready: {admin_user.username} (id={admin_user.user_id})", flush=True)

        tracker.start("fixture_create")
        fixture_create_dispatched = True
        cleanup_permitted = True
        try:
            fixture = _create_fixture_stack(
                auth_api_url,
                admin_user.token,
                run_tag=run_tag,
                starting_balance=args.starting_balance,
                buy_in=args.buy_in,
                small_blind=args.small_blind,
                big_blind=args.big_blind,
                action_timeout_seconds=args.action_timeout_seconds,
            )
        except HTTPRequestError as exc:
            if exc.status_code == 409:
                cleanup_permitted = False
            raise
        summary.league_id = fixture.league_id
        summary.community_id = fixture.community_id
        summary.table_id = fixture.table_id
        summary.game_id = fixture.game_id
        summary.fixture_usernames = [str(user["username"]) for user in fixture.users]
        print(
            f"fixture provisioned: league={fixture.league_id} community={fixture.community_id} "
            f"table={fixture.table_id} game={fixture.game_id}",
            flush=True,
        )

        tracker.start("fixture_user_login")
        sorted_users = sorted(fixture.users, key=lambda item: int(item.get("seat_number") or 99))
        if args.mode == "bot-vs-bot":
            fixture_users = [
                _create_session_user(auth_api_url, sorted_users[0], is_bot=True),
                _create_session_user(auth_api_url, sorted_users[1], is_bot=True),
            ]
        else:
            fixture_users = [
                _create_session_user(auth_api_url, sorted_users[0], is_bot=False),
                _create_session_user(auth_api_url, sorted_users[1], is_bot=True),
            ]
        print(
            "fixture users logged in: " + ", ".join(user.username for user in fixture_users),
            flush=True,
        )

        tracker.start("positive_access_checks")
        for viewer in fixture_users:
            _assert_fixture_access(auth_api_url, viewer, fixture, fixture_users)
        print("fixture-user access checks passed", flush=True)

        tracker.start("bot_connect")
        bot_users = [user for user in fixture_users if user.is_bot]
        for bot_user in bot_users:
            bot_handle = _start_bot_agent(
                bot_user,
                game_server_url,
                fixture.game_id,
                stop_event=stop_event,
                error_queue=bot_error_queue,
            )
            bot_handles.append(bot_handle)
            print(f"started bot agent for {bot_user.username}", flush=True)
        _wait_for_bot_connections(
            bot_handles,
            error_queue=bot_error_queue,
            interrupt_state=interrupt_state,
        )
        print("bot websocket connections established", flush=True)

        human_timeout = args.human_timeout_seconds or args.timeout_seconds or DEFAULT_HUMAN_TIMEOUT_SECONDS
        timeout_seconds = human_timeout if args.mode == "human-vs-bot" else args.timeout_seconds
        if args.mode == "human-vs-bot":
            human_user = next(user for user in fixture_users if not user.is_bot)
            credentials_path = _write_human_credentials_file(
                human_user,
                run_tag=run_tag,
                ui_url=ui_url,
                community_id=fixture.community_id,
                table_id=fixture.table_id,
            )
            print("interactive mode; cleanup will run on completion, timeout, or Ctrl-C", flush=True)
            print(f"credentials file: {credentials_path}", flush=True)
            print(f"community URL: {ui_url}/community/{fixture.community_id}", flush=True)
            print(f"direct game URL: {ui_url}/game/{fixture.table_id}?communityId={fixture.community_id}", flush=True)
            print(f"run tag: {run_tag}; table_id={fixture.table_id}; game_id={fixture.game_id}", flush=True)

        tracker.start("wait_for_common_hand")
        common_hand_id, _common_hand_detail = _wait_for_common_hand(
            auth_api_url,
            fixture_users,
            fixture,
            timeout_seconds=timeout_seconds,
            poll_interval_seconds=args.poll_interval_seconds,
            bot_handles=bot_handles,
            error_queue=bot_error_queue,
            interrupt_state=interrupt_state,
            human_mode=args.mode == "human-vs-bot",
        )
        summary.common_hand_id = common_hand_id
        print(f"common persisted hand found: {common_hand_id}", flush=True)

        tracker.start("admin_outsider_checks")
        _assert_admin_outsider_checks(auth_api_url, game_server_url, admin_user, fixture, common_hand_id)
        print("ordinary-admin outsider checks passed", flush=True)

        summary.status = "passed"
        tracker.start("done")
        print("AUTONOMOUS GAMEPLAY E2E PASSED", flush=True)
        return 0
    except InterruptedRun as exc:
        summary.status = "interrupted"
        summary.error = str(exc)
        exit_code = 130 if exc.signum == signal.SIGINT else 143
    except SmokeTestError as exc:
        summary.status = "failed"
        summary.error = str(exc)
        exit_code = 1
    except Exception as exc:  # pragma: no cover - defensive unexpected failure path
        summary.status = "failed"
        summary.error = f"Unexpected error: {exc}"
        print("Unexpected error during E2E run", file=sys.stderr)
        import traceback

        traceback.print_exc()
        exit_code = 1
    finally:
        _disconnect_bots(bot_handles, stop_event)
        if admin_user and fixture_create_dispatched and cleanup_permitted:
            tracker.start("cleanup")
            summary.cleanup.attempted = True
            try:
                cleanup_status, deleted_counts = _cleanup_fixture_stack(auth_api_url, admin_user.token, run_tag)
                summary.cleanup.succeeded = cleanup_status == "cleaned"
                summary.cleanup.deleted_counts = deleted_counts
                if not summary.cleanup.succeeded:
                    raise SmokeTestError(f"Fixture cleanup returned unexpected status {cleanup_status}")
                print(f"fixture cleanup succeeded: {deleted_counts}", flush=True)
            except HTTPRequestError as exc:
                if exc.status_code == 404 and fixture is None:
                    summary.cleanup.succeeded = True
                    print("fixture cleanup returned 404 before ownership was established; treating as no-op", flush=True)
                else:
                    summary.cleanup.error = str(exc)
                    summary.status = "failed"
                    if not summary.error:
                        summary.error = f"Fixture cleanup failed: {exc}"
                    if exit_code == 0:
                        exit_code = 1
                    print(f"fixture cleanup failed: {exc}", file=sys.stderr)
            except Exception as exc:
                summary.cleanup.error = str(exc)
                summary.status = "failed"
                if not summary.error:
                    summary.error = f"Fixture cleanup failed: {exc}"
                if exit_code == 0:
                    exit_code = 1
                print(f"fixture cleanup failed: {exc}", file=sys.stderr)
        if summary.status == "passed":
            tracker.start("done")
        tracker.finish()
        _write_summary(artifact_dir, summary)
        interrupt_state.restore(previous_handlers)

    if summary.status == "failed":
        print("AUTONOMOUS GAMEPLAY E2E FAILED", file=sys.stderr)
        if summary.error:
            print(summary.error, file=sys.stderr)
    elif summary.status == "interrupted":
        print(summary.error or "Interrupted", file=sys.stderr)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(run())

#!/usr/bin/env python3
"""
End-to-end autonomous bot gameplay smoke test.

This script provisions a disposable league/community/table, seats players,
starts autonomous bot client(s), and verifies that at least one hand is
recorded for each participant.

Modes:
- bot-vs-bot: Fully automated (two autonomous bots)
- human-vs-bot: Creates one human account + one autonomous bot and waits for
  you to play from the UI while the bot runs.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

try:
    import requests
except ModuleNotFoundError as exc:  # pragma: no cover - startup dependency guard
    raise SystemExit(
        "Missing dependency 'requests'. Activate the project virtualenv (e.g. `workon poker`) "
        "or install requirements before running this script."
    ) from exc

try:
    from jose import jwt
except ModuleNotFoundError as exc:  # pragma: no cover - startup dependency guard
    raise SystemExit(
        "Missing dependency 'python-jose'. Activate the project virtualenv (e.g. `workon poker`) "
        "or install requirements before running this script."
    ) from exc

# Allow importing poker-agent-api/agent_websocket.py from this top-level script.
PROJECT_ROOT = Path(__file__).resolve().parents[1]
AGENT_DIR = PROJECT_ROOT / "poker-agent-api"
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

from agent_websocket import WebSocketPokerAgent  # type: ignore  # noqa: E402


class SmokeTestError(RuntimeError):
    """Raised for deterministic smoke-test failures."""


@dataclass
class SessionUser:
    username: str
    password: str
    email: str
    token: str
    user_id: int
    is_bot: bool


def _validate_username_password_pair(parser: argparse.ArgumentParser, username: str | None, password: str | None, *, label: str) -> None:
    if (username and not password) or (password and not username):
        parser.error(f"{label}: provide both username and password together.")


def _strip_trailing_slash(value: str) -> str:
    return value.rstrip("/")


def _fmt_json(value: Any) -> str:
    try:
        return json.dumps(value, indent=2, ensure_ascii=True)
    except Exception:
        return str(value)


def _request_json(
    method: str,
    url: str,
    *,
    expected_statuses: Iterable[int],
    timeout_seconds: float = 15,
    **kwargs: Any,
) -> Any:
    response = requests.request(method, url, timeout=timeout_seconds, **kwargs)
    if response.status_code not in set(expected_statuses):
        body_text = response.text.strip()
        raise SmokeTestError(
            f"{method} {url} failed with {response.status_code}.\n"
            f"Response body:\n{body_text}"
        )
    if response.content:
        return response.json()
    return None


def _health_check(url: str, label: str) -> None:
    try:
        payload = _request_json("GET", f"{url}/health", expected_statuses=(200,), timeout_seconds=5)
    except Exception as exc:
        raise SmokeTestError(f"{label} health check failed at {url}/health: {exc}") from exc
    status = payload.get("status")
    if status not in {"ok", "healthy"}:
        raise SmokeTestError(f"{label} unhealthy status from {url}/health: {payload}")


def _decode_user_id(access_token: str) -> int:
    payload = jwt.decode(access_token, key="", options={"verify_signature": False})
    user_id = int(payload["user_id"])
    return user_id


def _register_user(auth_api_url: str, username: str, email: str, password: str) -> None:
    payload = _request_json(
        "POST",
        f"{auth_api_url}/auth/register",
        expected_statuses=(201,),
        json={"username": username, "email": email, "password": password},
    )
    if isinstance(payload, dict) and payload.get("requires_verification"):
        raise SmokeTestError(
            "Registration requires email verification in this environment. "
            "Run smoke tests in dev mode or use pre-verified users."
        )


def _login_user(auth_api_url: str, username: str, password: str) -> tuple[str, int]:
    payload = _request_json(
        "POST",
        f"{auth_api_url}/auth/login",
        expected_statuses=(200,),
        params={"username": username, "password": password},
    )
    if payload.get("requires_2fa"):
        raise SmokeTestError(
            f"User {username} requires admin 2FA verification. "
            "Use non-admin accounts for bot smoke tests."
        )
    token = payload.get("access_token")
    if not token:
        raise SmokeTestError(f"Login did not return access_token for user {username}: {payload}")
    return token, _decode_user_id(token)


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_league(auth_api_url: str, token: str, run_tag: str) -> int:
    payload = _request_json(
        "POST",
        f"{auth_api_url}/api/leagues",
        expected_statuses=(201,),
        headers=_auth_headers(token),
        json={
            "name": f"Bot Smoke League {run_tag}",
            "description": "Temporary league for autonomous bot gameplay smoke test",
        },
    )
    return int(payload["id"])


def _create_community(auth_api_url: str, token: str, league_id: int, run_tag: str, starting_balance: int) -> int:
    payload = _request_json(
        "POST",
        f"{auth_api_url}/api/leagues/{league_id}/communities",
        expected_statuses=(201,),
        headers=_auth_headers(token),
        json={
            "name": f"Bot Smoke Community {run_tag}",
            "description": "Temporary community for autonomous bot gameplay smoke test",
            "starting_balance": starting_balance,
        },
    )
    return int(payload["id"])


def _create_table(
    auth_api_url: str,
    token: str,
    community_id: int,
    run_tag: str,
    *,
    buy_in: int,
    small_blind: int,
    big_blind: int,
    max_seats: int,
    action_timeout_seconds: int,
) -> tuple[int, str]:
    payload = _request_json(
        "POST",
        f"{auth_api_url}/api/communities/{community_id}/tables",
        expected_statuses=(201,),
        headers=_auth_headers(token),
        json={
            "name": f"Bot Smoke Table {run_tag}",
            "game_type": "cash",
            "max_seats": max_seats,
            "small_blind": small_blind,
            "big_blind": big_blind,
            "buy_in": buy_in,
            "agents_allowed": True,
            "action_timeout_seconds": action_timeout_seconds,
            "is_permanent": False,
        },
    )
    table_id = int(payload["id"])
    table_name = str(payload["name"])
    return table_id, table_name


def _join_community(auth_api_url: str, token: str, community_id: int) -> None:
    _request_json(
        "POST",
        f"{auth_api_url}/api/communities/{community_id}/join",
        expected_statuses=(200,),
        headers=_auth_headers(token),
    )


def _join_table(auth_api_url: str, token: str, table_id: int, buy_in: int, seat_number: int) -> None:
    _request_json(
        "POST",
        f"{auth_api_url}/api/tables/{table_id}/join",
        expected_statuses=(200,),
        headers=_auth_headers(token),
        json={"buy_in_amount": buy_in, "seat_number": seat_number},
    )


def _wait_for_hands(
    auth_api_url: str,
    users: list[SessionUser],
    *,
    expected_table_name: str,
    timeout_seconds: int,
    poll_interval_seconds: float,
) -> dict[str, int]:
    deadline = time.time() + timeout_seconds
    hands_seen: dict[str, int] = {user.username: 0 for user in users}

    while time.time() < deadline:
        all_users_have_hand = True
        for user in users:
            payload = _request_json(
                "GET",
                f"{auth_api_url}/api/me/hands",
                expected_statuses=(200,),
                headers=_auth_headers(user.token),
                params={"limit": 25, "offset": 0},
            )
            matching_hands = [row for row in payload if row.get("table_name") == expected_table_name]
            hands_seen[user.username] = len(matching_hands)
            if not matching_hands:
                all_users_have_hand = False

        if all_users_have_hand:
            return hands_seen
        time.sleep(poll_interval_seconds)

    raise SmokeTestError(
        "Timed out waiting for recorded hand history.\n"
        f"Counts by user: {_fmt_json(hands_seen)}"
    )


def _start_bot_agent(bot_user: SessionUser, game_server_url: str, game_id: str) -> tuple[WebSocketPokerAgent, threading.Thread]:
    agent = WebSocketPokerAgent(
        token=bot_user.token,
        game_id=game_id,
        user_id=bot_user.user_id,
        server_url=game_server_url,
    )

    def _run() -> None:
        try:
            agent.connect_and_play()
        except SystemExit:
            # The shared agent class exits on disconnect/error; do not fail this script from thread context.
            return

    thread = threading.Thread(target=_run, daemon=True, name=f"bot-agent-{bot_user.username}")
    thread.start()
    return agent, thread


def _wait_for_bot_connections(agents: list[WebSocketPokerAgent], timeout_seconds: int = 20) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if all(agent.connected for agent in agents):
            return
        time.sleep(0.2)
    raise SmokeTestError("Timed out waiting for bot websocket connections.")


def _disconnect_agents(agents: list[WebSocketPokerAgent]) -> None:
    for agent in agents:
        try:
            if agent.connected:
                agent.sio.disconnect()
        except Exception:
            continue


def _create_session_user(auth_api_url: str, username: str, email: str, password: str, is_bot: bool) -> SessionUser:
    _register_user(auth_api_url, username, email, password)
    token, user_id = _login_user(auth_api_url, username, password)
    return SessionUser(
        username=username,
        password=password,
        email=email,
        token=token,
        user_id=user_id,
        is_bot=is_bot,
    )


def _login_existing_session_user(auth_api_url: str, username: str, password: str, *, is_bot: bool) -> SessionUser:
    token, user_id = _login_user(auth_api_url, username, password)
    return SessionUser(
        username=username,
        password=password,
        email=f"{username}@existing.local",
        token=token,
        user_id=user_id,
        is_bot=is_bot,
    )


def run() -> int:
    parser = argparse.ArgumentParser(description="Autonomous bot gameplay smoke test")
    parser.add_argument(
        "--mode",
        choices=("bot-vs-bot", "human-vs-bot"),
        default="bot-vs-bot",
        help="bot-vs-bot is fully automated; human-vs-bot waits for you to play from UI",
    )
    parser.add_argument("--auth-api-url", default=os.getenv("AUTH_API_URL", "http://localhost:8000"))
    parser.add_argument("--game-server-url", default=os.getenv("GAME_SERVER_URL", "http://localhost:3000"))
    parser.add_argument("--ui-url", default=os.getenv("UI_URL", "http://localhost:5173"))
    parser.add_argument("--password", default="BotSmokePass123!")
    parser.add_argument("--starting-balance", type=int, default=10000)
    parser.add_argument("--buy-in", type=int, default=1000)
    parser.add_argument("--small-blind", type=int, default=10)
    parser.add_argument("--big-blind", type=int, default=20)
    parser.add_argument("--action-timeout-seconds", type=int, default=10)
    parser.add_argument("--timeout-seconds", type=int, default=240)
    parser.add_argument("--poll-interval-seconds", type=float, default=2.0)
    parser.add_argument("--setup-username", default=None, help="Use existing setup user instead of auto-register")
    parser.add_argument("--setup-user-password", default=None)
    parser.add_argument("--human-username", default=None, help="Use existing human user for human-vs-bot mode")
    parser.add_argument("--human-password", default=None)
    parser.add_argument("--bot1-username", default=None, help="Use existing bot1 user instead of auto-register")
    parser.add_argument("--bot1-password", default=None)
    parser.add_argument("--bot2-username", default=None, help="Use existing bot2 user for bot-vs-bot mode")
    parser.add_argument("--bot2-password", default=None)
    args = parser.parse_args()

    _validate_username_password_pair(
        parser, args.setup_username, args.setup_user_password, label="setup user"
    )
    _validate_username_password_pair(
        parser, args.human_username, args.human_password, label="human user"
    )
    _validate_username_password_pair(
        parser, args.bot1_username, args.bot1_password, label="bot1 user"
    )
    _validate_username_password_pair(
        parser, args.bot2_username, args.bot2_password, label="bot2 user"
    )

    auth_api_url = _strip_trailing_slash(args.auth_api_url)
    game_server_url = _strip_trailing_slash(args.game_server_url)
    ui_url = _strip_trailing_slash(args.ui_url)
    run_tag = str(int(time.time()))

    print("=" * 84)
    print("AUTONOMOUS BOT GAMEPLAY SMOKE TEST")
    print("=" * 84)
    print(f"Mode: {args.mode}")
    print(f"Auth API: {auth_api_url}")
    print(f"Game Server: {game_server_url}")
    print(f"UI: {ui_url}")
    print()

    _health_check(auth_api_url, "Auth API")
    _health_check(game_server_url, "Game Server")
    print("✅ Service health checks passed")

    if args.setup_username:
        setup_user = _login_existing_session_user(
            auth_api_url=auth_api_url,
            username=args.setup_username,
            password=args.setup_user_password,
            is_bot=False,
        )
    else:
        try:
            setup_user = _create_session_user(
                auth_api_url=auth_api_url,
                username=f"bot_smoke_setup_{run_tag}",
                email=f"bot_smoke_setup_{run_tag}@example.com",
                password=args.password,
                is_bot=False,
            )
        except SmokeTestError as exc:
            if "requires email verification" in str(exc):
                raise SmokeTestError(
                    "Registration requires email verification in this environment.\n"
                    "Rerun using an existing verified setup account:\n"
                    "  --setup-username <username> --setup-user-password <password>"
                ) from exc
            raise
    print(f"✅ Setup user created: {setup_user.username} (id={setup_user.user_id})")

    league_id = _create_league(auth_api_url, setup_user.token, run_tag)
    community_id = _create_community(
        auth_api_url, setup_user.token, league_id, run_tag, args.starting_balance
    )
    table_id, table_name = _create_table(
        auth_api_url,
        setup_user.token,
        community_id,
        run_tag,
        buy_in=args.buy_in,
        small_blind=args.small_blind,
        big_blind=args.big_blind,
        max_seats=2,
        action_timeout_seconds=args.action_timeout_seconds,
    )
    game_id = f"table_{table_id}"
    print(f"✅ Provisioned table: id={table_id} game_id={game_id} community_id={community_id}")

    users: list[SessionUser] = []
    if args.mode == "bot-vs-bot":
        try:
            if args.bot1_username:
                users.append(
                    _login_existing_session_user(
                        auth_api_url=auth_api_url,
                        username=args.bot1_username,
                        password=args.bot1_password,
                        is_bot=True,
                    )
                )
            else:
                users.append(
                    _create_session_user(
                        auth_api_url=auth_api_url,
                        username=f"bot_smoke_bot1_{run_tag}",
                        email=f"bot_smoke_bot1_{run_tag}@example.com",
                        password=args.password,
                        is_bot=True,
                    )
                )
            if args.bot2_username:
                users.append(
                    _login_existing_session_user(
                        auth_api_url=auth_api_url,
                        username=args.bot2_username,
                        password=args.bot2_password,
                        is_bot=True,
                    )
                )
            else:
                users.append(
                    _create_session_user(
                        auth_api_url=auth_api_url,
                        username=f"bot_smoke_bot2_{run_tag}",
                        email=f"bot_smoke_bot2_{run_tag}@example.com",
                        password=args.password,
                        is_bot=True,
                    )
                )
        except SmokeTestError as exc:
            if "requires email verification" in str(exc):
                raise SmokeTestError(
                    "Registration requires email verification in this environment.\n"
                    "Rerun with existing verified bot users:\n"
                    "  --bot1-username <u1> --bot1-password <p1> --bot2-username <u2> --bot2-password <p2>"
                ) from exc
            raise
    else:
        try:
            if args.human_username:
                users.append(
                    _login_existing_session_user(
                        auth_api_url=auth_api_url,
                        username=args.human_username,
                        password=args.human_password,
                        is_bot=False,
                    )
                )
            else:
                users.append(
                    _create_session_user(
                        auth_api_url=auth_api_url,
                        username=f"bot_smoke_human_{run_tag}",
                        email=f"bot_smoke_human_{run_tag}@example.com",
                        password=args.password,
                        is_bot=False,
                    )
                )
            if args.bot1_username:
                users.append(
                    _login_existing_session_user(
                        auth_api_url=auth_api_url,
                        username=args.bot1_username,
                        password=args.bot1_password,
                        is_bot=True,
                    )
                )
            else:
                users.append(
                    _create_session_user(
                        auth_api_url=auth_api_url,
                        username=f"bot_smoke_bot1_{run_tag}",
                        email=f"bot_smoke_bot1_{run_tag}@example.com",
                        password=args.password,
                        is_bot=True,
                    )
                )
        except SmokeTestError as exc:
            if "requires email verification" in str(exc):
                raise SmokeTestError(
                    "Registration requires email verification in this environment.\n"
                    "Rerun with existing verified users:\n"
                    "  --human-username <human> --human-password <hp> --bot1-username <bot> --bot1-password <bp>"
                ) from exc
            raise

    for seat_number, user in enumerate(users, start=1):
        _join_community(auth_api_url, user.token, community_id)
        _join_table(auth_api_url, user.token, table_id, args.buy_in, seat_number)
        role = "bot" if user.is_bot else "human"
        print(f"✅ Seated {role} user {user.username} at seat {seat_number}")

    bot_users = [user for user in users if user.is_bot]
    agents: list[WebSocketPokerAgent] = []
    threads: list[threading.Thread] = []

    for bot_user in bot_users:
        agent, thread = _start_bot_agent(bot_user, game_server_url, game_id)
        agents.append(agent)
        threads.append(thread)
        print(f"🤖 Started bot agent thread for {bot_user.username}")

    _wait_for_bot_connections(agents)
    print("✅ Bot websocket connections established")

    if args.mode == "human-vs-bot":
        human_user = next(user for user in users if not user.is_bot)
        game_url = f"{ui_url}/game/{table_id}?communityId={community_id}"
        print()
        print("-" * 84)
        print("HUMAN TESTER ACTION REQUIRED")
        print("-" * 84)
        print(f"Login username: {human_user.username}")
        print(f"Login password: {human_user.password}")
        print(f"Community lobby URL: {ui_url}/community/{community_id}")
        print(f"Direct game URL: {game_url}")
        print("Open the UI, login as the human user above, and play at least one full hand.")
        print("This script will keep running and pass once both users have recorded hand history.")
        print("-" * 84)
        print()

    hand_counts = _wait_for_hands(
        auth_api_url=auth_api_url,
        users=users,
        expected_table_name=table_name,
        timeout_seconds=args.timeout_seconds,
        poll_interval_seconds=args.poll_interval_seconds,
    )
    print("✅ Hand history recorded for all expected participants")
    print(f"Hand counts by user: {_fmt_json(hand_counts)}")

    _disconnect_agents(agents)
    print("✅ Bot agents disconnected")
    print()
    print("SMOKE TEST PASSED")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(run())
    except SmokeTestError as exc:
        print()
        print("SMOKE TEST FAILED")
        print(str(exc))
        raise SystemExit(1)
    except KeyboardInterrupt:
        print("\nInterrupted.")
        raise SystemExit(130)

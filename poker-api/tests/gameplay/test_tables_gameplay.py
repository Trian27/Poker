from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

import httpx
import pytest

pytestmark = pytest.mark.gameplay


UI_HEADERS = {
    "X-Dormstacks-UI": "web",
    "Origin": "http://localhost:5173",
}


@dataclass
class SetupBundle:
    owner: Any
    member: Any
    outsider: Any
    league: Any
    community: Any


def create_user(
    db,
    auth_module: Any,
    models_module: Any,
    username: str,
    *,
    email: str | None = None,
    is_admin: bool = False,
    is_test_user: bool = False,
    test_run_tag: str | None = None,
) -> Any:
    user = models_module.User(
        username=username,
        email=email or f"{username}@example.com",
        hashed_password=auth_module.get_password_hash("password123"),
        is_active=True,
        email_verified=True,
        is_admin=is_admin,
        is_test_user=is_test_user,
        test_run_tag=test_run_tag,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def create_wallet(db, models_module: Any, user: Any, community: Any, balance: int) -> Any:
    wallet = models_module.Wallet(user_id=user.id, community_id=community.id, balance=Decimal(str(balance)))
    db.add(wallet)
    db.commit()
    db.refresh(wallet)
    return wallet


def seed_league_graph(db, app_modules: dict[str, Any]) -> SetupBundle:
    auth_module = app_modules["auth"]
    models_module = app_modules["models"]

    owner = create_user(db, auth_module, models_module, "owner")
    member = create_user(db, auth_module, models_module, "member")
    outsider = create_user(db, auth_module, models_module, "outsider")

    league = models_module.League(name="League One", description="Test league", owner_id=owner.id)
    db.add(league)
    db.commit()
    db.refresh(league)

    db.add(models_module.LeagueMember(league_id=league.id, user_id=owner.id))
    db.add(models_module.LeagueMember(league_id=league.id, user_id=member.id))
    db.commit()

    community = models_module.Community(
        name="Alpha Community",
        description="Test community",
        league_id=league.id,
        starting_balance=Decimal("1000.00"),
        commissioner_id=owner.id,
    )
    db.add(community)
    db.commit()
    db.refresh(community)

    return SetupBundle(owner=owner, member=member, outsider=outsider, league=league, community=community)


def set_current_user(auth_state: dict, user: Any) -> None:
    auth_state["user_id"] = user.id
    auth_state["username"] = user.username


def create_partitioned_fixture_graph(
    db,
    app_modules: dict[str, Any],
    *,
    run_tag: str,
    username_prefix: str,
) -> tuple[Any, Any, Any, Any]:
    auth_module = app_modules["auth"]
    models_module = app_modules["models"]
    user = create_user(
        db,
        auth_module,
        models_module,
        f"{username_prefix}_user",
        email=f"{username_prefix}@example.test",
        is_test_user=True,
        test_run_tag=run_tag,
    )
    league = models_module.League(
        name=f"{username_prefix} League",
        description="Test league",
        owner_id=user.id,
        is_test_only=True,
        test_run_tag=run_tag,
    )
    db.add(league)
    db.commit()
    db.refresh(league)
    db.add(models_module.LeagueMember(league_id=league.id, user_id=user.id))
    community = models_module.Community(
        name=f"{username_prefix} Community",
        description="Test community",
        league_id=league.id,
        starting_balance=Decimal("1000.00"),
        commissioner_id=user.id,
        is_test_only=True,
        test_run_tag=run_tag,
    )
    db.add(community)
    db.commit()
    db.refresh(community)
    create_wallet(db, models_module, user, community, 2000)
    table = create_cash_table(db, models_module, community, user)
    table.is_test_only = True
    table.test_run_tag = run_tag
    db.commit()
    db.refresh(table)
    return user, league, community, table


def create_cash_table(db, models_module: Any, community: Any, owner: Any, *, max_seats: int = 4, buy_in: int = 200, max_queue_size: int = 5) -> Any:
    table = models_module.Table(
        community_id=community.id,
        name="Cash Table",
        status=models_module.TableStatus.WAITING,
        game_type=models_module.GameType.CASH,
        max_seats=max_seats,
        small_blind=10,
        big_blind=20,
        buy_in=buy_in,
        is_permanent=False,
        created_by_user_id=owner.id,
        max_queue_size=max_queue_size,
        action_timeout_seconds=30,
        agents_allowed=True,
    )
    db.add(table)
    db.commit()
    db.refresh(table)

    for seat_number in range(1, max_seats + 1):
        db.add(models_module.TableSeat(table_id=table.id, seat_number=seat_number))
    db.commit()
    return table


def test_create_table_populates_seats_and_defaults(client, db_session, auth_state, app_modules):
    models_module = app_modules["models"]
    setup = seed_league_graph(db_session, app_modules)
    create_wallet(db_session, models_module, setup.owner, setup.community, 5000)
    set_current_user(auth_state, setup.owner)

    response = client.post(
        f"/api/communities/{setup.community.id}/tables",
        headers=UI_HEADERS,
        json={
            "name": "Gameplay Table",
            "game_type": "cash",
            "max_seats": 4,
            "small_blind": 10,
            "big_blind": 20,
            "buy_in": 250,
            "max_queue_size": 7,
            "action_timeout_seconds": 25,
            "agents_allowed": True,
        },
    )

    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["name"] == "Gameplay Table"
    assert payload["max_queue_size"] == 7
    assert payload["action_timeout_seconds"] == 25

    seats = db_session.query(models_module.TableSeat).filter(models_module.TableSeat.table_id == payload["id"]).order_by(models_module.TableSeat.seat_number).all()
    assert len(seats) == 4
    assert [seat.seat_number for seat in seats] == [1, 2, 3, 4]



def test_join_table_debits_wallet_and_calls_game_server(client, db_session, auth_state, app_modules, monkeypatch):
    models_module = app_modules["models"]
    setup = seed_league_graph(db_session, app_modules)
    wallet = create_wallet(db_session, models_module, setup.member, setup.community, 1200)
    table = create_cash_table(db_session, models_module, setup.community, setup.owner)
    set_current_user(auth_state, setup.member)

    seat_calls: list[dict] = []

    async def fake_post_game_server_json(path: str, payload: dict, timeout: float = 10.0) -> httpx.Response:
        seat_calls.append({"path": path, "payload": payload, "timeout": timeout})
        return httpx.Response(200, json={"success": True})

    monkeypatch.setattr(app_modules["main"], "post_game_server_json", fake_post_game_server_json)

    response = client.post(
        f"/api/tables/{table.id}/join",
        json={"buy_in_amount": 300, "seat_number": 2},
    )

    assert response.status_code == 200, response.text
    assert response.json()["new_balance"] == 900.0
    db_session.refresh(wallet)
    assert float(wallet.balance) == 900.0

    occupied_seat = db_session.query(models_module.TableSeat).filter(models_module.TableSeat.table_id == table.id, models_module.TableSeat.seat_number == 2).first()
    assert occupied_seat is not None
    assert occupied_seat.user_id == setup.member.id

    active_session = db_session.query(models_module.TableSession).filter(models_module.TableSession.table_id == table.id, models_module.TableSession.user_id == setup.member.id, models_module.TableSession.left_at.is_(None)).one()
    assert active_session.buy_in_amount == 300

    assert len(seat_calls) == 1
    assert seat_calls[0]["path"] == "/_internal/seat-player"
    assert seat_calls[0]["payload"]["seat_number"] == 2
    assert seat_calls[0]["payload"]["user_id"] == setup.member.id



def test_rejoin_existing_seat_is_idempotent_and_does_not_double_debit(client, db_session, auth_state, app_modules, monkeypatch):
    models_module = app_modules["models"]
    setup = seed_league_graph(db_session, app_modules)
    wallet = create_wallet(db_session, models_module, setup.member, setup.community, 1500)
    table = create_cash_table(db_session, models_module, setup.community, setup.owner)
    set_current_user(auth_state, setup.member)

    async def fake_post_game_server_json(path: str, payload: dict, timeout: float = 10.0) -> httpx.Response:
        return httpx.Response(200, json={"success": True})

    monkeypatch.setattr(app_modules["main"], "post_game_server_json", fake_post_game_server_json)

    first_join = client.post(f"/api/tables/{table.id}/join", json={"buy_in_amount": 300, "seat_number": 1})
    assert first_join.status_code == 200, first_join.text
    db_session.refresh(wallet)
    assert float(wallet.balance) == 1200.0

    second_join = client.post(f"/api/tables/{table.id}/join", json={"buy_in_amount": 300, "seat_number": 1})
    assert second_join.status_code == 200, second_join.text
    db_session.refresh(wallet)
    assert float(wallet.balance) == 1200.0

    sessions = db_session.query(models_module.TableSession).filter(models_module.TableSession.table_id == table.id, models_module.TableSession.user_id == setup.member.id, models_module.TableSession.left_at.is_(None)).all()
    assert len(sessions) == 1



def test_join_table_rejects_insufficient_funds(client, db_session, auth_state, app_modules, monkeypatch):
    models_module = app_modules["models"]
    setup = seed_league_graph(db_session, app_modules)
    wallet = create_wallet(db_session, models_module, setup.member, setup.community, 150)
    table = create_cash_table(db_session, models_module, setup.community, setup.owner, buy_in=100)
    set_current_user(auth_state, setup.member)

    async def should_not_call_game_server(path: str, payload: dict, timeout: float = 10.0) -> httpx.Response:
        raise AssertionError("game server should not be called on insufficient funds")

    monkeypatch.setattr(app_modules["main"], "post_game_server_json", should_not_call_game_server)

    response = client.post(f"/api/tables/{table.id}/join", json={"buy_in_amount": 300, "seat_number": 1})
    assert response.status_code == 400
    assert "Insufficient funds" in response.json()["detail"]
    db_session.refresh(wallet)
    assert float(wallet.balance) == 150.0



def test_queue_join_leave_and_reorder(client, db_session, auth_state, app_modules):
    models_module = app_modules["models"]
    setup = seed_league_graph(db_session, app_modules)
    create_wallet(db_session, models_module, setup.member, setup.community, 1000)
    create_wallet(db_session, models_module, setup.outsider, setup.community, 1000)
    table = create_cash_table(db_session, models_module, setup.community, setup.owner)

    set_current_user(auth_state, setup.member)
    first_join = client.post(f"/api/tables/{table.id}/queue/join")
    assert first_join.status_code == 200, first_join.text
    assert first_join.json()["position"] == 1

    set_current_user(auth_state, setup.outsider)
    second_join = client.post(f"/api/tables/{table.id}/queue/join")
    assert second_join.status_code == 200, second_join.text
    assert second_join.json()["position"] == 2

    set_current_user(auth_state, setup.member)
    leave_response = client.delete(f"/api/tables/{table.id}/queue/leave")
    assert leave_response.status_code == 204

    queue_entries = db_session.query(models_module.TableQueue).filter(models_module.TableQueue.table_id == table.id).order_by(models_module.TableQueue.position).all()
    assert len(queue_entries) == 1
    assert queue_entries[0].user_id == setup.outsider.id
    assert queue_entries[0].position == 1



def test_unseat_promotes_first_queued_player_and_debits_wallet(client, db_session, auth_state, app_modules, monkeypatch):
    models_module = app_modules["models"]
    setup = seed_league_graph(db_session, app_modules)
    create_wallet(db_session, models_module, setup.owner, setup.community, 1000)
    queued_wallet = create_wallet(db_session, models_module, setup.member, setup.community, 1000)
    table = create_cash_table(db_session, models_module, setup.community, setup.owner, buy_in=200)

    seat_one = db_session.query(models_module.TableSeat).filter(models_module.TableSeat.table_id == table.id, models_module.TableSeat.seat_number == 1).one()
    seat_one.user_id = setup.owner.id
    db_session.add(models_module.TableSession(user_id=setup.owner.id, table_id=table.id, community_id=setup.community.id, table_name=table.name, buy_in_amount=200))
    db_session.add(models_module.TableQueue(table_id=table.id, user_id=setup.member.id, position=1))
    db_session.commit()

    calls: list[dict] = []

    async def fake_post_game_server_json(path: str, payload: dict, timeout: float = 10.0) -> httpx.Response:
        calls.append(payload)
        return httpx.Response(200, json={"success": True})

    monkeypatch.setattr(app_modules["main"], "post_game_server_json", fake_post_game_server_json)

    response = client.post(f"/api/internal/tables/{table.id}/unseat/{setup.owner.id}")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["success"] is True
    assert payload["auto_seated"]["user_id"] == setup.member.id
    assert payload["auto_seated"]["seat_number"] == 1

    db_session.refresh(queued_wallet)
    assert float(queued_wallet.balance) == 800.0
    db_session.refresh(seat_one)
    assert seat_one.user_id == setup.member.id
    assert db_session.query(models_module.TableQueue).filter(models_module.TableQueue.table_id == table.id).count() == 0
    assert calls and calls[0]["user_id"] == setup.member.id



def test_active_seat_endpoint_reflects_join_and_leave(client, db_session, auth_state, app_modules, monkeypatch):
    models_module = app_modules["models"]
    setup = seed_league_graph(db_session, app_modules)
    create_wallet(db_session, models_module, setup.member, setup.community, 1000)
    table = create_cash_table(db_session, models_module, setup.community, setup.owner)
    set_current_user(auth_state, setup.member)

    async def fake_post_game_server_json(path: str, payload: dict, timeout: float = 10.0) -> httpx.Response:
        return httpx.Response(200, json={"success": True})

    monkeypatch.setattr(app_modules["main"], "post_game_server_json", fake_post_game_server_json)

    join_response = client.post(f"/api/tables/{table.id}/join", json={"buy_in_amount": 200, "seat_number": 3})
    assert join_response.status_code == 200, join_response.text

    active_response = client.get("/api/tables/me/active-seat")
    assert active_response.status_code == 200
    assert active_response.json()["active"] is True
    assert active_response.json()["table_id"] == table.id
    assert active_response.json()["seat_number"] == 3

    leave_response = client.post(f"/api/tables/{table.id}/leave")
    assert leave_response.status_code == 200, leave_response.text

    active_after_leave = client.get("/api/tables/me/active-seat")
    assert active_after_leave.status_code == 200
    assert active_after_leave.json()["active"] is False



def test_hand_history_summary_and_detail_are_scoped_to_participants(client, db_session, auth_state, app_modules):
    setup = seed_league_graph(db_session, app_modules)

    hand_data = {
        "players": [
            {"user_id": setup.owner.id, "username": setup.owner.username, "seat_number": 1},
            {"user_id": setup.member.id, "username": setup.member.username, "seat_number": 2},
        ],
        "community_cards": [],
        "blinds": {"small_blind": 10, "big_blind": 20},
        "action_log": [
            {"sequence": 1, "stage": "preflop", "action": "small-blind", "player_id": f"player_{setup.owner.id}_1"},
            {"sequence": 2, "stage": "preflop", "action": "big-blind", "player_id": f"player_{setup.member.id}_1"},
        ],
        "pot_size": 30,
        "winner": {"username": setup.owner.username},
    }

    response = client.post(
        "/_internal/history/record",
        json={
            "community_id": setup.community.id,
            "table_id": None,
            "table_name": "History Table",
            "hand_data": hand_data,
        },
    )
    assert response.status_code == 201, response.text
    hand_id = response.json()["hand_id"]
    UUID(hand_id)

    set_current_user(auth_state, setup.owner)
    my_hands = client.get("/api/me/hands")
    assert my_hands.status_code == 200
    assert len(my_hands.json()) == 1
    assert my_hands.json()[0]["id"] == hand_id

    hand_detail = client.get(f"/api/hands/{hand_id}")
    assert hand_detail.status_code == 200
    assert hand_detail.json()["hand_data"]["pot_size"] == 30

    set_current_user(auth_state, setup.member)
    other_participant = client.get(f"/api/hands/{hand_id}")
    assert other_participant.status_code == 200

    set_current_user(auth_state, setup.outsider)
    outsider_summary = client.get("/api/me/hands")
    assert outsider_summary.status_code == 200
    assert outsider_summary.json() == []

    outsider_detail = client.get(f"/api/hands/{hand_id}")
    assert outsider_detail.status_code == 404


def test_normal_public_mutation_routes_reject_partition_fields(client):
    register_response = client.post(
        "/auth/register",
        json={
            "username": "normaluser",
            "email": "normal@example.com",
            "password": "password123",
            "is_test_user": True,
            "test_run_tag": "run-a",
        },
    )
    assert register_response.status_code == 422


def test_cross_run_test_users_cannot_access_other_run_tables(client, db_session, auth_state, app_modules):
    run_a_user, _, _, _ = create_partitioned_fixture_graph(
        db_session,
        app_modules,
        run_tag="run-a",
        username_prefix="run_a",
    )
    _, _, run_b_community, run_b_table = create_partitioned_fixture_graph(
        db_session,
        app_modules,
        run_tag="run-b",
        username_prefix="run_b",
    )

    set_current_user(auth_state, run_a_user)

    tables_response = client.get(f"/api/communities/{run_b_community.id}/tables")
    assert tables_response.status_code == 404

    queue_response = client.get(f"/api/tables/{run_b_table.id}/queue")
    assert queue_response.status_code == 404

    join_queue_response = client.post(f"/api/tables/{run_b_table.id}/queue/join")
    assert join_queue_response.status_code == 404


def test_fixture_api_provisions_and_cleans_up_same_run_stack(client, db_session, auth_state, app_modules, monkeypatch):
    models_module = app_modules["models"]
    main_module = app_modules["main"]
    previous_flag = main_module.settings.ENABLE_TEST_FIXTURE_API
    main_module.settings.ENABLE_TEST_FIXTURE_API = True
    try:
        admin_user = create_user(
            db_session,
            app_modules["auth"],
            models_module,
            "fixture_admin",
            is_admin=True,
        )
        set_current_user(auth_state, admin_user)

        calls: list[tuple[str, dict[str, Any]]] = []

        async def fake_post_game_server_json(path: str, payload: dict, timeout: float = 10.0) -> httpx.Response:
            calls.append((path, payload))
            return httpx.Response(200, json={"success": True})

        monkeypatch.setattr(main_module, "post_game_server_json", fake_post_game_server_json)

        create_response = client.post(
            "/api/admin/test-fixtures/gameplay-stack",
            json={
                "run_tag": "fixture-run-1",
                "player_count": 2,
                "queued_player_count": 0,
                "starting_balance": "1000.00",
                "buy_in": 200,
                "small_blind": 10,
                "big_blind": 20,
                "max_seats": 2,
                "max_queue_size": 0,
                "action_timeout_seconds": 30,
            },
        )
        assert create_response.status_code == 201, create_response.text
        payload = create_response.json()
        assert payload["run_tag"] == "fixture-run-1"
        assert len(payload["users"]) == 2
        assert all(user["is_test_user"] is True for user in payload["users"])

        fixture_run = db_session.query(models_module.TestFixtureRun).filter_by(run_tag="fixture-run-1").one()
        assert fixture_run.status == "active"

        duplicate_response = client.post(
            "/api/admin/test-fixtures/gameplay-stack",
            json={
                "run_tag": "fixture-run-1",
                "player_count": 2,
                "queued_player_count": 0,
                "starting_balance": "1000.00",
                "buy_in": 200,
                "small_blind": 10,
                "big_blind": 20,
                "max_seats": 2,
                "max_queue_size": 0,
                "action_timeout_seconds": 30,
            },
        )
        assert duplicate_response.status_code == 409

        created_user_ids = [user["user_id"] for user in payload["users"]]
        db_session.add(
            models_module.EmailVerification(
                email=payload["users"][0]["email"],
                username=payload["users"][0]["username"],
                hashed_password="hash",
                purpose="account_recovery",
                user_id=created_user_ids[0],
                verification_code="123456",
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
                verified=False,
            )
        )
        db_session.commit()

        cleanup_response = client.delete("/api/admin/test-fixtures/runs/fixture-run-1")
        assert cleanup_response.status_code == 200, cleanup_response.text
        cleanup_payload = cleanup_response.json()
        assert cleanup_payload["status"] == "cleaned"
        assert cleanup_payload["deleted"]["users"] == 2
        assert cleanup_payload["deleted"]["tables"] == 1
        assert cleanup_payload["deleted"]["email_verifications"] >= 1

        db_session.expire_all()
        cleaned_run = db_session.query(models_module.TestFixtureRun).filter_by(run_tag="fixture-run-1").one()
        assert cleaned_run.status == "cleaned"

        second_cleanup = client.delete("/api/admin/test-fixtures/runs/fixture-run-1")
        assert second_cleanup.status_code == 200
        assert second_cleanup.json()["deleted"]["users"] == 0

        assert any(path == "/_internal/game/table_1/purge" or path.endswith("/purge") for path, _ in calls)
    finally:
        main_module.settings.ENABLE_TEST_FIXTURE_API = previous_flag

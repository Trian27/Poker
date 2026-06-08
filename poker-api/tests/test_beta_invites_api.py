from __future__ import annotations

from datetime import timedelta
from typing import Any


UI_HEADERS = {
    "X-Dormstacks-UI": "web",
    "Origin": "http://localhost:5173",
}


def create_user(
    db,
    auth_module: Any,
    models_module: Any,
    username: str,
    *,
    email: str | None = None,
    is_admin: bool = False,
) -> Any:
    user = models_module.User(
        username=username,
        email=email or f"{username}@example.com",
        hashed_password=auth_module.get_password_hash("password123"),
        is_active=True,
        email_verified=True,
        is_admin=is_admin,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def set_current_user(auth_state: dict[str, Any], user: Any) -> None:
    auth_state["user_id"] = user.id
    auth_state["username"] = user.username


def test_global_admin_can_create_beta_invite_and_list_it(client, db_session, auth_state, app_modules, monkeypatch):
    auth_module = app_modules["auth"]
    main_module = app_modules["main"]
    models_module = app_modules["models"]
    admin_user = create_user(db_session, auth_module, models_module, "globaladmin", is_admin=True)
    set_current_user(auth_state, admin_user)
    monkeypatch.setattr(main_module.settings, "BETA_INVITE_BASE_URL", "https://beta.example.com")
    monkeypatch.setattr(main_module, "_generate_beta_invite_token", lambda: "fixed-token")
    monkeypatch.setattr(main_module, "_send_beta_invite_email", lambda *args, **kwargs: True)

    create_response = client.post(
        "/api/admin/beta-invites",
        headers=UI_HEADERS,
        json={
            "email": "Invitee@Example.com",
            "notes": "Priority creator",
        },
    )

    assert create_response.status_code == 201
    create_body = create_response.json()
    assert create_body["email"] == "invitee@example.com"
    assert create_body["notes"] == "Priority creator"
    assert create_body["created_by_user_id"] == admin_user.id
    assert create_body["redeemed_by_user_id"] is None
    assert create_body["status"] == "pending"
    assert create_body["delivery_status"] == "sent"
    assert create_body["invite_url"].endswith("/invite/fixed-token")
    assert create_body["used_at"] is None
    assert create_body["revoked_at"] is None
    assert create_body["sent_at"] is not None
    assert create_body["expires_at"] is not None

    list_response = client.get("/api/admin/beta-invites")

    assert list_response.status_code == 200
    list_body = list_response.json()
    assert len(list_body["items"]) == 1
    listed_invite = list_body["items"][0]
    assert listed_invite["id"] == create_body["id"]
    assert listed_invite["email"] == create_body["email"]
    assert listed_invite["notes"] == create_body["notes"]
    assert listed_invite["created_by_user_id"] == create_body["created_by_user_id"]
    assert listed_invite["redeemed_by_user_id"] is None
    assert listed_invite["status"] == "pending"
    assert listed_invite["delivery_status"] == "sent"
    assert listed_invite["invite_url"] is None
    assert listed_invite["sent_at"] == create_body["sent_at"]
    assert listed_invite["created_at"] == create_body["created_at"]
    assert listed_invite["expires_at"] == create_body["expires_at"]
    assert listed_invite["used_at"] is None
    assert listed_invite["revoked_at"] is None

    stored_invite = db_session.query(models_module.BetaInvite).one()
    assert stored_invite.email == "invitee@example.com"
    assert stored_invite.created_by_user_id == admin_user.id
    assert stored_invite.token_hash
    assert stored_invite.token_hash not in create_body["invite_url"]


def test_non_admin_cannot_create_beta_invites(client, db_session, auth_state, app_modules):
    auth_module = app_modules["auth"]
    models_module = app_modules["models"]
    regular_user = create_user(db_session, auth_module, models_module, "regularuser", is_admin=False)
    set_current_user(auth_state, regular_user)

    response = client.post(
        "/api/admin/beta-invites",
        headers=UI_HEADERS,
        json={
            "email": "invitee@example.com",
        },
    )

    assert response.status_code == 403
    assert response.json() == {"detail": "Admin access required"}


def test_admin_can_resend_and_rotate_beta_invite_token(client, db_session, auth_state, app_modules, monkeypatch):
    auth_module = app_modules["auth"]
    main_module = app_modules["main"]
    models_module = app_modules["models"]
    admin_user = create_user(db_session, auth_module, models_module, "adminresend", is_admin=True)
    set_current_user(auth_state, admin_user)
    token_values = iter(["first-token", "second-token"])
    monkeypatch.setattr(main_module.settings, "BETA_INVITE_BASE_URL", "https://beta.example.com")
    monkeypatch.setattr(main_module, "_generate_beta_invite_token", lambda: next(token_values))
    monkeypatch.setattr(main_module, "_send_beta_invite_email", lambda *args, **kwargs: True)

    created = client.post(
        "/api/admin/beta-invites",
        headers=UI_HEADERS,
        json={"email": "resend@example.com"},
    )

    assert created.status_code == 201
    invite_id = created.json()["id"]
    original_hash = db_session.query(models_module.BetaInvite).filter_by(id=invite_id).one().token_hash

    resent = client.post(
        f"/api/admin/beta-invites/{invite_id}/resend",
        headers=UI_HEADERS,
    )

    assert resent.status_code == 200
    body = resent.json()
    assert body["status"] == "pending"
    assert body["delivery_status"] == "sent"
    assert body["invite_url"].endswith("/invite/second-token")

    refreshed_invite = db_session.query(models_module.BetaInvite).filter_by(id=invite_id).one()
    assert refreshed_invite.token_hash != original_hash
    assert refreshed_invite.sent_at is not None


def test_admin_gets_manual_link_when_invite_email_send_fails(client, db_session, auth_state, app_modules, monkeypatch):
    auth_module = app_modules["auth"]
    main_module = app_modules["main"]
    models_module = app_modules["models"]
    admin_user = create_user(db_session, auth_module, models_module, "adminmanual", is_admin=True)
    set_current_user(auth_state, admin_user)
    monkeypatch.setattr(main_module.settings, "BETA_INVITE_BASE_URL", "https://beta.example.com")
    monkeypatch.setattr(main_module, "_generate_beta_invite_token", lambda: "manual-token")
    monkeypatch.setattr(main_module, "_send_beta_invite_email", lambda *args, **kwargs: False)

    created = client.post(
        "/api/admin/beta-invites",
        headers=UI_HEADERS,
        json={"email": "manual@example.com"},
    )

    assert created.status_code == 201
    invite_id = created.json()["id"]

    resent = client.post(
        f"/api/admin/beta-invites/{invite_id}/resend",
        headers=UI_HEADERS,
    )

    assert resent.status_code == 200
    body = resent.json()
    assert body["delivery_status"] == "manual_required"
    assert body["invite_url"].endswith("/invite/manual-token")
    assert body["sent_at"] is None


def test_admin_can_revoke_pending_beta_invite(client, db_session, auth_state, app_modules, monkeypatch):
    auth_module = app_modules["auth"]
    main_module = app_modules["main"]
    models_module = app_modules["models"]
    admin_user = create_user(db_session, auth_module, models_module, "adminrevoke", is_admin=True)
    set_current_user(auth_state, admin_user)
    monkeypatch.setattr(main_module.settings, "BETA_INVITE_BASE_URL", "https://beta.example.com")
    monkeypatch.setattr(main_module, "_generate_beta_invite_token", lambda: "revoke-token")
    monkeypatch.setattr(main_module, "_send_beta_invite_email", lambda *args, **kwargs: True)

    created = client.post(
        "/api/admin/beta-invites",
        headers=UI_HEADERS,
        json={"email": "revoke@example.com"},
    )

    assert created.status_code == 201
    invite_id = created.json()["id"]

    revoked = client.post(
        f"/api/admin/beta-invites/{invite_id}/revoke",
        headers=UI_HEADERS,
    )

    assert revoked.status_code == 200
    body = revoked.json()
    assert body["status"] == "revoked"
    assert body["revoked_at"] is not None


def test_valid_beta_invite_can_be_looked_up_and_accepted(client, db_session, auth_state, app_modules, monkeypatch):
    auth_module = app_modules["auth"]
    main_module = app_modules["main"]
    models_module = app_modules["models"]
    admin_user = create_user(db_session, auth_module, models_module, "adminaccept", is_admin=True)
    set_current_user(auth_state, admin_user)
    monkeypatch.setattr(main_module.settings, "BETA_INVITE_BASE_URL", "https://beta.example.com")
    monkeypatch.setattr(main_module, "_generate_beta_invite_token", lambda: "accept-token")
    monkeypatch.setattr(main_module, "_send_beta_invite_email", lambda *args, **kwargs: True)

    created = client.post(
        "/api/admin/beta-invites",
        headers=UI_HEADERS,
        json={"email": "accept@example.com"},
    )

    assert created.status_code == 201

    lookup = client.get("/auth/invite/accept-token")

    assert lookup.status_code == 200
    assert lookup.json()["email"] == "accept@example.com"

    accepted = client.post(
        "/auth/invite/accept-token/accept",
        headers=UI_HEADERS,
        json={"username": "accepteduser", "password": "password123"},
    )

    assert accepted.status_code == 201
    body = accepted.json()
    assert body["success"] is True
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["user"]["email"] == "accept@example.com"
    assert body["user"]["is_admin"] is False
    assert body["user"]["is_test_user"] is False


def test_expired_beta_invite_cannot_be_accepted(client, db_session, auth_state, app_modules, monkeypatch):
    auth_module = app_modules["auth"]
    main_module = app_modules["main"]
    models_module = app_modules["models"]
    admin_user = create_user(db_session, auth_module, models_module, "adminexpired", is_admin=True)
    set_current_user(auth_state, admin_user)
    monkeypatch.setattr(main_module.settings, "BETA_INVITE_BASE_URL", "https://beta.example.com")
    monkeypatch.setattr(main_module, "_generate_beta_invite_token", lambda: "expired-token")
    monkeypatch.setattr(main_module, "_send_beta_invite_email", lambda *args, **kwargs: True)

    created = client.post(
        "/api/admin/beta-invites",
        headers=UI_HEADERS,
        json={"email": "expired@example.com"},
    )

    assert created.status_code == 201
    invite_id = created.json()["id"]
    invite = db_session.query(models_module.BetaInvite).filter_by(id=invite_id).one()
    invite.expires_at = main_module._utc_now() - timedelta(hours=1)
    db_session.commit()

    accepted = client.post(
        "/auth/invite/expired-token/accept",
        headers=UI_HEADERS,
        json={"username": "expireduser", "password": "password123"},
    )

    assert accepted.status_code == 410
    assert accepted.json()["detail"] == "Beta invite has expired"


def test_register_is_blocked_when_invite_only_registration_is_enabled(client, app_modules, monkeypatch):
    config_module = app_modules["config"]
    main_module = app_modules["main"]
    monkeypatch.setattr(config_module.settings, "INVITE_ONLY_REGISTRATION", True)
    monkeypatch.setattr(main_module.settings, "INVITE_ONLY_REGISTRATION", True)

    response = client.post(
        "/auth/register",
        json={"username": "blockeduser", "email": "blocked@example.com", "password": "password123"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Registration is invite-only for this beta"

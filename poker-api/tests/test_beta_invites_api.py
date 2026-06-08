from __future__ import annotations

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

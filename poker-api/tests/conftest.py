from __future__ import annotations

import importlib
import os
import sys
import uuid
from typing import Any
from urllib.parse import urlparse, urlunparse

import psycopg2
from psycopg2 import sql
import pytest
from fastapi.testclient import TestClient


DEFAULT_DATABASE_URL = "postgresql://trian@localhost:5432/poker_platform"

APP_MODULE_IMPORT_ORDER = [
    "app.main",
    "app.schema_migrations",
    "app.auth",
    "app.models",
    "app.database",
    "app.config",
]


def _admin_database_url(database_url: str) -> str:
    parsed = urlparse(database_url)
    return urlunparse(parsed._replace(path="/postgres"))


@pytest.fixture(scope="session")
def test_database_url() -> str:
    base_url = os.environ.get("TEST_DATABASE_BASE_URL") or os.environ.get("DATABASE_URL") or DEFAULT_DATABASE_URL
    parsed = urlparse(base_url)
    test_db_name = f"poker_test_{uuid.uuid4().hex[:8]}"
    admin_url = _admin_database_url(base_url)

    admin_conn = psycopg2.connect(admin_url)
    admin_conn.autocommit = True
    try:
        with admin_conn.cursor() as cur:
            cur.execute(sql.SQL("CREATE DATABASE {}") .format(sql.Identifier(test_db_name)))
    finally:
        admin_conn.close()

    test_url = urlunparse(parsed._replace(path=f"/{test_db_name}"))
    yield test_url

    admin_conn = psycopg2.connect(admin_url)
    admin_conn.autocommit = True
    try:
        with admin_conn.cursor() as cur:
            cur.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s AND pid <> pg_backend_pid()",
                (test_db_name,),
            )
            cur.execute(sql.SQL("DROP DATABASE IF EXISTS {}") .format(sql.Identifier(test_db_name)))
    finally:
        admin_conn.close()


@pytest.fixture(scope="session")
def app_modules(test_database_url: str) -> dict[str, Any]:
    os.environ["DATABASE_URL"] = test_database_url
    os.environ.setdefault("ENV_MODE", "dev")
    os.environ.setdefault("GAME_SERVER_URL", "http://game-server:3000")

    for module_name in APP_MODULE_IMPORT_ORDER:
        sys.modules.pop(module_name, None)

    config = importlib.import_module("app.config")
    database = importlib.import_module("app.database")
    models = importlib.import_module("app.models")
    auth = importlib.import_module("app.auth")
    schema_migrations = importlib.import_module("app.schema_migrations")
    main = importlib.import_module("app.main")

    return {
        "config": config,
        "database": database,
        "models": models,
        "auth": auth,
        "schema_migrations": schema_migrations,
        "main": main,
    }


@pytest.fixture(autouse=True)
def reset_database(app_modules: dict[str, Any]) -> None:
    database = app_modules["database"]
    database.Base.metadata.drop_all(bind=database.engine)
    database.Base.metadata.create_all(bind=database.engine)
    yield


@pytest.fixture
def auth_state() -> dict[str, Any]:
    return {"user_id": None, "username": None}


@pytest.fixture
def client(app_modules: dict[str, Any], auth_state: dict[str, Any]):
    main = app_modules["main"]

    def _override_current_user() -> dict[str, Any]:
        if auth_state["user_id"] is None or auth_state["username"] is None:
            raise AssertionError("auth_state must be configured before making authenticated requests")
        return {
            "user_id": auth_state["user_id"],
            "username": auth_state["username"],
        }

    main.app.dependency_overrides[main.get_current_user] = _override_current_user
    with TestClient(main.app) as test_client:
        yield test_client
    main.app.dependency_overrides.clear()


@pytest.fixture
def db_session(app_modules: dict[str, Any]):
    database = app_modules["database"]
    session = database.SessionLocal()
    try:
        yield session
    finally:
        session.close()

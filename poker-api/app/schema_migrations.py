"""
Database schema migration helpers.
"""
from __future__ import annotations

from pathlib import Path

from .database import Base, engine


def _strip_sql_comments(sql: str) -> str:
    cleaned_lines = []
    for line in sql.splitlines():
        if "--" in line:
            line = line.split("--", 1)[0]
        if line.strip():
            cleaned_lines.append(line)
    return "\n".join(cleaned_lines)


def _execute_sql(cursor, sql: str) -> None:
    cleaned = _strip_sql_comments(sql)
    for statement in cleaned.split(";"):
        if statement.strip():
            cursor.execute(statement)


def _has_table(cursor, table_name: str) -> bool:
    cursor.execute(
        """
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = %s
        )
        """,
        (table_name,),
    )
    return bool(cursor.fetchone()[0])


def _has_column(cursor, table_name: str, column_name: str) -> bool:
    cursor.execute(
        """
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s AND column_name = %s
        )
        """,
        (table_name, column_name),
    )
    return bool(cursor.fetchone()[0])


def _has_foreign_key(cursor, table_name: str, column_name: str, ref_table: str) -> bool:
    cursor.execute(
        """
        SELECT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON c.conrelid = t.oid
            JOIN pg_namespace n ON t.relnamespace = n.oid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
            JOIN pg_class rt ON c.confrelid = rt.oid
            WHERE n.nspname = 'public'
              AND t.relname = %s
              AND a.attname = %s
              AND rt.relname = %s
              AND c.contype = 'f'
        )
        """,
        (table_name, column_name, ref_table),
    )
    return bool(cursor.fetchone()[0])


def _bootstrap_migrations(cursor) -> set[str]:
    applied: set[str] = set()

    if (
        _has_table(cursor, "tables")
        and _has_column(cursor, "tables", "is_permanent")
        and _has_column(cursor, "tables", "created_by_user_id")
        and _has_foreign_key(cursor, "tables", "created_by_user_id", "users")
    ):
        applied.add("001_permanent_tables.sql")

    if (
        _has_table(cursor, "table_queue")
        and _has_column(cursor, "tables", "max_queue_size")
        and _has_column(cursor, "tables", "action_timeout_seconds")
    ):
        applied.add("002_table_queue_and_timeouts.sql")

    if (
        _has_table(cursor, "join_requests")
        and _has_table(cursor, "inbox_messages")
        and _has_table(cursor, "email_verifications")
        and _has_column(cursor, "communities", "commissioner_id")
        and _has_column(cursor, "users", "email_verified")
    ):
        applied.add("003_join_requests_and_inbox.sql")

    if _has_column(cursor, "tables", "agents_allowed"):
        applied.add("004_agents_allowed.sql")

    if _has_column(cursor, "users", "is_admin"):
        applied.add("005_admin_support.sql")

    return applied


def ensure_schema() -> None:
    Base.metadata.create_all(bind=engine)

    migrations_dir = Path(__file__).resolve().parents[1] / "migrations"
    if not migrations_dir.exists():
        return

    connection = None
    cursor = None
    try:
        connection = engine.raw_connection()
        cursor = connection.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        connection.commit()

        cursor.execute("SELECT filename FROM schema_migrations")
        applied = {row[0] for row in cursor.fetchall()}

        if not applied:
            bootstrap = _bootstrap_migrations(cursor)
            for name in sorted(bootstrap):
                cursor.execute(
                    "INSERT INTO schema_migrations (filename) VALUES (%s) ON CONFLICT DO NOTHING",
                    (name,),
                )
            connection.commit()
            applied = set(bootstrap)

        for path in sorted(migrations_dir.glob("*.sql")):
            if path.name in applied:
                continue
            _execute_sql(cursor, path.read_text())
            cursor.execute(
                "INSERT INTO schema_migrations (filename) VALUES (%s) ON CONFLICT DO NOTHING",
                (path.name,),
            )
            connection.commit()
    except Exception:
        if connection:
            connection.rollback()
        raise
    finally:
        if cursor:
            cursor.close()
        if connection:
            connection.close()

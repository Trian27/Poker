#!/usr/bin/env python3
"""
One-time data cleanup utility:
1) Delete non-permanent tables that have zero seated players.
2) Delete leagues except the admin league + first general league.

Fallback behavior when those names are not present:
- Keep up to two oldest leagues to avoid deleting everything accidentally.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sqlalchemy import func

ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT))

from app.database import SessionLocal
from app.models import Community, HandHistory, League, SessionHand, Table, TableSeat
from app.schema_migrations import ensure_schema


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Cleanup empty tables and prune leagues.")
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually apply deletions. Without this flag, the script runs in dry-run mode.",
    )
    return parser.parse_args()


def _pick_leagues_to_keep(session) -> tuple[list[League], str]:
    leagues = session.query(League).order_by(League.created_at.asc(), League.id.asc()).all()
    if not leagues:
        return [], "No leagues found."

    # Keep the first explicit admin league by name.
    admin_candidates = [
        league
        for league in leagues
        if "admin" in (league.name or "").lower()
    ]
    # Keep the first explicit general league by name.
    general_candidates = [
        league
        for league in leagues
        if "general" in (league.name or "").lower()
    ]

    keep_ids: list[int] = []

    if admin_candidates:
        keep_ids.append(admin_candidates[0].id)

    for candidate in general_candidates:
        if candidate.id not in keep_ids:
            keep_ids.append(candidate.id)
            break

    # Safety fallback if expected naming isn't present.
    if not keep_ids and leagues:
        keep_ids.append(leagues[0].id)

    for league in leagues:
        if len(keep_ids) >= 2:
            break
        if league.id not in keep_ids:
            keep_ids.append(league.id)

    keep = [league for league in leagues if league.id in keep_ids]

    reason_bits: list[str] = []
    if admin_candidates:
        reason_bits.append(f"admin league matched id={admin_candidates[0].id}")
    else:
        reason_bits.append("no explicit admin league found")
    if general_candidates:
        reason_bits.append("general league match found")
    else:
        reason_bits.append("no explicit general league found")
    reason_bits.append("fallback keeps oldest leagues to reach 1-2 keep targets")

    return keep, "; ".join(reason_bits)


def main() -> int:
    args = parse_args()
    ensure_schema()
    session = SessionLocal()

    try:
        tables = session.query(Table).order_by(Table.id.asc()).all()
        empty_non_permanent_tables: list[Table] = []
        for table in tables:
            if table.is_permanent:
                continue
            seated_count = session.query(func.count(TableSeat.id)).filter(
                TableSeat.table_id == table.id,
                TableSeat.user_id.isnot(None),
            ).scalar() or 0
            if seated_count == 0:
                empty_non_permanent_tables.append(table)

        keep_leagues, keep_reason = _pick_leagues_to_keep(session)
        keep_ids = {league.id for league in keep_leagues}
        all_leagues = session.query(League).order_by(League.created_at.asc(), League.id.asc()).all()
        delete_leagues = [league for league in all_leagues if league.id not in keep_ids]
        delete_league_ids = {league.id for league in delete_leagues}

        communities_to_delete = (
            session.query(Community)
            .filter(Community.league_id.in_(delete_league_ids))
            .all()
            if delete_league_ids
            else []
        )
        communities_to_delete_ids = {community.id for community in communities_to_delete}
        tables_to_delete_from_league_prune = (
            session.query(Table)
            .filter(Table.community_id.in_(communities_to_delete_ids))
            .all()
            if communities_to_delete_ids
            else []
        )
        table_ids_to_delete_from_league_prune = {table.id for table in tables_to_delete_from_league_prune}
        table_ids_to_delete = {
            *(table.id for table in empty_non_permanent_tables),
            *table_ids_to_delete_from_league_prune,
        }

        mode = "EXECUTE" if args.execute else "DRY-RUN"
        print(f"[{mode}] Empty non-permanent tables to delete: {len(empty_non_permanent_tables)}")
        for table in empty_non_permanent_tables:
            print(f"  - table_id={table.id} name={table.name!r} community_id={table.community_id}")

        print(f"[{mode}] Leagues to keep: {len(keep_leagues)} ({keep_reason})")
        for league in keep_leagues:
            print(f"  - KEEP league_id={league.id} name={league.name!r} owner_id={league.owner_id}")

        print(f"[{mode}] Leagues to delete: {len(delete_leagues)}")
        for league in delete_leagues:
            print(f"  - DELETE league_id={league.id} name={league.name!r} owner_id={league.owner_id}")
        print(f"[{mode}] Communities that would be deleted by league prune: {sorted(communities_to_delete_ids)}")
        print(f"[{mode}] Related table ids that would be deleted by league prune: {sorted(table_ids_to_delete_from_league_prune)}")

        if not args.execute:
            print("[DRY-RUN] No changes applied.")
            return 0

        if table_ids_to_delete:
            # Remove session->hand links before pruning hand-history rows.
            hand_ids = [
                hand_id
                for (hand_id,) in session.query(HandHistory.id).filter(
                    HandHistory.community_id.in_(communities_to_delete_ids)
                ).all()
            ] if communities_to_delete_ids else []
            if hand_ids:
                session.query(SessionHand).filter(SessionHand.hand_id.in_(hand_ids)).delete(synchronize_session=False)
                session.query(HandHistory).filter(HandHistory.id.in_(hand_ids)).delete(synchronize_session=False)

            # Keep historical hands for communities that remain, but detach deleted tables.
            session.query(HandHistory).filter(
                HandHistory.table_id.in_(table_ids_to_delete)
            ).update({HandHistory.table_id: None}, synchronize_session=False)

        for table in empty_non_permanent_tables:
            session.delete(table)

        for league in delete_leagues:
            session.delete(league)

        session.commit()
        print(
            f"[EXECUTE] Deleted {len(empty_non_permanent_tables)} tables and "
            f"{len(delete_leagues)} leagues successfully."
        )
        return 0
    except Exception as exc:  # pragma: no cover - operational script
        session.rollback()
        print(f"Cleanup failed: {exc}", file=sys.stderr)
        return 1
    finally:
        session.close()


if __name__ == "__main__":
    raise SystemExit(main())

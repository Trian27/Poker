#!/usr/bin/env python3
"""
Create or promote an admin user in the Poker Platform database.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT))

from app.auth import get_password_hash
from app.database import SessionLocal
from app.models import User
from app.schema_migrations import ensure_schema


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create or promote an admin user.")
    parser.add_argument("--username", required=True, help="Username for the admin user.")
    parser.add_argument("--email", required=True, help="Email for the admin user.")
    parser.add_argument(
        "--password",
        help="Password for the admin user (required when creating a new user).",
    )
    parser.add_argument(
        "--reset-password",
        action="store_true",
        help="Reset the password if the user already exists.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    ensure_schema()
    session = SessionLocal()

    try:
        user_by_username = session.query(User).filter(User.username == args.username).first()
        user_by_email = session.query(User).filter(User.email == args.email).first()

        if user_by_username and user_by_email and user_by_username.id != user_by_email.id:
            print(
                "Error: username and email belong to different users. "
                "Please provide matching credentials.",
                file=sys.stderr,
            )
            return 1

        user = user_by_username or user_by_email
        if user:
            if args.reset_password:
                if not args.password:
                    print("Error: --reset-password requires --password.", file=sys.stderr)
                    return 1
                user.hashed_password = get_password_hash(args.password)

            user.username = args.username
            user.email = args.email
            user.is_admin = True
            user.is_active = True
            user.email_verified = True
            session.commit()
            print(f"Promoted user '{user.username}' to admin.")
            return 0

        if not args.password:
            print("Error: --password is required to create a new admin user.", file=sys.stderr)
            return 1

        new_user = User(
            username=args.username,
            email=args.email,
            hashed_password=get_password_hash(args.password),
            is_admin=True,
            is_active=True,
            email_verified=True,
        )
        session.add(new_user)
        session.commit()
        print(f"Created admin user '{new_user.username}'.")
        return 0
    finally:
        session.close()


if __name__ == "__main__":
    raise SystemExit(main())

"""
Main FastAPI application with all routes
"""
from fastapi import FastAPI, Depends, HTTPException, status, Body, Query, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import or_, and_, func, text
from sqlalchemy.orm import Session
from decimal import Decimal
import math
from collections import Counter
from dataclasses import dataclass
import re
import secrets
import string

from .config import settings
from .database import get_db, SessionLocal
from .models import (
    User, League, Community, Wallet, Table, TableStatus, GameType, HandHistory, TableSeat, TableQueue,
    LeagueAdmin, CommunityAdmin, LeagueMember, LeagueJoinRequest, JoinRequest, InboxMessage,
    Skin, UserSkin, SkinSubmission, SkinSubmissionWorkflowState, DirectMessage, CoinPurchaseIntent,
    CreatorPayoutRequest, CreatorPayoutStatus,
    TableSession, SessionHand, EmailVerification, TournamentRegistration, TournamentRegistrationStatus,
    Tournament, TournamentPayout, FeedbackReport, PlayerNote
    , TestFixtureRun
)
from .schema_migrations import ensure_schema
from .schemas import (
    UserCreate, UserResponse, Token,
    AdminInviteRequest, AdminUserResponse, BanStatusRequest, CurrencyUpdateRequest,
    LeagueCreate, LeagueResponse,
    CommunityBase, CommunityCreate, CommunityResponse,
    WalletCreate, WalletResponse, CommunityWalletSummaryResponse, CommunityWalletAdjustRequest, CommunityWalletAdjustResponse,
    TableCreate, TableResponse, TableJoinRequest, SeatPlayerRequest, TableSeatResponse,
    WalletOperation, WalletOperationResponse,
    TokenVerifyRequest, TokenVerifyResponse,
    HandHistoryCreate, HandHistoryResponse, HandHistorySummary,
    LearningSessionSummary, LearningCoachRequest, LearningCoachResponse, LearningActionRecommendation,
    TableQueuePosition, QueueJoinRequest, TableTournamentDetailsResponse, TournamentRegistrationResponse, TournamentPayoutUpdateRequest,
    SkinCreate, SkinResponse, UserSkinResponse, EquipSkinRequest,
    SkinSubmissionCreate, SkinSubmissionResponse, SkinSubmissionReview, SkinSubmissionCreatorDecision,
    GoldBalanceResponse, MarketplacePurchaseResponse,
    CoinPurchaseIntentCreate, CoinPurchaseIntentResponse,
    CreatorEarningsResponse, CreatorPayoutProfileUpdateRequest, CreatorPayoutRequestCreate,
    CreatorPayoutRequestResponse, CreatorPayoutProcessRequest,
    PlayerNoteUpsertRequest, PlayerNoteResponse,
    DirectMessageCreate, DirectMessageResponse, ConversationSummaryResponse,
    TournamentCreate, TournamentResponse, TournamentAwardRequest,
    FeedbackCreate, FeedbackResponse, FeedbackComplaintBucket,
    ProfileUpdateRequest, ProfileUpdateInitResponse, ProfileUpdateVerifyRequest, ProfileUpdateResponse,
    AccountRecoveryRequest, AccountRecoveryVerifyRequest, AccountRecoveryVerifyResponse,
    TestFixtureGameplayStackCreate, TestFixtureGameplayStackResponse, TestFixtureCleanupResponse
)
from .auth import (
    get_password_hash, verify_password,
    create_access_token, decode_token
)
import httpx
import logging
from datetime import datetime, timedelta
from pathlib import Path
import json
import random
import uuid
from urllib.parse import urlparse

logger = logging.getLogger(__name__)
UI_CLIENT_HEADER_NAME = "X-Dormstacks-UI"
UI_CLIENT_HEADER_VALUE = "web"
UI_ALLOWED_ORIGINS = {origin.rstrip("/").lower() for origin in settings.CORS_ORIGINS}
LOCAL_UI_ORIGIN_PATTERN = re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$")

# Security scheme for JWT Bearer tokens (optional so query params can be used)
security = HTTPBearer(auto_error=False)

# Initialize FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    description="API for poker platform authentication and wallet management"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=None if settings.is_production else LOCAL_UI_ORIGIN_PATTERN.pattern,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# Startup Tasks
# ============================================================================

def _bootstrap_admin_user() -> None:
    if not (settings.ADMIN_USERNAME and settings.ADMIN_EMAIL and settings.ADMIN_PASSWORD):
        return

    db = SessionLocal()
    try:
        user = db.query(User).filter(
            or_(User.username == settings.ADMIN_USERNAME, User.email == settings.ADMIN_EMAIL)
        ).first()

        if user:
            updated = False
            if not user.is_admin:
                user.is_admin = True
                updated = True
            if not user.is_active:
                user.is_active = True
                updated = True
            if not user.email_verified:
                user.email_verified = True
                updated = True
            if settings.ADMIN_RESET_PASSWORD:
                user.hashed_password = get_password_hash(settings.ADMIN_PASSWORD)
                updated = True

            if updated:
                db.commit()
                logger.info("Admin user updated: %s", user.username)
            return

        new_user = User(
            username=settings.ADMIN_USERNAME,
            email=settings.ADMIN_EMAIL,
            hashed_password=get_password_hash(settings.ADMIN_PASSWORD),
            is_admin=True,
            is_active=True,
            email_verified=True,
        )
        db.add(new_user)
        db.commit()
        logger.info("Admin user created: %s", new_user.username)
    except Exception:
        db.rollback()
        logger.exception("Failed to bootstrap admin user")
    finally:
        db.close()


@app.on_event("startup")
def on_startup() -> None:
    ensure_schema()
    _bootstrap_admin_user()
    if settings.ENABLE_TEST_FIXTURE_API and not settings.is_production:
        logger.warning("Test fixture API is enabled outside production")


# ============================================================================
# Health Check
# ============================================================================

@app.get("/")
def read_root():
    """Health check endpoint"""
    return {
        "app": settings.APP_NAME,
        "version": settings.VERSION,
        "status": "running"
    }


@app.get("/health")
def health_check():
    """Detailed health check"""
    return {
        "status": "healthy",
        "database": "connected"
    }


# ============================================================================
# Helper Functions
# ============================================================================

TEST_RUN_TAG_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
TEST_FIXTURE_RUN_STATUS_CREATING = "creating"
TEST_FIXTURE_RUN_STATUS_ACTIVE = "active"
TEST_FIXTURE_RUN_STATUS_CLEANUP_STARTED = "cleanup_started"
TEST_FIXTURE_RUN_STATUS_CLEANED = "cleaned"
TEST_FIXTURE_RUN_STATUS_CREATE_FAILED = "create_failed"
TEST_FIXTURE_RUN_STATUS_CLEANUP_FAILED = "cleanup_failed"
TEST_ONLY_NOT_FOUND_DETAIL = "Resource not found"
TABLE_NOT_FOUND_SOCKET_REASON = "table_not_found"


@dataclass(frozen=True)
class PartitionContext:
    kind: str
    run_tag: str | None = None

def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    token: str | None = None
) -> dict:
    """
    Dependency to get current user from JWT token in Authorization header
    or from a `token` query parameter. Raises HTTPException if token is missing
    or invalid.
    """
    access_token = None
    if credentials:
        access_token = credentials.credentials
    elif token:
        access_token = token

    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token required"
        )

    payload = decode_token(access_token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token"
        )
    return payload


async def post_game_server_json(path: str, payload: dict, timeout: float = 10.0) -> httpx.Response:
    base_url = settings.GAME_SERVER_URL.rstrip("/")
    async with httpx.AsyncClient() as client:
        return await client.post(
            f"{base_url}{path}",
            json=payload,
            timeout=timeout,
        )


async def get_game_server_json(path: str, timeout: float = 10.0) -> httpx.Response:
    base_url = settings.GAME_SERVER_URL.rstrip("/")
    async with httpx.AsyncClient() as client:
        return await client.get(
            f"{base_url}{path}",
            timeout=timeout,
        )


async def rollback_game_server_promotion(promotion_id: str, timeout: float = 3.0) -> httpx.Response:
    return await post_game_server_json(
        f"/_internal/promotions/{promotion_id}/rollback",
        {},
        timeout=timeout,
    )


def _issue_access_token_for_user(user: User) -> str:
    return create_access_token(
        data={
            "user_id": user.id,
            "username": user.username,
            "is_test_user": bool(user.is_test_user),
            "test_run_tag": user.test_run_tag,
        }
    )


def _serialize_public_user(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "is_admin": user.is_admin,
        "is_banned": user.is_banned,
        "is_test_user": bool(user.is_test_user),
    }


def _lock_table_for_update(db: Session, table_id: int) -> Table | None:
    return (
        db.query(Table)
        .filter(Table.id == table_id)
        .with_for_update()
        .first()
    )


def _lock_wallet_for_update(db: Session, user_id: int, community_id: int) -> Wallet | None:
    return (
        db.query(Wallet)
        .filter(
            Wallet.user_id == user_id,
            Wallet.community_id == community_id,
        )
        .with_for_update()
        .first()
    )


def _compact_table_queue_positions(db: Session, table_id: int) -> None:
    db.flush()
    entries = (
        db.query(TableQueue)
        .filter(TableQueue.table_id == table_id)
        .order_by(TableQueue.position.asc(), TableQueue.joined_at.asc(), TableQueue.id.asc())
        .all()
    )
    for next_position, entry in enumerate(entries, start=1):
        entry.position = next_position


def _occupied_seat_count(db: Session, table_id: int) -> int:
    return int(
        db.query(func.count(TableSeat.id))
        .filter(
            TableSeat.table_id == table_id,
            TableSeat.user_id.isnot(None),
        )
        .scalar()
        or 0
    )


def _is_league_admin(db: Session, league_id: int, user_id: int) -> bool:
    return db.query(LeagueAdmin.id).filter(
        LeagueAdmin.league_id == league_id,
        LeagueAdmin.user_id == user_id
    ).first() is not None


def _is_community_admin(db: Session, community_id: int, user_id: int) -> bool:
    return db.query(CommunityAdmin.id).filter(
        CommunityAdmin.community_id == community_id,
        CommunityAdmin.user_id == user_id
    ).first() is not None


def _is_league_member(db: Session, league_id: int, user_id: int) -> bool:
    owner_match = db.query(League.id).filter(
        League.id == league_id,
        League.owner_id == user_id
    ).first()
    if owner_match:
        return True

    if _is_league_admin(db, league_id, user_id):
        return True

    community_admin_match = db.query(CommunityAdmin.id).join(Community).filter(
        CommunityAdmin.user_id == user_id,
        Community.league_id == league_id
    ).first()
    if community_admin_match:
        return True

    member_match = db.query(LeagueMember.id).filter(
        LeagueMember.league_id == league_id,
        LeagueMember.user_id == user_id
    ).first()
    return member_match is not None


def _is_global_admin(db: Session, user_id: int) -> bool:
    user = db.query(User).filter(User.id == user_id).first()
    return bool(user and user.is_admin)


def _get_user_or_404(db: Session, user_id: int) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


def _normal_partition() -> PartitionContext:
    return PartitionContext(kind="normal", run_tag=None)


def _is_test_partition(context: PartitionContext) -> bool:
    return context.kind == "test_only"


def _build_partition_context_for_user(user: User) -> PartitionContext:
    if user.is_test_user:
        return PartitionContext(kind="test_only", run_tag=user.test_run_tag)
    return _normal_partition()


def _get_partition_context_for_user_id(db: Session, user_id: int) -> PartitionContext:
    return _build_partition_context_for_user(_get_user_or_404(db, user_id))


def _require_non_test_partition(partition: PartitionContext) -> None:
    if _is_test_partition(partition):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Test users cannot use this route"
        )


def _validate_run_tag(run_tag: str) -> str:
    normalized = (run_tag or "").strip()
    if not TEST_RUN_TAG_RE.fullmatch(normalized):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid run_tag"
        )
    return normalized


def _ensure_partition_access(
    partition: PartitionContext,
    *,
    is_test_only: bool,
    test_run_tag: str | None,
) -> None:
    if partition.kind == "normal":
        if is_test_only:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=TEST_ONLY_NOT_FOUND_DETAIL)
        return

    if not is_test_only or test_run_tag != partition.run_tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=TEST_ONLY_NOT_FOUND_DETAIL)


def _apply_partition_filter(query, model, partition: PartitionContext):
    if partition.kind == "normal":
        return query.filter(model.is_test_only.is_(False))
    return query.filter(
        model.is_test_only.is_(True),
        model.test_run_tag == partition.run_tag,
    )


def _apply_user_partition_filter(query, partition: PartitionContext):
    if partition.kind == "normal":
        return query.filter(User.is_test_user.is_(False))
    return query.filter(
        User.is_test_user.is_(True),
        User.test_run_tag == partition.run_tag,
    )


def _assert_same_test_partition(
    *,
    child_is_test_only: bool,
    child_run_tag: str | None,
    parent_is_test_only: bool,
    parent_run_tag: str | None,
    detail: str = "Cross-partition attachment is not allowed",
) -> None:
    if child_is_test_only != parent_is_test_only:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)
    if child_is_test_only and child_run_tag != parent_run_tag:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _assert_user_matches_resource_partition(user: User, resource, detail: str) -> None:
    _assert_same_test_partition(
        child_is_test_only=user.is_test_user,
        child_run_tag=user.test_run_tag,
        parent_is_test_only=resource.is_test_only,
        parent_run_tag=resource.test_run_tag,
        detail=detail,
    )


def _get_visible_league_or_404(db: Session, league_id: int, partition: PartitionContext) -> League:
    league = db.query(League).filter(League.id == league_id).first()
    if not league:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="League not found")
    _ensure_partition_access(partition, is_test_only=league.is_test_only, test_run_tag=league.test_run_tag)
    return league


def _get_visible_community_or_404(db: Session, community_id: int, partition: PartitionContext) -> Community:
    community = db.query(Community).filter(Community.id == community_id).first()
    if not community:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Community not found")
    _ensure_partition_access(partition, is_test_only=community.is_test_only, test_run_tag=community.test_run_tag)
    return community


def _get_visible_table_or_404(db: Session, table_id: int, partition: PartitionContext) -> Table:
    table = db.query(Table).filter(Table.id == table_id).first()
    if not table:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Table not found")
    _ensure_partition_access(partition, is_test_only=table.is_test_only, test_run_tag=table.test_run_tag)
    return table


def _require_fixture_api_enabled() -> None:
    if settings.is_production or not settings.ENABLE_TEST_FIXTURE_API:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Test fixture API is not enabled"
        )


def _require_fixture_admin(db: Session, current_user: dict) -> User:
    _require_fixture_api_enabled()
    return _require_global_admin(db, current_user)


def _acquire_run_tag_lock(db: Session, run_tag: str) -> None:
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:run_tag))"), {"run_tag": run_tag})


def _fixture_cleanup_counts() -> dict[str, int]:
    return {
        "session_hands": 0,
        "table_sessions": 0,
        "hand_history": 0,
        "table_queue": 0,
        "table_seats": 0,
        "wallets": 0,
        "league_members": 0,
        "league_admins": 0,
        "community_admins": 0,
        "league_join_requests": 0,
        "join_requests": 0,
        "tournament_registrations": 0,
        "email_verifications": 0,
        "tables": 0,
        "communities": 0,
        "leagues": 0,
        "users": 0,
    }


def _generate_test_password() -> str:
    alphabet = string.ascii_letters + string.digits
    return "T-" + "".join(secrets.choice(alphabet) for _ in range(20))


def _validate_fixture_stack_request(payload: TestFixtureGameplayStackCreate) -> str:
    run_tag = _validate_run_tag(payload.run_tag)
    if payload.auto_seat_players and payload.player_count > payload.max_seats:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="player_count cannot exceed max_seats")
    if payload.queued_player_count > payload.max_queue_size:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="queued_player_count cannot exceed max_queue_size")
    if not payload.auto_seat_players and payload.queued_player_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="queued_player_count requires auto_seat_players=true"
        )
    if payload.auto_seat_players and payload.queued_player_count > 0 and payload.player_count < payload.max_seats:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="queued_player_count is only supported when player_count fills the table"
        )
    if payload.buy_in <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cash game buy-in must be greater than zero")
    if payload.big_blind < payload.small_blind:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Big blind must be greater than or equal to small blind"
        )
    if payload.starting_balance < payload.buy_in:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="starting_balance must be greater than or equal to buy_in"
        )
    return run_tag


def _username_fragment_for_run(run_tag: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "_", run_tag).strip("_").lower()
    return cleaned[:24] or "run"


def _test_entity_name(prefix: str, run_tag: str, max_length: int) -> str:
    value = f"{prefix} {run_tag}"
    return value[:max_length]


def _truncate_error_message(message: str | None) -> str | None:
    if not message:
        return None
    return str(message)[:4000]


def _update_fixture_run_status(
    db: Session,
    run_tag: str,
    *,
    status_value: str,
    league_id: int | None = None,
    community_id: int | None = None,
    table_id: int | None = None,
    game_id: str | None = None,
    last_create_error: str | None = None,
    last_cleanup_error: str | None = None,
) -> TestFixtureRun:
    _acquire_run_tag_lock(db, run_tag)
    fixture_run = db.query(TestFixtureRun).filter(TestFixtureRun.run_tag == run_tag).first()
    if not fixture_run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fixture run not found")
    fixture_run.status = status_value
    if league_id is not None:
        fixture_run.league_id = league_id
    if community_id is not None:
        fixture_run.community_id = community_id
    if table_id is not None:
        fixture_run.table_id = table_id
    if game_id is not None:
        fixture_run.game_id = game_id
    if last_create_error is not None:
        fixture_run.last_create_error = _truncate_error_message(last_create_error)
    if last_cleanup_error is not None:
        fixture_run.last_cleanup_error = _truncate_error_message(last_cleanup_error)
    db.commit()
    db.refresh(fixture_run)
    return fixture_run


async def _seat_fixture_user(
    *,
    db: Session,
    table: Table,
    seat: TableSeat,
    user: User,
    wallet: Wallet,
    buy_in_amount: int,
) -> None:
    wallet.balance -= buy_in_amount
    seat.user_id = user.id
    seat.occupied_at = func.now()
    session = TableSession(
        user_id=user.id,
        table_id=table.id,
        community_id=table.community_id,
        table_name=table.name,
        buy_in_amount=buy_in_amount,
        is_test_only=table.is_test_only,
        test_run_tag=table.test_run_tag,
    )
    db.add(session)
    db.commit()
    db.refresh(wallet)

    seat_request = SeatPlayerRequest(
        table_id=table.id,
        user_id=user.id,
        username=user.username,
        stack=buy_in_amount,
        seat_number=seat.seat_number,
        community_id=table.community_id,
        table_name=table.name,
        is_test_only=table.is_test_only,
        test_run_tag=table.test_run_tag,
    )

    try:
        response = await post_game_server_json(
            "/_internal/seat-player",
            seat_request.model_dump(),
            timeout=10.0,
        )
    except httpx.RequestError as exc:
        response = None
        error_message = f"Game server unavailable: {exc}"
    else:
        error_message = response.text if response.status_code != 200 else None

    if error_message:
        wallet.balance += buy_in_amount
        seat.user_id = None
        seat.occupied_at = None
        db.query(TableSession).filter(
            TableSession.user_id == user.id,
            TableSession.table_id == table.id,
            TableSession.left_at.is_(None),
        ).update({"left_at": func.now()})
        db.commit()
        raise RuntimeError(f"Failed to seat fixture user {user.username}: {error_message}")


async def _purge_fixture_runtime(fixture_run: TestFixtureRun) -> None:
    if not fixture_run.game_id or not fixture_run.table_id:
        return
    try:
        response = await post_game_server_json(
            f"/_internal/game/{fixture_run.game_id}/purge",
            {
                "expected_table_id": fixture_run.table_id,
                "expected_test_run_tag": fixture_run.run_tag,
            },
            timeout=10.0,
        )
    except httpx.RequestError as exc:
        raise RuntimeError(f"Game server purge unreachable: {exc}") from exc

    if response.status_code != 200:
        raise RuntimeError(response.text or "Game server purge rejected")


def _delete_query(query) -> int:
    return int(query.delete(synchronize_session=False) or 0)


def _cleanup_fixture_run_rows(db: Session, run_tag: str) -> dict[str, int]:
    counts = _fixture_cleanup_counts()

    users = db.query(User).filter(
        User.is_test_user.is_(True),
        User.test_run_tag == run_tag,
    ).all()
    user_ids = [user.id for user in users]
    user_emails = [user.email for user in users]

    leagues = db.query(League).filter(
        League.is_test_only.is_(True),
        League.test_run_tag == run_tag,
    ).all()
    league_ids = [league.id for league in leagues]

    communities = db.query(Community).filter(
        Community.is_test_only.is_(True),
        Community.test_run_tag == run_tag,
    ).all()
    community_ids = [community.id for community in communities]

    tables = db.query(Table).filter(
        Table.is_test_only.is_(True),
        Table.test_run_tag == run_tag,
    ).all()
    table_ids = [table.id for table in tables]

    sessions = db.query(TableSession).filter(
        TableSession.is_test_only.is_(True),
        TableSession.test_run_tag == run_tag,
    ).all()
    session_ids = [session.id for session in sessions]

    hands = db.query(HandHistory).filter(
        HandHistory.is_test_only.is_(True),
        HandHistory.test_run_tag == run_tag,
    ).all()
    hand_ids = [hand.id for hand in hands]

    if session_ids:
        counts["session_hands"] = _delete_query(
            db.query(SessionHand).filter(SessionHand.session_id.in_(session_ids))
        )

    counts["table_sessions"] = _delete_query(
        db.query(TableSession).filter(
            TableSession.is_test_only.is_(True),
            TableSession.test_run_tag == run_tag,
        )
    )
    counts["hand_history"] = _delete_query(
        db.query(HandHistory).filter(
            HandHistory.is_test_only.is_(True),
            HandHistory.test_run_tag == run_tag,
        )
    )

    if table_ids:
        counts["table_queue"] = _delete_query(
            db.query(TableQueue).filter(TableQueue.table_id.in_(table_ids))
        )
        counts["table_seats"] = _delete_query(
            db.query(TableSeat).filter(TableSeat.table_id.in_(table_ids))
        )
        counts["tournament_registrations"] = _delete_query(
            db.query(TournamentRegistration).filter(TournamentRegistration.table_id.in_(table_ids))
        )

    if user_ids and community_ids:
        counts["wallets"] = _delete_query(
            db.query(Wallet).filter(
                Wallet.user_id.in_(user_ids),
                Wallet.community_id.in_(community_ids),
            )
        )

    if league_ids:
        counts["league_admins"] = _delete_query(
            db.query(LeagueAdmin).filter(LeagueAdmin.league_id.in_(league_ids))
        )
        counts["league_join_requests"] = _delete_query(
            db.query(LeagueJoinRequest).filter(LeagueJoinRequest.league_id.in_(league_ids))
        )

    if community_ids:
        counts["community_admins"] = _delete_query(
            db.query(CommunityAdmin).filter(CommunityAdmin.community_id.in_(community_ids))
        )
        counts["join_requests"] = _delete_query(
            db.query(JoinRequest).filter(JoinRequest.community_id.in_(community_ids))
        )

    if user_ids:
        counts["league_members"] = _delete_query(
            db.query(LeagueMember).filter(LeagueMember.user_id.in_(user_ids))
        )
        counts["email_verifications"] = _delete_query(
            db.query(EmailVerification).filter(
                or_(
                    EmailVerification.user_id.in_(user_ids),
                    EmailVerification.email.in_(user_emails),
                )
            )
        )

    counts["tables"] = _delete_query(
        db.query(Table).filter(
            Table.is_test_only.is_(True),
            Table.test_run_tag == run_tag,
        )
    )
    counts["communities"] = _delete_query(
        db.query(Community).filter(
            Community.is_test_only.is_(True),
            Community.test_run_tag == run_tag,
        )
    )
    counts["leagues"] = _delete_query(
        db.query(League).filter(
            League.is_test_only.is_(True),
            League.test_run_tag == run_tag,
        )
    )
    counts["users"] = _delete_query(
        db.query(User).filter(
            User.is_test_user.is_(True),
            User.test_run_tag == run_tag,
        )
    )
    db.commit()
    return counts


def _require_global_admin(db: Session, current_user: dict) -> User:
    user_id = current_user.get("user_id")
    user = _get_user_or_404(db, user_id)
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


def _ensure_not_banned(user: User) -> None:
    if user.is_banned:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been banned"
        )


def _extract_origin_from_referer(referer: str | None) -> str | None:
    if not referer:
        return None
    parsed = urlparse(referer.strip())
    if not parsed.scheme or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}".lower()


def _is_allowed_ui_origin(origin: str | None) -> bool:
    if not origin:
        return False
    normalized_origin = origin.rstrip("/").lower()
    if normalized_origin in UI_ALLOWED_ORIGINS:
        return True
    if settings.is_production:
        return False
    return LOCAL_UI_ORIGIN_PATTERN.fullmatch(normalized_origin) is not None


def _require_ui_create_request(
    request: Request,
    ui_client: str | None = Header(default=None, alias=UI_CLIENT_HEADER_NAME),
) -> None:
    """
    Gate create endpoints to requests that originate from the official web UI.
    """
    if ui_client != UI_CLIENT_HEADER_VALUE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Creation via direct API clients is disabled. Use the web UI."
        )

    request_origin = request.headers.get("origin")
    normalized_origin = request_origin.strip().rstrip("/").lower() if request_origin else None
    if not normalized_origin:
        normalized_origin = _extract_origin_from_referer(request.headers.get("referer"))

    if not _is_allowed_ui_origin(normalized_origin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Creation requests must come from an approved UI origin."
        )

    # Browsers include these automatically for fetch/XHR. If present and clearly cross-site, reject.
    sec_fetch_site = (request.headers.get("sec-fetch-site") or "").lower()
    if sec_fetch_site and sec_fetch_site not in {"same-origin", "same-site", "none"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Creation requests must come from the web UI."
        )


def _detach_hand_history_from_table(db: Session, table_id: int) -> int:
    """
    Preserve historical hands when a table is deleted by nulling table_id links.
    """
    detached_rows = (
        db.query(HandHistory)
        .filter(HandHistory.table_id == table_id)
        .update({HandHistory.table_id: None}, synchronize_session=False)
    )
    return int(detached_rows or 0)


def _prepare_table_deletion_cleanup(db: Session, table_ids: list[int]) -> tuple[int, int]:
    """
    Preserve analysis/session records before deleting one or many tables.

    Returns:
        (detached_hand_history_count, detached_table_session_count)
    """
    normalized_ids = sorted({int(table_id) for table_id in table_ids if int(table_id) > 0})
    if not normalized_ids:
        return (0, 0)

    detached_history_count = (
        db.query(HandHistory)
        .filter(HandHistory.table_id.in_(normalized_ids))
        .update({HandHistory.table_id: None}, synchronize_session=False)
    ) or 0

    detached_session_count = (
        db.query(TableSession)
        .filter(TableSession.table_id.in_(normalized_ids))
        .update({TableSession.table_id: None}, synchronize_session=False)
    ) or 0

    return (int(detached_history_count), int(detached_session_count))


def _normalize_skin_category(category: object) -> str | None:
    if category is None:
        return None
    if hasattr(category, "value"):
        category = category.value
    if isinstance(category, str):
        normalized = category.strip().lower()
        return normalized or None
    return None


def _is_safe_skin_asset_reference(value: str) -> bool:
    normalized = value.strip().lower()
    return (
        normalized.startswith("https://")
        or normalized.startswith("http://")
        or normalized.startswith("data:image/")
        or normalized.startswith("/")
    )


COIN_PACKAGES: dict[str, dict[str, int]] = {
    "coins_100": {"gold_coins": 100, "usd_cents": 100},
    "coins_550": {"gold_coins": 550, "usd_cents": 500},
    "coins_1200": {"gold_coins": 1200, "usd_cents": 1000},
    "coins_6200": {"gold_coins": 6200, "usd_cents": 5000},
    "coins_12800": {"gold_coins": 12800, "usd_cents": 10000},
}
CREATOR_ROYALTY_PERCENT = 5
CREATOR_PAYOUT_MIN_CENTS = 1000


def _validate_skin_design_spec(
    design_spec: dict,
    category: object | None = None,
    require_runtime_assets: bool = False,
) -> None:
    if not isinstance(design_spec, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="design_spec must be an object")

    format_version = design_spec.get("format_version")
    renderer = design_spec.get("renderer")
    asset_manifest = design_spec.get("asset_manifest")
    theme_tokens = design_spec.get("theme_tokens")

    if not isinstance(format_version, int) or format_version < 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="design_spec.format_version must be an integer >= 1")
    if not isinstance(renderer, str) or not renderer.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="design_spec.renderer must be a non-empty string")
    if not isinstance(asset_manifest, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="design_spec.asset_manifest must be an object")
    for key, value in asset_manifest.items():
        if not isinstance(key, str) or not isinstance(value, str):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="design_spec.asset_manifest entries must be string->string")
        if not _is_safe_skin_asset_reference(value):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"design_spec.asset_manifest entry '{key}' has an unsupported asset URL/path",
            )
    if theme_tokens is not None and not isinstance(theme_tokens, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="design_spec.theme_tokens must be an object")

    normalized_category = _normalize_skin_category(category)
    if not require_runtime_assets or not normalized_category:
        return

    if normalized_category == "cards":
        missing = [key for key in ("card_front", "card_back") if not str(asset_manifest.get(key, "")).strip()]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Card skins must include asset_manifest keys: {', '.join(missing)}",
            )
    elif normalized_category == "table":
        has_felt = bool(str(asset_manifest.get("table_felt", "")).strip())
        has_background = bool(str(asset_manifest.get("table_background", "")).strip())
        if not has_felt and not has_background:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Table skins must include table_felt or table_background in asset_manifest",
            )


def _skin_to_response(skin: Skin) -> SkinResponse:
    return SkinResponse(
        id=skin.id,
        slug=skin.slug,
        name=skin.name,
        description=skin.description,
        category=skin.category.value if hasattr(skin.category, "value") else skin.category,
        price_gold_coins=skin.price_gold_coins,
        design_spec=skin.design_spec,
        preview_url=skin.preview_url,
        is_active=skin.is_active,
        created_by_user_id=skin.created_by_user_id,
        created_at=skin.created_at,
    )


def _user_skin_to_response(user_skin: UserSkin) -> UserSkinResponse:
    return UserSkinResponse(
        skin_id=user_skin.skin_id,
        is_equipped=user_skin.is_equipped,
        acquired_at=user_skin.acquired_at,
        skin=_skin_to_response(user_skin.skin),
    )


def _skin_submission_to_response(submission: SkinSubmission, username: str) -> SkinSubmissionResponse:
    workflow_state_value = (
        submission.workflow_state.value
        if hasattr(submission.workflow_state, "value")
        else submission.workflow_state
    ) or SkinSubmissionWorkflowState.PENDING_ADMIN_REVIEW.value
    return SkinSubmissionResponse(
        id=submission.id,
        user_id=submission.user_id,
        username=username,
        name=submission.name,
        category=submission.category.value if hasattr(submission.category, "value") else submission.category,
        design_spec=submission.design_spec,
        desired_price_gold_coins=int(submission.desired_price_gold_coins or 0),
        reference_image_url=submission.reference_image_url,
        submitter_notes=submission.submitter_notes,
        status=submission.status.value if hasattr(submission.status, "value") else submission.status,
        workflow_state=workflow_state_value,
        review_notes=submission.review_notes,
        admin_proposed_design_spec=submission.admin_proposed_design_spec,
        admin_rendered_image_url=submission.admin_rendered_image_url,
        admin_proposed_price_gold_coins=submission.admin_proposed_price_gold_coins,
        admin_comment=submission.admin_comment,
        creator_decision=submission.creator_decision,
        creator_comment=submission.creator_comment,
        creator_responded_at=submission.creator_responded_at,
        finalized_skin_id=submission.finalized_skin_id,
        reviewed_by_user_id=submission.reviewed_by_user_id,
        reviewed_at=submission.reviewed_at,
        created_at=submission.created_at,
    )


def _default_skin_design_spec_from_reference(reference_image_url: str | None, category: object | None = None) -> dict:
    """Create a baseline design_spec scaffold when submitters provide only an image concept."""
    asset_manifest: dict[str, str] = {}
    normalized_category = _normalize_skin_category(category)
    if reference_image_url:
        if normalized_category == "cards":
            asset_manifest["card_front"] = reference_image_url
            asset_manifest["card_back"] = reference_image_url
        elif normalized_category == "table":
            asset_manifest["table_felt"] = reference_image_url
            asset_manifest["table_background"] = reference_image_url
        else:
            asset_manifest["concept_image"] = reference_image_url
    return {
        "format_version": 1,
        "renderer": "web",
        "asset_manifest": asset_manifest,
        "theme_tokens": {},
        "notes": "Auto-generated scaffold from image-first submission flow.",
    }


def _skin_submission_action(payload: SkinSubmissionReview) -> str:
    if payload.action:
        return payload.action
    if payload.approved is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provide either action or approved")
    return "accept" if payload.approved else "decline"


def _notify_global_admins_of_skin_submission(db: Session, submission: SkinSubmission, submitter: User) -> None:
    global_admins = db.query(User).filter(User.is_admin == True, User.is_active == True).all()
    if not global_admins:
        return

    for admin in global_admins:
        if admin.id == submitter.id:
            continue
        message = InboxMessage(
            recipient_user_id=admin.id,
            sender_user_id=submitter.id,
            message_type="skin_submission_review_request",
            title=f"Skin Submission Review Needed: {submission.name}",
            content=(
                f"{submitter.username} submitted a skin concept.\n"
                f"Requested price: {submission.desired_price_gold_coins} gold coins."
            ),
            message_metadata={
                "submission_id": submission.id,
                "submission_name": submission.name,
                "category": submission.category.value if hasattr(submission.category, "value") else submission.category,
                "reference_image_url": submission.reference_image_url,
                "requested_price_gold_coins": submission.desired_price_gold_coins,
            },
            is_actionable=False,
        )
        db.add(message)


def _creator_payout_to_response(request: CreatorPayoutRequest) -> CreatorPayoutRequestResponse:
    status_value = request.status.value if hasattr(request.status, "value") else request.status
    return CreatorPayoutRequestResponse(
        id=request.id,
        amount_cents=int(request.amount_cents or 0),
        payout_email=request.payout_email,
        status=status_value,
        processor_note=request.processor_note,
        payout_reference=request.payout_reference,
        processed_by_user_id=request.processed_by_user_id,
        requested_at=request.requested_at,
        processed_at=request.processed_at,
    )


def _classify_feedback_complaint(title: str, description: str) -> str:
    combined = f"{title} {description}".lower()
    keyword_groups = {
        "login_auth": ["login", "sign in", "auth", "password", "verification"],
        "gameplay_logic": ["turn", "fold", "call", "bet", "seat", "hand", "pot", "table"],
        "performance": ["slow", "lag", "freeze", "stuck", "crash", "glitch"],
        "ui_ux": ["button", "layout", "screen", "scroll", "visual", "mobile", "css"],
        "payments_marketplace": ["gold", "coin", "purchase", "marketplace", "stripe", "payment"],
        "chat_social": ["chat", "message", "inbox", "emote", "emoji"],
    }
    for complaint, keywords in keyword_groups.items():
        if any(keyword in combined for keyword in keywords):
            return complaint
    return "other"


def _write_feedback_to_disk(payload: dict) -> None:
    target_dir = Path(settings.FEEDBACK_EXPORT_DIR)
    target_dir.mkdir(parents=True, exist_ok=True)
    output_path = target_dir / "feedback.ndjson"
    with output_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=True) + "\n")


def _send_feedback_notification_email(subject: str, body: str) -> None:
    if not settings.ADMIN_EMAIL:
        return
    if not settings.SMTP_USER or not settings.SMTP_PASSWORD:
        logger.info("SMTP not configured; feedback email notification skipped")
        return

    import smtplib
    from email.mime.text import MIMEText

    message = MIMEText(body, "plain")
    message["From"] = settings.EMAIL_FROM
    message["To"] = settings.ADMIN_EMAIL
    message["Subject"] = subject

    try:
        smtp = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT)
        smtp.starttls()
        smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        smtp.sendmail(settings.EMAIL_FROM, settings.ADMIN_EMAIL, message.as_string())
        smtp.quit()
    except Exception as exc:
        logger.error("Failed to send feedback email notification: %s", exc)


EMAIL_VERIFICATION_PURPOSE_REGISTRATION = "registration"
EMAIL_VERIFICATION_PURPOSE_ADMIN_LOGIN = "admin_login"
EMAIL_VERIFICATION_PURPOSE_PROFILE_UPDATE = "profile_update"
EMAIL_VERIFICATION_PURPOSE_ACCOUNT_RECOVERY = "account_recovery"
TOURNAMENT_ALLOWED_PLAYER_LIMITS = {2, 4, 8}
TOURNAMENT_DEFAULT_PAYOUT_PERCENTAGES = [60, 30, 10]
TOURNAMENT_DEFAULT_CONFIRMATION_WINDOW_SECONDS = 60
TOURNAMENT_DEFAULT_BLIND_INTERVAL_MINUTES = 10
TOURNAMENT_DEFAULT_BLIND_PROGRESSION_PERCENT = 50
TOURNAMENT_RESCHEDULE_DELAY_MINUTES = 5


def _generate_verification_code() -> str:
    return f"{random.randint(0, 999999):06d}"


def _create_email_verification(
    db: Session,
    *,
    email: str,
    username: str,
    hashed_password: str,
    purpose: str,
    user_id: int | None = None,
    verification_metadata: dict | None = None,
) -> EmailVerification:
    verification_code = _generate_verification_code()
    expires_at = datetime.now() + timedelta(minutes=settings.EMAIL_VERIFICATION_EXPIRE_MINUTES)

    pending_query = db.query(EmailVerification).filter(
        EmailVerification.email == email,
        EmailVerification.purpose == purpose,
        EmailVerification.verified == False,  # noqa: E712
    )
    if user_id is not None:
        pending_query = pending_query.filter(EmailVerification.user_id == user_id)
    pending_query.delete(synchronize_session=False)

    verification = EmailVerification(
        email=email,
        username=username,
        hashed_password=hashed_password,
        purpose=purpose,
        user_id=user_id,
        verification_metadata=verification_metadata,
        verification_code=verification_code,
        expires_at=expires_at,
    )
    db.add(verification)
    db.commit()
    db.refresh(verification)
    return verification


def _can_set_tournament_payout(db: Session, community: Community, user_id: int) -> bool:
    # Any community member creating a tournament can set payout; this helper now
    # means "can create payout that exceeds collected fees".
    if _is_global_admin(db, user_id):
        return True
    return community.commissioner_id == user_id


def _can_manage_tournament_settings(db: Session, table: Table, user_id: int) -> bool:
    if _is_global_admin(db, user_id):
        return True
    if table.community and table.community.commissioner_id == user_id:
        return True
    return table.created_by_user_id == user_id


def _normalize_tournament_payout(raw_payout: list[int] | None, *, is_percentage: bool) -> list[int]:
    if raw_payout is None:
        return []
    if len(raw_payout) == 0:
        return []
    if len(raw_payout) > 50:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payout structure cannot exceed 50 places")

    normalized: list[int] = []
    for amount in raw_payout:
        try:
            value = int(amount)
        except (TypeError, ValueError):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payout values must be integers")
        if value <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payout values must be positive")
        normalized.append(value)

    if is_percentage:
        if any(value > 100 for value in normalized):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payout percentages must be between 1 and 100")
        total_percentage = sum(normalized)
        if total_percentage > 100:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payout percentages cannot exceed 100% in total")

    return normalized


def _compute_percentage_payout_amounts(prize_pool: int, percentages: list[int]) -> list[int]:
    if prize_pool <= 0 or not percentages:
        return []

    amounts = [int(math.floor(prize_pool * (pct / 100))) for pct in percentages]
    distributed = sum(amounts)
    remainder = max(0, prize_pool - distributed)
    if amounts:
        amounts[0] += remainder
    return amounts


def _generate_single_elimination_rounds(registrations: list[TournamentRegistration]) -> list[dict]:
    seeded = registrations[:]
    random.shuffle(seeded)
    total_players = len(seeded)

    bracket_size = 1
    while bracket_size < max(2, total_players):
        bracket_size *= 2

    first_round_slots: list[TournamentRegistration | None] = seeded + [None] * (bracket_size - total_players)
    rounds: list[dict] = []

    # Round 1 seeded entries
    round_one_matches: list[dict] = []
    for index in range(0, len(first_round_slots), 2):
        match_no = (index // 2) + 1
        left = first_round_slots[index]
        right = first_round_slots[index + 1]
        winner_user_id: int | None = None
        match_status = "pending"
        if left is None or right is None:
            winner_user_id = left.user_id if left else (right.user_id if right else None)
            match_status = "bye"
        round_one_matches.append({
            "id": f"R1M{match_no}",
            "player1_user_id": left.user_id if left else None,
            "player1_username": left.user.username if left and left.user else None,
            "player2_user_id": right.user_id if right else None,
            "player2_username": right.user.username if right and right.user else None,
            "winner_user_id": winner_user_id,
            "status": match_status,
        })
    rounds.append({"round": 1, "matches": round_one_matches})

    # Placeholder rounds that reference prior round matches
    match_count = len(round_one_matches)
    round_no = 2
    while match_count > 1:
        next_count = match_count // 2
        matches: list[dict] = []
        for index in range(next_count):
            left_id = f"R{round_no - 1}M{index * 2 + 1}"
            right_id = f"R{round_no - 1}M{index * 2 + 2}"
            matches.append({
                "id": f"R{round_no}M{index + 1}",
                "source_match_ids": [left_id, right_id],
                "player1_user_id": None,
                "player2_user_id": None,
                "winner_user_id": None,
                "status": "pending",
            })
        rounds.append({"round": round_no, "matches": matches})
        match_count = next_count
        round_no += 1

    return rounds


def _generate_balanced_tournament_bracket(registrations: list[TournamentRegistration], max_table_size: int) -> dict:
    participants = registrations[:]
    random.shuffle(participants)
    total_players = len(participants)
    if total_players == 0:
        return {
            "format": "staged_single_elimination",
            "generated_at": datetime.utcnow().isoformat(),
            "participant_count": 0,
            "stage_one_tables": [],
            "rounds": [],
            "fairness_notes": [],
        }

    table_capacity = max(2, min(8, int(max_table_size or 8)))
    table_count = max(1, math.ceil(total_players / table_capacity))
    base_size = total_players // table_count
    remainder = total_players % table_count
    table_sizes = [base_size + (1 if idx < remainder else 0) for idx in range(table_count)]

    # Avoid opening a 2-player table while other first-stage tables are 4+ players.
    while True:
        two_player_idx = next((idx for idx, size in enumerate(table_sizes) if size == 2), None)
        donor_idx = max(range(len(table_sizes)), key=lambda idx: table_sizes[idx]) if table_sizes else None
        if two_player_idx is None or donor_idx is None:
            break
        if table_sizes[donor_idx] <= 3:
            break
        table_sizes[two_player_idx] += 1
        table_sizes[donor_idx] -= 1

    stage_one_tables: list[dict] = []
    cursor = 0
    for idx, size in enumerate(table_sizes, start=1):
        table_players = participants[cursor:cursor + size]
        cursor += size
        stage_one_tables.append(
            {
                "table_no": idx,
                "seat_count": size,
                "players": [
                    {
                        "user_id": reg.user_id,
                        "username": reg.user.username if reg.user else f"user_{reg.user_id}",
                        "seed": reg.seed,
                    }
                    for reg in table_players
                ],
            }
        )

    fairness_notes: list[str] = []
    if any(size == 2 for size in table_sizes) and total_players > 2:
        fairness_notes.append("At least one opening table is heads-up because of remaining participant counts.")
    fairness_notes.append("Stage one table sizes are balanced to avoid avoidable opening heads-up tables.")

    return {
        "format": "staged_single_elimination",
        "generated_at": datetime.utcnow().isoformat(),
        "participant_count": total_players,
        "stage_one_tables": stage_one_tables,
        "rounds": _generate_single_elimination_rounds(participants),
        "fairness_notes": fairness_notes,
    }


def _resolve_tournament_security_deposit(buy_in: int, configured_deposit: int | None) -> int:
    if configured_deposit is not None and configured_deposit > 0:
        return int(configured_deposit)
    if buy_in <= 0:
        return 0
    return int(math.ceil(buy_in * 0.10))


def _maybe_start_tournament_table(db: Session, table: Table) -> None:
    if table.game_type != GameType.TOURNAMENT:
        return
    if not table.tournament_start_time:
        return
    state_value = table.tournament_state or "scheduled"
    if state_value in {"running", "completed", "canceled"}:
        return
    now = datetime.now(table.tournament_start_time.tzinfo) if table.tournament_start_time.tzinfo else datetime.utcnow()
    if now < table.tournament_start_time:
        return

    registrations = db.query(TournamentRegistration).filter(
        TournamentRegistration.table_id == table.id,
        TournamentRegistration.status.in_([
            TournamentRegistrationStatus.REGISTERED.value,
            TournamentRegistrationStatus.CONFIRMED.value,
        ]),
    ).order_by(TournamentRegistration.registered_at.asc()).all()

    if state_value in {"scheduled", "waiting_for_players"}:
        if len(registrations) < 2:
            table.tournament_state = "waiting_for_players"
            table.tournament_start_time = now + timedelta(minutes=TOURNAMENT_RESCHEDULE_DELAY_MINUTES)
            table.tournament_confirmation_deadline = None
            db.commit()
            db.refresh(table)
            return

        confirmation_window = max(30, int(table.tournament_confirmation_window_seconds or TOURNAMENT_DEFAULT_CONFIRMATION_WINDOW_SECONDS))
        table.tournament_confirmation_window_seconds = confirmation_window
        table.tournament_state = "awaiting_confirmations"
        table.tournament_confirmation_deadline = now + timedelta(seconds=confirmation_window)
        db.commit()
        db.refresh(table)
        return

    if state_value != "awaiting_confirmations":
        return

    deadline = table.tournament_confirmation_deadline
    if deadline is not None:
        now_for_deadline = datetime.now(deadline.tzinfo) if deadline.tzinfo else datetime.utcnow()
        if now_for_deadline < deadline:
            return

    forfeited_deposits = 0
    confirmed_registrations: list[TournamentRegistration] = []
    for entry in registrations:
        if entry.status == TournamentRegistrationStatus.CONFIRMED.value:
            confirmed_registrations.append(entry)
            continue

        entry.status = TournamentRegistrationStatus.NO_SHOW.value
        entry.confirmed_at = None
        forfeited_deposits += max(0, int(entry.paid_security_deposit or 0))

        if entry.paid_entry_fee > 0:
            wallet = db.query(Wallet).filter(
                Wallet.user_id == entry.user_id,
                Wallet.community_id == table.community_id,
            ).first()
            if wallet:
                wallet.balance += entry.paid_entry_fee

    if len(confirmed_registrations) < 2:
        for entry in confirmed_registrations:
            entry.status = TournamentRegistrationStatus.WITHDRAWN.value
            entry.confirmed_at = None
            refund_amount = max(0, int(entry.paid_entry_fee or 0)) + max(0, int(entry.paid_security_deposit or 0))
            if refund_amount > 0:
                wallet = db.query(Wallet).filter(
                    Wallet.user_id == entry.user_id,
                    Wallet.community_id == table.community_id,
                ).first()
                if wallet:
                    wallet.balance += refund_amount

        table.tournament_state = "canceled"
        table.tournament_completed_at = datetime.utcnow()
        table.tournament_confirmation_deadline = None
        table.tournament_prize_pool = 0
        table.tournament_bracket = {
            "format": "staged_single_elimination",
            "generated_at": datetime.utcnow().isoformat(),
            "participant_count": len(confirmed_registrations),
            "status": "canceled_not_enough_confirmed_players",
        }
        db.commit()
        db.refresh(table)
        return

    entry_pool = sum(max(0, int(entry.paid_entry_fee or 0)) for entry in confirmed_registrations)
    effective_pool = entry_pool + forfeited_deposits

    payout_values: list[int] = []
    if isinstance(table.tournament_payout, list):
        for value in table.tournament_payout:
            try:
                normalized = int(value)
            except (TypeError, ValueError):
                continue
            if normalized > 0:
                payout_values.append(normalized)

    payout_is_percentage = True if table.tournament_payout_is_percentage is None else bool(table.tournament_payout_is_percentage)
    if not payout_values and payout_is_percentage:
        payout_values = TOURNAMENT_DEFAULT_PAYOUT_PERCENTAGES[:]
        table.tournament_payout = payout_values
        table.tournament_payout_is_percentage = True

    payout_amounts = (
        _compute_percentage_payout_amounts(effective_pool, payout_values)
        if payout_is_percentage
        else payout_values
    )
    table.tournament_prize_pool = sum(payout_amounts)

    seeded = confirmed_registrations[:]
    random.shuffle(seeded)
    for idx, entry in enumerate(seeded, start=1):
        entry.seed = idx

    table.tournament_state = "running"
    table.tournament_started_at = datetime.utcnow()
    table.tournament_confirmation_deadline = None
    table.tournament_bracket = _generate_balanced_tournament_bracket(seeded, table.max_seats)
    if isinstance(table.tournament_bracket, dict):
        table.tournament_bracket["entry_pool"] = entry_pool
        table.tournament_bracket["forfeited_security_deposits"] = forfeited_deposits
        table.tournament_bracket["effective_prize_pool"] = table.tournament_prize_pool
        table.tournament_bracket["payout_type"] = "percentage" if payout_is_percentage else "fixed"
        table.tournament_bracket["payout_amounts"] = payout_amounts
    db.commit()
    db.refresh(table)


def _table_to_response_with_tournament_meta(db: Session, table: Table, user_id: int | None) -> TableResponse:
    payload = TableResponse.model_validate(table).model_dump()

    if table.game_type == GameType.TOURNAMENT:
        registration_count = db.query(TournamentRegistration).filter(
            TournamentRegistration.table_id == table.id,
            TournamentRegistration.status.in_([
                TournamentRegistrationStatus.REGISTERED.value,
                TournamentRegistrationStatus.CONFIRMED.value,
            ]),
        ).count()
        payload["tournament_registration_count"] = registration_count

        if user_id is not None:
            payload["tournament_is_registered"] = db.query(TournamentRegistration.id).filter(
                TournamentRegistration.table_id == table.id,
                TournamentRegistration.user_id == user_id,
                TournamentRegistration.status.in_([
                    TournamentRegistrationStatus.REGISTERED.value,
                    TournamentRegistrationStatus.CONFIRMED.value,
                ]),
            ).first() is not None

    return TableResponse(**payload)


def _table_responses_with_metadata(db: Session, tables: list[Table], user_id: int | None) -> list[TableResponse]:
    if not tables:
        return []

    table_ids = [table.id for table in tables]

    occupied_counts = {
        int(table_id): int(count)
        for table_id, count in (
            db.query(TableSeat.table_id, func.count(TableSeat.id))
            .filter(
                TableSeat.table_id.in_(table_ids),
                TableSeat.user_id.isnot(None),
            )
            .group_by(TableSeat.table_id)
            .all()
        )
    }
    queue_counts = {
        int(table_id): int(count)
        for table_id, count in (
            db.query(TableQueue.table_id, func.count(TableQueue.id))
            .filter(TableQueue.table_id.in_(table_ids))
            .group_by(TableQueue.table_id)
            .all()
        )
    }

    my_queue_rows: dict[int, TableQueue] = {}
    if user_id is not None:
        for entry in (
            db.query(TableQueue)
            .filter(
                TableQueue.table_id.in_(table_ids),
                TableQueue.user_id == user_id,
            )
            .all()
        ):
            my_queue_rows[int(entry.table_id)] = entry

    responses: list[TableResponse] = []
    for table in tables:
        response = _table_to_response_with_tournament_meta(db, table, user_id)
        response.occupied_seat_count = occupied_counts.get(table.id, 0)
        response.queue_count = queue_counts.get(table.id, 0)
        my_queue_entry = my_queue_rows.get(table.id)
        response.my_queue_position = int(my_queue_entry.position) if my_queue_entry else None
        response.my_queue_buy_in_amount = int(my_queue_entry.reserved_buy_in_amount) if my_queue_entry else None
        responses.append(response)

    return responses


# ============================================================================
# Authentication Endpoints (Public)
# ============================================================================

@app.post("/auth/register", status_code=status.HTTP_201_CREATED)
def register_user(user_data: UserCreate, db: Session = Depends(get_db)):
    """
    Register a new user account
    
    - **username**: Unique username (3-50 characters)
    - **email**: Unique email address
    - **password**: Password (min 8 characters)
    
    In production mode, sends a verification email with 6-digit code.
    In dev mode, creates the user immediately.
    """
    # Check if username already exists
    existing_user = db.query(User).filter(User.username == user_data.username).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )
    
    # Check if email already exists
    existing_email = db.query(User).filter(User.email == user_data.email).first()
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    hashed_password = get_password_hash(user_data.password)

    # In dev mode, bootstrap the first admin user if none exist.
    is_admin = False
    if not settings.is_production:
        existing_admin = db.query(User).filter(User.is_admin == True).first()
        if not existing_admin:
            is_admin = True
    
    # Production mode: require email verification
    if settings.is_production:
        verification = _create_email_verification(
            db,
            email=user_data.email,
            username=user_data.username,
            hashed_password=hashed_password,
            purpose=EMAIL_VERIFICATION_PURPOSE_REGISTRATION,
        )
        
        # Send verification email
        _send_verification_email(user_data.email, user_data.username, verification.verification_code)
        
        return {
            "message": "Verification code sent to your email",
            "requires_verification": True,
            "email": user_data.email
        }
    
    # Dev mode: create user immediately
    new_user = User(
        username=user_data.username,
        email=user_data.email,
        hashed_password=hashed_password,
        email_verified=True,  # Auto-verified in dev mode
        is_admin=is_admin
    )
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return UserResponse.model_validate(new_user)


@app.post("/auth/login")
def login(username: str, password: str, db: Session = Depends(get_db)):
    """
    Login with username and password to get JWT token
    
    - **username**: Your username
    - **password**: Your password
    
    Returns JWT access token to use for authenticated requests.
    For admin users in production mode, requires 2FA verification.
    """
    # Find user
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password"
        )
    
    # Verify password
    if not verify_password(password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password"
        )
    
    # Check if user is active
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is disabled"
        )
    
    # Admin users require 2FA in production mode
    if user.is_admin and settings.is_production:
        verification = _create_email_verification(
            db,
            email=user.email,
            username=user.username,
            hashed_password=user.hashed_password,
            purpose=EMAIL_VERIFICATION_PURPOSE_ADMIN_LOGIN,
            user_id=user.id,
        )
        
        # Send verification email
        _send_admin_login_email(user.email, user.username, verification.verification_code)
        
        return {
            "requires_2fa": True,
            "message": "Verification code sent to your email",
            "email": user.email,
            "is_admin": True
        }
    
    # Create access token for non-admin or dev mode
    access_token = _issue_access_token_for_user(user)
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": _serialize_public_user(user)
    }


@app.post("/auth/verify-admin-login")
def verify_admin_login(
    email: str,
    verification_code: str,
    db: Session = Depends(get_db)
):
    """
    Verify admin login with 2FA code.
    """
    # Find pending verification
    verification = db.query(EmailVerification).filter(
        EmailVerification.email == email,
        EmailVerification.verification_code == verification_code,
        EmailVerification.purpose == EMAIL_VERIFICATION_PURPOSE_ADMIN_LOGIN,
        EmailVerification.verified == False
    ).first()
    
    if not verification:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid verification code"
        )
    
    if verification.expires_at < datetime.now(verification.expires_at.tzinfo):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification code has expired. Please login again."
        )
    
    # Find the user
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User not found"
        )
    
    # Mark verification as used
    verification.verified = True
    db.commit()
    
    # Create access token
    access_token = _issue_access_token_for_user(user)
    
    return {
        "success": True,
        "access_token": access_token,
        "token_type": "bearer",
        "user": _serialize_public_user(user)
    }


@app.post("/auth/recovery/request")
def request_account_recovery(
    payload: AccountRecoveryRequest,
    db: Session = Depends(get_db)
):
    """
    Request account recovery. Always returns a generic success message.
    """
    user = db.query(User).filter(User.email == payload.email).first()
    if user and user.is_active:
        verification = _create_email_verification(
            db,
            email=user.email,
            username=user.username,
            hashed_password=user.hashed_password,
            purpose=EMAIL_VERIFICATION_PURPOSE_ACCOUNT_RECOVERY,
            user_id=user.id,
        )
        _send_account_recovery_email(user.email, user.username, verification.verification_code)

    return {"message": "If an account exists for that email, a verification code has been sent."}


@app.post("/auth/recovery/verify", response_model=AccountRecoveryVerifyResponse)
def verify_account_recovery(
    payload: AccountRecoveryVerifyRequest,
    db: Session = Depends(get_db)
):
    verification = db.query(EmailVerification).filter(
        EmailVerification.email == payload.email,
        EmailVerification.verification_code == payload.verification_code,
        EmailVerification.purpose == EMAIL_VERIFICATION_PURPOSE_ACCOUNT_RECOVERY,
        EmailVerification.verified == False,  # noqa: E712
    ).first()

    if not verification:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid verification code"
        )

    if verification.expires_at < datetime.now(verification.expires_at.tzinfo):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification code has expired. Please request a new one."
        )

    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to recover this account"
        )

    if payload.new_password:
        if verify_password(payload.new_password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New password must be different from current password"
            )
        user.hashed_password = get_password_hash(payload.new_password)

    verification.verified = True
    db.commit()

    message = "Verification successful. You can now login."
    if payload.new_password:
        message = "Verification successful. Password reset complete."

    return AccountRecoveryVerifyResponse(
        success=True,
        message=message,
        username=user.username,
    )


@app.get("/auth/me")
def get_current_user_info(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get current authenticated user's info.
    Used to refresh user data after login or when stored data may be stale.
    """
    user_id = current_user.get("user_id")
    user = db.query(User).filter(User.id == user_id).first()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    return _serialize_public_user(user)


# ============================================================================
# Admin Endpoints (Global Admin Only)
# ============================================================================

@app.patch("/api/admin/users/{user_id}/ban")
def set_user_ban_status(
    user_id: int,
    payload: BanStatusRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    admin_user = _require_global_admin(db, current_user)
    target_user = _get_user_or_404(db, user_id)

    if target_user.id == admin_user.id and payload.is_banned:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot ban your own account"
        )

    target_user.is_banned = payload.is_banned
    db.commit()

    return {"message": "Ban status updated", "user_id": target_user.id, "is_banned": target_user.is_banned}


@app.delete("/api/admin/users/{user_id}")
def delete_user_account(
    user_id: int,
    reassign_to_user_id: int | None = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    admin_user = _require_global_admin(db, current_user)
    target_user = _get_user_or_404(db, user_id)

    if target_user.id == admin_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account while authenticated"
        )

    if reassign_to_user_id is None:
        reassign_to_user_id = admin_user.id
    if reassign_to_user_id == target_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reassign user cannot be the same as the deleted user"
        )

    reassign_user = _get_user_or_404(db, reassign_to_user_id)

    # Reassign ownership/creator roles
    db.query(League).filter(League.owner_id == target_user.id).update(
        {"owner_id": reassign_user.id}
    )
    db.query(Community).filter(Community.commissioner_id == target_user.id).update(
        {"commissioner_id": reassign_user.id}
    )
    db.query(Table).filter(Table.created_by_user_id == target_user.id).update(
        {"created_by_user_id": reassign_user.id}
    )

    # Clear seats and queue entries
    db.query(TableSeat).filter(TableSeat.user_id == target_user.id).update(
        {"user_id": None, "occupied_at": None}
    )

    queue_table_ids = [
        row[0] for row in db.query(TableQueue.table_id).filter(TableQueue.user_id == target_user.id).all()
    ]
    db.query(TableQueue).filter(TableQueue.user_id == target_user.id).delete()
    for table_id in queue_table_ids:
        entries = db.query(TableQueue).filter(TableQueue.table_id == table_id).order_by(TableQueue.position).all()
        for index, entry in enumerate(entries, start=1):
            entry.position = index

    # Remove memberships/admin roles
    db.query(LeagueMember).filter(LeagueMember.user_id == target_user.id).delete()
    db.query(LeagueAdmin).filter(LeagueAdmin.user_id == target_user.id).delete()
    db.query(CommunityAdmin).filter(CommunityAdmin.user_id == target_user.id).delete()

    # Null out inviter/reviewer references
    db.query(LeagueAdmin).filter(LeagueAdmin.invited_by_user_id == target_user.id).update(
        {"invited_by_user_id": None}
    )
    db.query(CommunityAdmin).filter(CommunityAdmin.invited_by_user_id == target_user.id).update(
        {"invited_by_user_id": None}
    )
    db.query(JoinRequest).filter(JoinRequest.reviewed_by_user_id == target_user.id).update(
        {"reviewed_by_user_id": None}
    )
    db.query(LeagueJoinRequest).filter(LeagueJoinRequest.reviewed_by_user_id == target_user.id).update(
        {"reviewed_by_user_id": None}
    )

    # Delete membership requests by the user
    db.query(JoinRequest).filter(JoinRequest.user_id == target_user.id).delete()
    db.query(LeagueJoinRequest).filter(LeagueJoinRequest.user_id == target_user.id).delete()

    # Delete wallets and inbox for the user
    db.query(Wallet).filter(Wallet.user_id == target_user.id).delete()
    db.query(InboxMessage).filter(InboxMessage.recipient_user_id == target_user.id).delete()
    db.query(InboxMessage).filter(InboxMessage.sender_user_id == target_user.id).update(
        {"sender_user_id": None}
    )

    # Ensure reassigned user is a member of leagues they now manage
    reassigned_league_ids = {
        row[0] for row in db.query(League.id).filter(League.owner_id == reassign_user.id).all()
    }
    reassigned_league_ids.update(
        row[0] for row in db.query(Community.league_id).filter(Community.commissioner_id == reassign_user.id).all()
    )
    for league_id in reassigned_league_ids:
        existing_member = db.query(LeagueMember).filter(
            LeagueMember.league_id == league_id,
            LeagueMember.user_id == reassign_user.id
        ).first()
        if not existing_member:
            db.add(LeagueMember(league_id=league_id, user_id=reassign_user.id))

    db.delete(target_user)
    db.commit()

    return {"message": "User deleted", "user_id": target_user.id}


@app.patch("/api/admin/leagues/{league_id}/currency")
def set_league_currency(
    league_id: int,
    payload: CurrencyUpdateRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    _require_global_admin(db, current_user)
    league = db.query(League).filter(League.id == league_id).first()
    if not league:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="League not found")

    league.currency = payload.currency
    db.commit()

    return {"message": "League currency updated", "league_id": league.id, "currency": league.currency}


@app.patch("/api/admin/communities/{community_id}/currency")
def set_community_currency(
    community_id: int,
    payload: CurrencyUpdateRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    _require_global_admin(db, current_user)
    community = db.query(Community).filter(Community.id == community_id).first()
    if not community:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Community not found")

    community.currency = payload.currency
    db.commit()

    return {"message": "Community currency updated", "community_id": community.id, "currency": community.currency}


@app.post(
    "/api/admin/test-fixtures/gameplay-stack",
    response_model=TestFixtureGameplayStackResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_test_fixture_gameplay_stack(
    payload: TestFixtureGameplayStackCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    admin_user = _require_fixture_admin(db, current_user)
    run_tag = _validate_fixture_stack_request(payload)

    _acquire_run_tag_lock(db, run_tag)
    existing_run = db.query(TestFixtureRun).filter(TestFixtureRun.run_tag == run_tag).first()
    if existing_run:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="run_tag already exists")

    fixture_run = TestFixtureRun(
        run_tag=run_tag,
        status=TEST_FIXTURE_RUN_STATUS_CREATING,
        created_by_user_id=admin_user.id,
        player_count=payload.player_count,
        queued_player_count=payload.queued_player_count,
    )
    db.add(fixture_run)
    db.commit()

    try:
        run_fragment = _username_fragment_for_run(run_tag)
        created_users: list[tuple[User, str]] = []
        for index in range(1, payload.player_count + payload.queued_player_count + 1):
            username = f"e2e_{run_fragment}_{index}"[:50]
            email = f"e2e+{run_tag}+p{index}@example.test"[:100]
            password = _generate_test_password()
            user = User(
                username=username,
                email=email,
                hashed_password=get_password_hash(password),
                email_verified=True,
                is_test_user=True,
                test_run_tag=run_tag,
            )
            db.add(user)
            db.flush()
            created_users.append((user, password))

        owner_user = created_users[0][0]
        league = League(
            name=_test_entity_name("E2E League", run_tag, 100),
            description=f"Test-only fixture league for run {run_tag}"[:500],
            currency="chips",
            owner_id=owner_user.id,
            is_test_only=True,
            test_run_tag=run_tag,
        )
        db.add(league)
        db.flush()

        for user, _ in created_users:
            db.add(LeagueMember(league_id=league.id, user_id=user.id))

        community = Community(
            name=_test_entity_name("E2E Community", run_tag, 100),
            description=f"Test-only fixture community for run {run_tag}"[:500],
            league_id=league.id,
            currency="chips",
            starting_balance=payload.starting_balance,
            commissioner_id=owner_user.id,
            is_test_only=True,
            test_run_tag=run_tag,
        )
        db.add(community)
        db.flush()

        for user, _ in created_users:
            db.add(
                Wallet(
                    user_id=user.id,
                    community_id=community.id,
                    balance=payload.starting_balance,
                )
            )

        table = Table(
            community_id=community.id,
            name=_test_entity_name("E2E Table", run_tag, 100),
            status=TableStatus.WAITING,
            game_type=GameType.CASH,
            max_seats=payload.max_seats,
            small_blind=payload.small_blind,
            big_blind=payload.big_blind,
            buy_in=payload.buy_in,
            is_permanent=False,
            created_by_user_id=owner_user.id,
            max_queue_size=payload.max_queue_size,
            action_timeout_seconds=payload.action_timeout_seconds,
            agents_allowed=True,
            is_test_only=True,
            test_run_tag=run_tag,
        )
        db.add(table)
        db.flush()

        for seat_number in range(1, payload.max_seats + 1):
            db.add(TableSeat(table_id=table.id, seat_number=seat_number, user_id=None))

        db.commit()
        game_id = f"table_{table.id}"
        _update_fixture_run_status(
            db,
            run_tag,
            status_value=TEST_FIXTURE_RUN_STATUS_CREATING,
            league_id=league.id,
            community_id=community.id,
            table_id=table.id,
            game_id=game_id,
        )

        seat_rows = {
            seat.seat_number: seat
            for seat in db.query(TableSeat).filter(TableSeat.table_id == table.id).all()
        }
        wallet_rows = {
            wallet.user_id: wallet
            for wallet in db.query(Wallet).filter(Wallet.community_id == community.id).all()
        }

        response_users: list[dict[str, object]] = []
        for index, (user, password) in enumerate(created_users, start=1):
            if payload.auto_seat_players and index <= payload.player_count:
                await _seat_fixture_user(
                    db=db,
                    table=table,
                    seat=seat_rows[index],
                    user=user,
                    wallet=wallet_rows[user.id],
                    buy_in_amount=payload.buy_in,
                )
                response_users.append(
                    {
                        "user_id": user.id,
                        "username": user.username,
                        "email": user.email,
                        "password": password,
                        "is_test_user": True,
                        "seat_number": index,
                        "queue_position": None,
                    }
                )
            elif payload.auto_seat_players:
                queue_position = index - payload.player_count
                queued_wallet = wallet_rows[user.id]
                queued_wallet.balance -= payload.buy_in
                db.add(
                    TableQueue(
                        table_id=table.id,
                        user_id=user.id,
                        position=queue_position,
                        reserved_buy_in_amount=payload.buy_in,
                    )
                )
                db.commit()
                response_users.append(
                    {
                        "user_id": user.id,
                        "username": user.username,
                        "email": user.email,
                        "password": password,
                        "is_test_user": True,
                        "seat_number": None,
                        "queue_position": queue_position,
                    }
                )
            else:
                response_users.append(
                    {
                        "user_id": user.id,
                        "username": user.username,
                        "email": user.email,
                        "password": password,
                        "is_test_user": True,
                        "seat_number": None,
                        "queue_position": None,
                    }
                )

        _update_fixture_run_status(
            db,
            run_tag,
            status_value=TEST_FIXTURE_RUN_STATUS_ACTIVE,
            league_id=league.id,
            community_id=community.id,
            table_id=table.id,
            game_id=game_id,
            last_create_error=None,
            last_cleanup_error=None,
        )

        return TestFixtureGameplayStackResponse(
            run_tag=run_tag,
            auto_seat_players=payload.auto_seat_players,
            league_id=league.id,
            league_name=league.name,
            community_id=community.id,
            community_name=community.name,
            table_id=table.id,
            table_name=table.name,
            game_id=game_id,
            users=response_users,
        )
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        create_error = _truncate_error_message(str(exc))
        cleanup_error: str | None = None
        try:
            fixture_run = db.query(TestFixtureRun).filter(TestFixtureRun.run_tag == run_tag).first()
            if fixture_run:
                await _purge_fixture_runtime(fixture_run)
            _cleanup_fixture_run_rows(db, run_tag)
        except Exception as cleanup_exc:
            cleanup_error = _truncate_error_message(str(cleanup_exc))

        final_status = (
            TEST_FIXTURE_RUN_STATUS_CLEANUP_FAILED
            if cleanup_error
            else TEST_FIXTURE_RUN_STATUS_CREATE_FAILED
        )
        _update_fixture_run_status(
            db,
            run_tag,
            status_value=final_status,
            last_create_error=create_error,
            last_cleanup_error=cleanup_error,
        )
        logger.exception("Fixture provisioning failed for run %s", run_tag)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to provision test fixture run",
        )


@app.delete(
    "/api/admin/test-fixtures/runs/{run_tag}",
    response_model=TestFixtureCleanupResponse,
)
async def delete_test_fixture_run(
    run_tag: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_fixture_admin(db, current_user)
    normalized_run_tag = _validate_run_tag(run_tag)

    _acquire_run_tag_lock(db, normalized_run_tag)
    fixture_run = db.query(TestFixtureRun).filter(TestFixtureRun.run_tag == normalized_run_tag).first()
    if not fixture_run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fixture run not found")
    if fixture_run.status == TEST_FIXTURE_RUN_STATUS_CLEANED:
        return TestFixtureCleanupResponse(
            run_tag=normalized_run_tag,
            status=TEST_FIXTURE_RUN_STATUS_CLEANED,
            deleted=_fixture_cleanup_counts(),
        )
    if fixture_run.status == TEST_FIXTURE_RUN_STATUS_CLEANUP_STARTED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cleanup already in progress")

    fixture_run.status = TEST_FIXTURE_RUN_STATUS_CLEANUP_STARTED
    db.commit()
    db.refresh(fixture_run)

    try:
        await _purge_fixture_runtime(fixture_run)
        counts = _cleanup_fixture_run_rows(db, normalized_run_tag)
    except Exception as exc:
        _update_fixture_run_status(
            db,
            normalized_run_tag,
            status_value=TEST_FIXTURE_RUN_STATUS_CLEANUP_FAILED,
            last_cleanup_error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to clean up test fixture run",
        ) from exc

    _update_fixture_run_status(
        db,
        normalized_run_tag,
        status_value=TEST_FIXTURE_RUN_STATUS_CLEANED,
        last_cleanup_error=None,
    )
    return TestFixtureCleanupResponse(
        run_tag=normalized_run_tag,
        status=TEST_FIXTURE_RUN_STATUS_CLEANED,
        deleted=counts,
    )


# ============================================================================
# League Endpoints
# ============================================================================

@app.post("/api/leagues", response_model=LeagueResponse, status_code=status.HTTP_201_CREATED)
def create_league(
    league_data: LeagueCreate,
    _: None = Depends(_require_ui_create_request),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Create a new league
    
    - **name**: League name (3-100 characters)
    - **description**: Optional description
    """
    user_id = current_user.get("user_id")
    partition = _get_partition_context_for_user_id(db, user_id)
    _require_non_test_partition(partition)
    
    # Create league
    new_league = League(
        name=league_data.name,
        description=league_data.description,
        currency=league_data.currency,
        owner_id=user_id
    )
    
    db.add(new_league)
    db.flush()
    db.add(LeagueMember(league_id=new_league.id, user_id=user_id))
    db.commit()
    db.refresh(new_league)
    
    return new_league


@app.get("/api/leagues", response_model=list[LeagueResponse])
def list_leagues(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all leagues with membership status for the current user"""
    user_id = current_user.get("user_id")
    partition = _get_partition_context_for_user_id(db, user_id)
    leagues = _apply_partition_filter(db.query(League), League, partition).all()

    if not leagues:
        return []

    league_ids = [league.id for league in leagues]
    owned_ids = {league.id for league in leagues if league.owner_id == user_id}

    member_ids = {
        row[0] for row in db.query(LeagueMember.league_id).filter(
            LeagueMember.user_id == user_id,
            LeagueMember.league_id.in_(league_ids)
        ).all()
    }

    admin_ids = {
        row[0] for row in db.query(LeagueAdmin.league_id).filter(
            LeagueAdmin.user_id == user_id,
            LeagueAdmin.league_id.in_(league_ids)
        ).all()
    }

    pending_ids = {
        row[0] for row in db.query(LeagueJoinRequest.league_id).filter(
            LeagueJoinRequest.user_id == user_id,
            LeagueJoinRequest.status == "pending",
            LeagueJoinRequest.league_id.in_(league_ids)
        ).all()
    }

    result = []
    for league in leagues:
        is_member = league.id in owned_ids or league.id in member_ids or league.id in admin_ids
        result.append({
            "id": league.id,
            "name": league.name,
            "description": league.description,
            "currency": league.currency,
            "owner_id": league.owner_id,
            "created_at": league.created_at,
            "is_member": is_member,
            "has_pending_request": league.id in pending_ids
        })

    return result


@app.delete("/api/leagues/{league_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_league(
    league_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Delete a league.

    Allowed for:
    - Global admins (can delete any league)
    - League owner (can delete only their own league)
    """
    user_id = current_user.get("user_id")
    partition = _get_partition_context_for_user_id(db, user_id)
    league = _get_visible_league_or_404(db, league_id, partition)

    if not (_is_global_admin(db, user_id) or league.owner_id == user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the league owner or a global admin can delete this league"
        )

    table_ids = [
        table_id for (table_id,) in db.query(Table.id)
        .join(Community, Table.community_id == Community.id)
        .filter(Community.league_id == league_id)
        .all()
    ]

    detached_history_count, detached_session_count = _prepare_table_deletion_cleanup(db, table_ids)
    db.delete(league)
    db.commit()
    logger.info(
        "League %s deleted by user %s; detached %s hand_history rows and %s table_sessions rows",
        league_id,
        user_id,
        detached_history_count,
        detached_session_count,
    )
    return None


@app.get("/api/leagues/{league_id}/admins")
def list_league_admins(
    league_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List league owner and league admins."""
    user_id = current_user.get("user_id")

    league = db.query(League).filter(League.id == league_id).first()
    if not league:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="League not found")

    if not (_is_global_admin(db, user_id) or _is_league_member(db, league_id, user_id)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You must be a league member to view admins"
        )

    owner = db.query(User).filter(User.id == league.owner_id).first()
    admins = db.query(User).join(
        LeagueAdmin, LeagueAdmin.user_id == User.id
    ).filter(LeagueAdmin.league_id == league_id).all()

    return {
        "owner": AdminUserResponse.model_validate(owner).model_dump() if owner else None,
        "admins": [AdminUserResponse.model_validate(admin).model_dump() for admin in admins]
    }


@app.post("/api/leagues/{league_id}/request-join", status_code=status.HTTP_201_CREATED)
def request_to_join_league(
    league_id: int,
    message: str | None = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Request to join a league. League owners/admins will review the request.
    """
    from .models import InboxMessage

    user_id = current_user.get("user_id")
    username = current_user.get("username")
    user = _get_user_or_404(db, user_id)
    _ensure_not_banned(user)

    league = db.query(League).filter(League.id == league_id).first()
    if not league:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="League not found")

    if _is_league_member(db, league_id, user_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Already a member of this league"
        )

    existing_request = db.query(LeagueJoinRequest).filter(
        LeagueJoinRequest.user_id == user_id,
        LeagueJoinRequest.league_id == league_id,
        LeagueJoinRequest.status == "pending"
    ).first()

    if existing_request:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have a pending request for this league"
        )

    join_request = LeagueJoinRequest(
        user_id=user_id,
        league_id=league_id,
        message=message[:250] if message else None,
        status="pending"
    )
    db.add(join_request)
    db.flush()

    admin_user_ids = {league.owner_id}
    admin_user_ids.update(
        row[0] for row in db.query(LeagueAdmin.user_id).filter(
            LeagueAdmin.league_id == league_id
        ).all()
    )

    for admin_id in admin_user_ids:
        inbox_message = InboxMessage(
            recipient_user_id=admin_id,
            sender_user_id=user_id,
            message_type="league_join_request",
            title=f"League Join Request: {username}",
            content=(
                f"{username} has requested to join {league.name}."
                + (f"\n\nMessage: {message}" if message else "")
            ),
            message_metadata={
                "request_id": join_request.id,
                "league_id": league.id,
                "league_name": league.name,
                "user_id": user_id,
                "username": username
            },
            is_actionable=True
        )
        db.add(inbox_message)

    db.commit()

    return {"message": "Join request submitted successfully", "request_id": join_request.id}


@app.get("/api/leagues/{league_id}/join-requests")
def get_league_join_requests(
    league_id: int,
    status_filter: str | None = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get join requests for a league (owner/admin only)
    """
    user_id = current_user.get("user_id")

    league = db.query(League).filter(League.id == league_id).first()
    if not league:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="League not found")

    if not (league.owner_id == user_id or _is_league_admin(db, league_id, user_id)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only league owners or admins can view join requests"
        )

    query = db.query(LeagueJoinRequest).filter(LeagueJoinRequest.league_id == league_id)
    if status_filter:
        query = query.filter(LeagueJoinRequest.status == status_filter)

    requests = query.order_by(LeagueJoinRequest.created_at.desc()).all()

    result = []
    for req in requests:
        user = db.query(User).filter(User.id == req.user_id).first()
        result.append({
            "id": req.id,
            "user_id": req.user_id,
            "username": user.username if user else "Unknown",
            "league_id": league.id,
            "league_name": league.name,
            "message": req.message,
            "status": req.status,
            "reviewed_by_user_id": req.reviewed_by_user_id,
            "reviewed_at": req.reviewed_at.isoformat() if req.reviewed_at else None,
            "created_at": req.created_at.isoformat()
        })

    return result


@app.post("/api/leagues/{league_id}/admins/invite")
def invite_league_admin(
    league_id: int,
    invite: AdminInviteRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Invite a user to be a league admin (immediately grants role)."""
    from .models import InboxMessage

    user_id = current_user.get("user_id")

    league = db.query(League).filter(League.id == league_id).first()
    if not league:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="League not found")

    if not (league.owner_id == user_id or _is_league_admin(db, league_id, user_id)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only league owners or admins can invite league admins"
        )

    if not invite.username and not invite.email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Username or email is required"
        )

    if invite.username and invite.email:
        invited_user = db.query(User).filter(
            or_(User.username == invite.username, User.email == invite.email)
        ).first()
    elif invite.username:
        invited_user = db.query(User).filter(User.username == invite.username).first()
    else:
        invited_user = db.query(User).filter(User.email == invite.email).first()

    if not invited_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if invited_user.id == league.owner_id:
        return {"message": "User is already the league owner"}

    existing = db.query(LeagueAdmin).filter(
        LeagueAdmin.league_id == league_id,
        LeagueAdmin.user_id == invited_user.id
    ).first()
    if existing:
        return {"message": "User is already a league admin"}

    new_admin = LeagueAdmin(
        league_id=league_id,
        user_id=invited_user.id,
        invited_by_user_id=user_id
    )
    db.add(new_admin)
    existing_member = db.query(LeagueMember).filter(
        LeagueMember.league_id == league_id,
        LeagueMember.user_id == invited_user.id
    ).first()
    if not existing_member:
        db.add(LeagueMember(league_id=league_id, user_id=invited_user.id))

    inbox_message = InboxMessage(
        recipient_user_id=invited_user.id,
        sender_user_id=user_id,
        message_type="league_admin_invite",
        title=f"League Admin Invite: {league.name}",
        content=f"You have been added as a league admin for {league.name}.",
        message_metadata={
            "league_id": league.id,
            "league_name": league.name
        },
        is_actionable=False
    )
    db.add(inbox_message)
    db.commit()

    return {"message": "League admin added successfully"}


# ============================================================================
# Community Endpoints (Public - requires auth)
# ============================================================================

@app.post("/api/communities", response_model=CommunityResponse, status_code=status.HTTP_201_CREATED)
def create_community(
    community_data: CommunityCreate,
    _: None = Depends(_require_ui_create_request),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Create a new community within a league (requires authentication)
    
    - **name**: Community name (3-100 characters)
    - **description**: Optional description
    - **league_id**: ID of the parent league
    - **starting_balance**: Initial balance for new members (default: 1000.00)
    """
    user_id = current_user.get("user_id")
    partition = _get_partition_context_for_user_id(db, user_id)
    _require_non_test_partition(partition)

    # Verify league exists
    league = _get_visible_league_or_404(db, community_data.league_id, partition)

    if not _is_league_member(db, league.id, user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You must be a member of this league to create a community"
        )

    currency = community_data.currency
    if "currency" not in community_data.model_fields_set:
        currency = league.currency
    
    # Create community
    new_community = Community(
        name=community_data.name,
        description=community_data.description,
        league_id=community_data.league_id,
        currency=currency,
        starting_balance=community_data.starting_balance,
        commissioner_id=user_id
    )
    
    db.add(new_community)
    db.commit()
    db.refresh(new_community)
    
    return new_community


@app.post("/api/communities/{community_id}/join", response_model=WalletResponse)
def join_community(
    community_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Join a community (creates a wallet with starting balance)
    
    - **community_id**: ID of the community to join
    """
    user_id = current_user.get("user_id")
    user = _get_user_or_404(db, user_id)
    _ensure_not_banned(user)
    partition = _build_partition_context_for_user(user)
    
    # Verify community exists
    community = _get_visible_community_or_404(db, community_id, partition)

    _assert_user_matches_resource_partition(
        user,
        community,
        "Cross-partition community joins are not allowed",
    )

    if not _is_league_member(db, community.league_id, user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You must be a league member to join this community"
        )
    
    # Check if wallet already exists
    existing_wallet = db.query(Wallet).filter(
        Wallet.user_id == user_id,
        Wallet.community_id == community_id
    ).first()
    
    if existing_wallet:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Already a member of this community"
        )
    
    # Create wallet with starting balance
    new_wallet = Wallet(
        user_id=user_id,
        community_id=community_id,
        balance=community.starting_balance
    )
    
    db.add(new_wallet)
    db.commit()
    db.refresh(new_wallet)
    
    return new_wallet


@app.get("/api/communities", response_model=list[CommunityResponse])
def list_communities(
    league_id: int | None = None,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
):
    """
    List all communities (optionally filter by league)
    
    - **league_id**: Optional league ID to filter by
    """
    partition = _normal_partition()
    if credentials:
        payload = decode_token(credentials.credentials)
        if payload and payload.get("user_id"):
            partition = _get_partition_context_for_user_id(db, int(payload["user_id"]))

    query = _apply_partition_filter(db.query(Community), Community, partition)
    
    if league_id:
        if partition.kind == "normal":
            league = db.query(League).filter(
                League.id == league_id,
                League.is_test_only.is_(False)
            ).first()
        else:
            league = db.query(League).filter(
                League.id == league_id,
                League.is_test_only.is_(True),
                League.test_run_tag == partition.run_tag
            ).first()
        if not league:
            return []
        query = query.filter(Community.league_id == league_id)
    
    communities = query.all()
    return communities


@app.delete("/api/communities/{community_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_community(
    community_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Delete a community.

    Allowed for:
    - Global admins (can delete any community)
    - Community commissioner (can delete only their own community)
    """
    user_id = current_user.get("user_id")
    partition = _get_partition_context_for_user_id(db, user_id)
    community = _get_visible_community_or_404(db, community_id, partition)

    if not (_is_global_admin(db, user_id) or community.commissioner_id == user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the community commissioner or a global admin can delete this community"
        )

    table_ids = [table_id for (table_id,) in db.query(Table.id).filter(Table.community_id == community_id).all()]
    detached_history_count, detached_session_count = _prepare_table_deletion_cleanup(db, table_ids)

    db.delete(community)
    db.commit()
    logger.info(
        "Community %s deleted by user %s; detached %s hand_history rows and %s table_sessions rows",
        community_id,
        user_id,
        detached_history_count,
        detached_session_count,
    )
    return None


@app.get("/api/communities/{community_id}/admins")
def list_community_admins(
    community_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List community commissioner and community admins."""
    user_id = current_user.get("user_id")

    community = db.query(Community).filter(Community.id == community_id).first()
    if not community:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Community not found")

    can_view_admins = (
        _is_global_admin(db, user_id)
        or community.commissioner_id == user_id
        or _is_community_admin(db, community_id, user_id)
        or _is_league_member(db, community.league_id, user_id)
    )

    if not can_view_admins:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to view community admins"
        )

    commissioner = db.query(User).filter(User.id == community.commissioner_id).first()
    admins = db.query(User).join(
        CommunityAdmin, CommunityAdmin.user_id == User.id
    ).filter(CommunityAdmin.community_id == community_id).all()

    return {
        "commissioner": AdminUserResponse.model_validate(commissioner).model_dump() if commissioner else None,
        "admins": [AdminUserResponse.model_validate(admin).model_dump() for admin in admins]
    }


@app.post("/api/communities/{community_id}/admins/invite")
def invite_community_admin(
    community_id: int,
    invite: AdminInviteRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Invite a user to be a community admin (immediately grants role)."""
    from .models import InboxMessage

    user_id = current_user.get("user_id")

    community = db.query(Community).filter(Community.id == community_id).first()
    if not community:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Community not found")

    if not (community.commissioner_id == user_id or _is_community_admin(db, community_id, user_id)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only community commissioners or admins can invite community admins"
        )

    if not invite.username and not invite.email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Username or email is required"
        )

    if invite.username and invite.email:
        invited_user = db.query(User).filter(
            or_(User.username == invite.username, User.email == invite.email)
        ).first()
    elif invite.username:
        invited_user = db.query(User).filter(User.username == invite.username).first()
    else:
        invited_user = db.query(User).filter(User.email == invite.email).first()

    if not invited_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if invited_user.id == community.commissioner_id:
        return {"message": "User is already the community commissioner"}

    existing = db.query(CommunityAdmin).filter(
        CommunityAdmin.community_id == community_id,
        CommunityAdmin.user_id == invited_user.id
    ).first()
    if existing:
        return {"message": "User is already a community admin"}

    new_admin = CommunityAdmin(
        community_id=community_id,
        user_id=invited_user.id,
        invited_by_user_id=user_id
    )
    db.add(new_admin)
    existing_member = db.query(LeagueMember).filter(
        LeagueMember.league_id == community.league_id,
        LeagueMember.user_id == invited_user.id
    ).first()
    if not existing_member:
        db.add(LeagueMember(league_id=community.league_id, user_id=invited_user.id))

    inbox_message = InboxMessage(
        recipient_user_id=invited_user.id,
        sender_user_id=user_id,
        message_type="community_admin_invite",
        title=f"Community Admin Invite: {community.name}",
        content=f"You have been added as a community admin for {community.name}.",
        message_metadata={
            "community_id": community.id,
            "community_name": community.name
        },
        is_actionable=False
    )
    db.add(inbox_message)
    db.commit()

    return {"message": "Community admin added successfully"}


# ============================================================================
# Wallet Endpoints (Public - requires auth)
# ============================================================================

@app.get("/api/wallets", response_model=list[WalletResponse])
def get_my_wallets(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get all wallets for the authenticated user
    """
    user_id = current_user.get("user_id")

    # Get all wallets for this user
    wallets = db.query(Wallet).filter(Wallet.user_id == user_id).all()
    return wallets


@app.get("/api/communities/{community_id}/wallets", response_model=list[CommunityWalletSummaryResponse])
def get_community_wallets(
    community_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    List wallets in a community (commissioner/global-admin only).
    """
    user_id = current_user.get("user_id")
    community = db.query(Community).filter(Community.id == community_id).first()
    if not community:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Community not found")

    if not (_is_global_admin(db, user_id) or community.commissioner_id == user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the community owner or a global admin can manage balances",
        )

    wallet_rows = (
        db.query(Wallet, User)
        .join(User, User.id == Wallet.user_id)
        .filter(Wallet.community_id == community_id)
        .order_by(User.username.asc())
        .all()
    )

    return [
        CommunityWalletSummaryResponse(
            user_id=user.id,
            username=user.username,
            balance=wallet.balance,
        )
        for wallet, user in wallet_rows
    ]


@app.patch(
    "/api/communities/{community_id}/wallets/{target_user_id}",
    response_model=CommunityWalletAdjustResponse,
)
def adjust_community_wallet(
    community_id: int,
    target_user_id: int,
    payload: CommunityWalletAdjustRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Adjust a community member wallet balance (commissioner/global-admin only).
    """
    actor_user_id = current_user.get("user_id")
    community = db.query(Community).filter(Community.id == community_id).first()
    if not community:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Community not found")

    if not (_is_global_admin(db, actor_user_id) or community.commissioner_id == actor_user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the community owner or a global admin can manage balances",
        )

    wallet = db.query(Wallet).filter(
        Wallet.community_id == community_id,
        Wallet.user_id == target_user_id,
    ).first()
    if not wallet:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wallet not found for target user")

    target_user = _get_user_or_404(db, target_user_id)
    amount = Decimal(payload.amount)
    previous_balance = Decimal(wallet.balance)

    if payload.operation == "set":
        new_balance = amount
    elif payload.operation == "add":
        new_balance = previous_balance + amount
    else:
        if previous_balance < amount:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot subtract {amount}; current balance is {previous_balance}",
            )
        new_balance = previous_balance - amount

    wallet.balance = new_balance
    db.commit()
    db.refresh(wallet)

    actor_user = db.query(User).filter(User.id == actor_user_id).first()
    actor_name = actor_user.username if actor_user else f"user_{actor_user_id}"
    reason_text = payload.reason.strip() if payload.reason else ""
    adjustment_text = f"{payload.operation} {amount} chips"
    content = (
        f"{actor_name} updated your {community.name} balance: {adjustment_text}. "
        f"New balance: {wallet.balance} chips."
    )
    if reason_text:
        content = f"{content} Reason: {reason_text}"

    inbox_message = InboxMessage(
        recipient_user_id=target_user.id,
        sender_user_id=actor_user_id,
        message_type="community_wallet_adjustment",
        title=f"Balance Updated in {community.name}",
        content=content,
        message_metadata={
            "community_id": community.id,
            "community_name": community.name,
            "operation": payload.operation,
            "amount": str(amount),
            "new_balance": str(wallet.balance),
            "reason": reason_text or None,
        },
        is_actionable=False,
    )
    db.add(inbox_message)
    db.commit()

    return CommunityWalletAdjustResponse(
        success=True,
        user_id=target_user.id,
        community_id=community.id,
        operation=payload.operation,
        amount=amount,
        previous_balance=previous_balance,
        new_balance=Decimal(wallet.balance),
        message=f"Updated {target_user.username}'s balance successfully",
    )


# ============================================================================
# Table Endpoints (Public - requires auth)
# ============================================================================

@app.get("/api/communities/{community_id}/tables", response_model=list[TableResponse])
def get_community_tables(
    community_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get all tables for a specific community
    Requires authentication
    """
    user_id = current_user.get("user_id")
    partition = _get_partition_context_for_user_id(db, user_id)
    community = _get_visible_community_or_404(db, community_id, partition)

    # Get all tables for this community
    tables = _apply_partition_filter(
        db.query(Table).filter(Table.community_id == community_id),
        Table,
        partition,
    ).all()
    for table in tables:
        _maybe_start_tournament_table(db, table)

    refreshed_tables = _apply_partition_filter(
        db.query(Table).filter(Table.community_id == community_id),
        Table,
        partition,
    ).all()
    return _table_responses_with_metadata(db, refreshed_tables, user_id)


@app.post("/api/communities/{community_id}/tables", response_model=TableResponse, status_code=status.HTTP_201_CREATED)
def create_table(
    community_id: int,
    table: TableCreate,
    _: None = Depends(_require_ui_create_request),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Create a new table in a community
    Requires authentication
    
    Permanent tables (is_permanent=True) can only be created by community owners.
    They remain visible even when empty.
    """
    user_id = current_user.get("user_id")
    partition = _get_partition_context_for_user_id(db, user_id)
    _require_non_test_partition(partition)
    
    # Check if community exists
    community = _get_visible_community_or_404(db, community_id, partition)
    # Check if user is trying to create a permanent table
    if table.is_permanent and community.commissioner_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the community owner can create permanent tables"
        )

    is_global_admin = _is_global_admin(db, user_id)
    has_wallet = db.query(Wallet.id).filter(
        Wallet.user_id == user_id,
        Wallet.community_id == community_id,
    ).first() is not None
    if not (is_global_admin or community.commissioner_id == user_id or has_wallet):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Join this community before creating tables",
        )

    tournament_payout: list[int] = []
    tournament_payout_is_percentage = True
    tournament_prize_pool = 0
    tournament_state: str | None = None
    tournament_start_time = None
    tournament_starting_stack = table.tournament_starting_stack
    tournament_security_deposit = 0
    tournament_confirmation_window_seconds = TOURNAMENT_DEFAULT_CONFIRMATION_WINDOW_SECONDS
    tournament_blind_interval_minutes = TOURNAMENT_DEFAULT_BLIND_INTERVAL_MINUTES
    tournament_blind_progression_percent = TOURNAMENT_DEFAULT_BLIND_PROGRESSION_PERCENT

    if table.game_type == GameType.TOURNAMENT:
        if table.tournament_start_time is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Tournament start time is required for tournament tables",
            )
        now_for_start = (
            datetime.now(table.tournament_start_time.tzinfo)
            if table.tournament_start_time.tzinfo
            else datetime.utcnow()
        )
        if table.tournament_start_time <= now_for_start:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Tournament start time must be in the future",
            )
        if table.buy_in < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Tournament buy-in cannot be negative",
            )
        if table.max_seats not in TOURNAMENT_ALLOWED_PLAYER_LIMITS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Tournament player limit must be one of: {sorted(TOURNAMENT_ALLOWED_PLAYER_LIMITS)}",
            )
        if table.big_blind < table.small_blind:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Big blind must be greater than or equal to small blind",
            )

        tournament_security_deposit = _resolve_tournament_security_deposit(table.buy_in, table.tournament_security_deposit)
        tournament_confirmation_window_seconds = max(
            30,
            int(table.tournament_confirmation_window_seconds or TOURNAMENT_DEFAULT_CONFIRMATION_WINDOW_SECONDS),
        )
        tournament_blind_interval_minutes = max(
            2,
            int(table.tournament_blind_interval_minutes or TOURNAMENT_DEFAULT_BLIND_INTERVAL_MINUTES),
        )
        tournament_blind_progression_percent = max(
            10,
            int(table.tournament_blind_progression_percent or TOURNAMENT_DEFAULT_BLIND_PROGRESSION_PERCENT),
        )

        tournament_payout_is_percentage = bool(table.tournament_payout_is_percentage)
        can_exceed_entry_fees = _can_set_tournament_payout(db, community, user_id)
        if not can_exceed_entry_fees and not tournament_payout_is_percentage:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the community commissioner or global admin can set fixed tournament payouts",
            )

        tournament_payout = _normalize_tournament_payout(
            table.tournament_payout,
            is_percentage=tournament_payout_is_percentage,
        )
        if not tournament_payout and tournament_payout_is_percentage:
            tournament_payout = TOURNAMENT_DEFAULT_PAYOUT_PERCENTAGES[:]

        if tournament_payout and not tournament_payout_is_percentage and not can_exceed_entry_fees:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Fixed payout structures are restricted to community commissioners and global admins",
            )
        if tournament_payout and not tournament_payout_is_percentage:
            tournament_prize_pool = sum(tournament_payout)

        tournament_state = "scheduled"
        tournament_start_time = table.tournament_start_time

        # Tournament tables are intended to persist in lobby visibility.
        table.is_permanent = True
    else:
        if table.buy_in <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cash game buy-in must be greater than zero",
            )
        if table.big_blind < table.small_blind:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Big blind must be greater than or equal to small blind",
            )

    # Create table
    db_table = Table(
        community_id=community_id,
        name=table.name,
        game_type=table.game_type,
        max_seats=table.max_seats,
        small_blind=table.small_blind,
        big_blind=table.big_blind,
        buy_in=table.buy_in,
        is_permanent=table.is_permanent,
        created_by_user_id=user_id,
        max_queue_size=table.max_queue_size,
        action_timeout_seconds=table.action_timeout_seconds,
        agents_allowed=table.agents_allowed,
        tournament_start_time=tournament_start_time,
        tournament_starting_stack=tournament_starting_stack,
        tournament_security_deposit=tournament_security_deposit,
        tournament_confirmation_window_seconds=tournament_confirmation_window_seconds,
        tournament_confirmation_deadline=None,
        tournament_blind_interval_minutes=tournament_blind_interval_minutes,
        tournament_blind_progression_percent=tournament_blind_progression_percent,
        tournament_state=tournament_state,
        tournament_payout=tournament_payout if tournament_payout else None,
        tournament_payout_is_percentage=tournament_payout_is_percentage,
        tournament_prize_pool=tournament_prize_pool,
        tournament_bracket=None,
        tournament_started_at=None,
        tournament_completed_at=None,
    )
    
    db.add(db_table)
    db.commit()
    db.refresh(db_table)
    
    # Pre-create seats for the table (1 to max_seats)
    from .models import TableSeat
    for seat_num in range(1, table.max_seats + 1):
        seat = TableSeat(
            table_id=db_table.id,
            seat_number=seat_num,
            user_id=None  # Available
        )
        db.add(seat)
    
    db.commit()
    
    return db_table


@app.get("/api/tables/{table_id}/tournament", response_model=TableTournamentDetailsResponse)
def get_table_tournament_details(
    table_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user.get("user_id")
    partition = _get_partition_context_for_user_id(db, user_id)
    table = _get_visible_table_or_404(db, table_id, partition)
    if table.game_type != GameType.TOURNAMENT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Table is not a tournament")

    _maybe_start_tournament_table(db, table)
    db.refresh(table)

    registrations = db.query(TournamentRegistration).filter(
        TournamentRegistration.table_id == table.id,
        TournamentRegistration.status.in_([
            TournamentRegistrationStatus.REGISTERED.value,
            TournamentRegistrationStatus.CONFIRMED.value,
            TournamentRegistrationStatus.NO_SHOW.value,
            TournamentRegistrationStatus.ELIMINATED.value,
        ]),
    ).order_by(TournamentRegistration.registered_at.asc()).all()

    registration_rows = [
        TournamentRegistrationResponse(
            table_id=entry.table_id,
            user_id=entry.user_id,
            username=entry.user.username if entry.user else f"user_{entry.user_id}",
            paid_entry_fee=entry.paid_entry_fee,
            paid_security_deposit=int(entry.paid_security_deposit or 0),
            starting_stack=entry.starting_stack,
            status=entry.status,
            confirmed_at=entry.confirmed_at,
            registered_at=entry.registered_at,
        )
        for entry in registrations
    ]

    can_set_payout = _can_manage_tournament_settings(db, table, user_id)
    is_registered = any(
        entry.user_id == user_id
        and entry.status in {
            TournamentRegistrationStatus.REGISTERED.value,
            TournamentRegistrationStatus.CONFIRMED.value,
        }
        for entry in registrations
    )
    is_confirmed = any(
        entry.user_id == user_id and entry.status == TournamentRegistrationStatus.CONFIRMED.value
        for entry in registrations
    )
    registration_count = sum(
        1
        for entry in registrations
        if entry.status in {
            TournamentRegistrationStatus.REGISTERED.value,
            TournamentRegistrationStatus.CONFIRMED.value,
        }
    )

    payout_values: list[int] = []
    if isinstance(table.tournament_payout, list):
        for value in table.tournament_payout:
            try:
                normalized = int(value)
            except (TypeError, ValueError):
                continue
            if normalized > 0:
                payout_values.append(normalized)

    state_value = table.tournament_state or "scheduled"
    payout_is_percentage = True if table.tournament_payout_is_percentage is None else bool(table.tournament_payout_is_percentage)
    return TableTournamentDetailsResponse(
        table_id=table.id,
        table_name=table.name,
        state=state_value,
        start_time=table.tournament_start_time,
        started_at=table.tournament_started_at,
        confirmation_deadline=table.tournament_confirmation_deadline,
        buy_in=table.buy_in,
        security_deposit=int(table.tournament_security_deposit or 0),
        starting_stack=table.tournament_starting_stack,
        blind_interval_minutes=max(2, int(table.tournament_blind_interval_minutes or TOURNAMENT_DEFAULT_BLIND_INTERVAL_MINUTES)),
        blind_progression_percent=max(10, int(table.tournament_blind_progression_percent or TOURNAMENT_DEFAULT_BLIND_PROGRESSION_PERCENT)),
        confirmation_window_seconds=max(
            30,
            int(table.tournament_confirmation_window_seconds or TOURNAMENT_DEFAULT_CONFIRMATION_WINDOW_SECONDS),
        ),
        max_players=table.max_seats,
        registration_count=registration_count,
        prize_pool=table.tournament_prize_pool or 0,
        payout=payout_values,
        payout_is_percentage=payout_is_percentage,
        bracket=table.tournament_bracket,
        can_set_payout=can_set_payout,
        is_registered=is_registered,
        is_confirmed=is_confirmed,
        registrations=registration_rows,
    )


@app.post("/api/tables/{table_id}/tournament/register")
def register_for_tournament(
    table_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user.get("user_id")
    user = _get_user_or_404(db, user_id)
    _ensure_not_banned(user)
    partition = _build_partition_context_for_user(user)

    table = _get_visible_table_or_404(db, table_id, partition)
    _assert_user_matches_resource_partition(user, table, "Cross-run tournament registration is not allowed")
    if table.game_type != GameType.TOURNAMENT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Table is not a tournament")

    _maybe_start_tournament_table(db, table)
    db.refresh(table)
    if table.tournament_state in {"awaiting_confirmations", "running", "completed", "canceled"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tournament registration is closed")

    existing_registration = db.query(TournamentRegistration).filter(
        TournamentRegistration.table_id == table.id,
        TournamentRegistration.user_id == user_id,
    ).first()
    if existing_registration and existing_registration.status in {
        TournamentRegistrationStatus.REGISTERED.value,
        TournamentRegistrationStatus.CONFIRMED.value,
    }:
        return {
            "success": True,
            "message": "Already registered for this tournament",
            "table_id": table.id,
            "paid_entry_fee": existing_registration.paid_entry_fee,
            "paid_security_deposit": int(existing_registration.paid_security_deposit or 0),
            "total_paid": int(existing_registration.paid_entry_fee or 0) + int(existing_registration.paid_security_deposit or 0),
            "starting_stack": existing_registration.starting_stack,
        }

    registration_count = db.query(TournamentRegistration).filter(
        TournamentRegistration.table_id == table.id,
        TournamentRegistration.status.in_([
            TournamentRegistrationStatus.REGISTERED.value,
            TournamentRegistrationStatus.CONFIRMED.value,
        ]),
    ).count()
    if registration_count >= table.max_seats:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tournament is full")

    paid_entry_fee = int(table.buy_in or 0)
    paid_security_deposit = _resolve_tournament_security_deposit(
        paid_entry_fee,
        int(table.tournament_security_deposit or 0),
    )
    total_required = paid_entry_fee + paid_security_deposit
    wallet = db.query(Wallet).filter(
        Wallet.user_id == user_id,
        Wallet.community_id == table.community_id,
    ).first()
    if not wallet:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You don't have a wallet in this community. Join the community first.",
        )
    if total_required > 0:
        if wallet.balance < total_required:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Insufficient funds. Available: {wallet.balance}, Required: {total_required}",
            )
        wallet.balance -= total_required

    starting_stack = max(100, int(table.tournament_starting_stack or 1000))
    if existing_registration:
        existing_registration.status = TournamentRegistrationStatus.REGISTERED.value
        existing_registration.paid_entry_fee = paid_entry_fee
        existing_registration.paid_security_deposit = paid_security_deposit
        existing_registration.starting_stack = starting_stack
        existing_registration.seed = None
        existing_registration.confirmed_at = None
    else:
        db.add(
            TournamentRegistration(
                table_id=table.id,
                user_id=user_id,
                status=TournamentRegistrationStatus.REGISTERED.value,
                paid_entry_fee=paid_entry_fee,
                paid_security_deposit=paid_security_deposit,
                starting_stack=starting_stack,
                seed=None,
                confirmed_at=None,
            )
        )

    db.commit()
    return {
        "success": True,
        "message": "Registered for tournament successfully",
        "table_id": table.id,
        "paid_entry_fee": paid_entry_fee,
        "paid_security_deposit": paid_security_deposit,
        "total_paid": total_required,
        "starting_stack": starting_stack,
    }


@app.post("/api/tables/{table_id}/tournament/confirm")
def confirm_tournament_entry(
    table_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user.get("user_id")
    partition = _get_partition_context_for_user_id(db, user_id)
    table = _get_visible_table_or_404(db, table_id, partition)
    if table.game_type != GameType.TOURNAMENT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Table is not a tournament")

    _maybe_start_tournament_table(db, table)
    db.refresh(table)
    if table.tournament_state != "awaiting_confirmations":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tournament is not waiting for confirmations")

    if table.tournament_confirmation_deadline is not None:
        now_for_deadline = (
            datetime.now(table.tournament_confirmation_deadline.tzinfo)
            if table.tournament_confirmation_deadline.tzinfo
            else datetime.utcnow()
        )
        if now_for_deadline > table.tournament_confirmation_deadline:
            _maybe_start_tournament_table(db, table)
            db.refresh(table)
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Confirmation window has closed")

    registration = db.query(TournamentRegistration).filter(
        TournamentRegistration.table_id == table.id,
        TournamentRegistration.user_id == user_id,
        TournamentRegistration.status.in_([
            TournamentRegistrationStatus.REGISTERED.value,
            TournamentRegistrationStatus.CONFIRMED.value,
        ]),
    ).first()
    if not registration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="You are not registered for this tournament")

    registration.status = TournamentRegistrationStatus.CONFIRMED.value
    registration.confirmed_at = datetime.utcnow()
    db.commit()

    pending_count = db.query(TournamentRegistration).filter(
        TournamentRegistration.table_id == table.id,
        TournamentRegistration.status == TournamentRegistrationStatus.REGISTERED.value,
    ).count()
    if pending_count == 0:
        table = db.query(Table).filter(Table.id == table_id).first()
        if table:
            table.tournament_confirmation_deadline = datetime.utcnow()
            db.commit()
            _maybe_start_tournament_table(db, table)
            db.refresh(table)

    refreshed_table = db.query(Table).filter(Table.id == table_id).first()
    return {
        "success": True,
        "message": "Tournament entry confirmed",
        "state": refreshed_table.tournament_state if refreshed_table else table.tournament_state,
    }


@app.delete("/api/tables/{table_id}/tournament/register")
def unregister_from_tournament(
    table_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user.get("user_id")
    partition = _get_partition_context_for_user_id(db, user_id)
    table = _get_visible_table_or_404(db, table_id, partition)
    if table.game_type != GameType.TOURNAMENT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Table is not a tournament")

    _maybe_start_tournament_table(db, table)
    db.refresh(table)
    if table.tournament_state in {"awaiting_confirmations", "running", "completed"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot unregister after tournament has started")

    registration = db.query(TournamentRegistration).filter(
        TournamentRegistration.table_id == table.id,
        TournamentRegistration.user_id == user_id,
        TournamentRegistration.status.in_([
            TournamentRegistrationStatus.REGISTERED.value,
            TournamentRegistrationStatus.CONFIRMED.value,
        ]),
    ).first()
    if not registration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="You are not registered for this tournament")

    refund_amount = max(0, int(registration.paid_entry_fee or 0)) + max(0, int(registration.paid_security_deposit or 0))
    if refund_amount > 0:
        wallet = db.query(Wallet).filter(
            Wallet.user_id == user_id,
            Wallet.community_id == table.community_id,
        ).first()
        if wallet:
            wallet.balance += refund_amount

    registration.status = TournamentRegistrationStatus.WITHDRAWN.value
    registration.confirmed_at = None
    db.commit()
    return {"success": True, "message": "Tournament registration canceled"}


@app.patch("/api/tables/{table_id}/tournament/payout")
def update_tournament_payout(
    table_id: int,
    payload: TournamentPayoutUpdateRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user.get("user_id")
    partition = _get_partition_context_for_user_id(db, user_id)
    table = _get_visible_table_or_404(db, table_id, partition)
    if table.game_type != GameType.TOURNAMENT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Table is not a tournament")

    community = _get_visible_community_or_404(db, table.community_id, partition)
    if table.tournament_state in {"running", "completed"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot update payout after tournament has started")
    if not _can_manage_tournament_settings(db, table, user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the tournament creator, community commissioner, or global admin can update payout",
        )
    if not payload.is_percentage and not _can_set_tournament_payout(db, community, user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the community commissioner or global admin can set fixed tournament payouts",
        )

    payout = _normalize_tournament_payout(payload.payout, is_percentage=payload.is_percentage)
    if not payout and payload.is_percentage:
        payout = TOURNAMENT_DEFAULT_PAYOUT_PERCENTAGES[:]

    table.tournament_payout = payout if payout else None
    table.tournament_payout_is_percentage = bool(payload.is_percentage)
    table.tournament_prize_pool = sum(payout) if (payout and not payload.is_percentage) else 0
    db.commit()
    db.refresh(table)
    return {
        "success": True,
        "message": "Tournament payout updated",
        "payout": payout,
        "payout_is_percentage": bool(payload.is_percentage),
        "prize_pool": table.tournament_prize_pool,
    }


@app.delete("/api/tables/{table_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_table(
    table_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Delete a table (community owner or global admin)
    Requires authentication and permission checks.
    """
    user_id = current_user.get("user_id")
    partition = _get_partition_context_for_user_id(db, user_id)
    
    # Get table
    table = _get_visible_table_or_404(db, table_id, partition)
    
    # Get the community to check ownership
    community = _get_visible_community_or_404(db, table.community_id, partition)

    if not (_is_global_admin(db, user_id) or community.commissioner_id == user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the community owner or a global admin can delete tables"
        )
    
    # Check if table has any seated players
    from .models import TableSeat
    seated_players = db.query(TableSeat).filter(
        TableSeat.table_id == table_id,
        TableSeat.user_id.isnot(None)
    ).all()
    
    if seated_players:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot delete table with {len(seated_players)} seated players. Wait for all players to leave."
        )
    
    # Preserve historical hands for analysis after table deletion.
    detached_history_count = _detach_hand_history_from_table(db, table_id)

    # Delete the table (seats/queue will be cascade deleted)
    db.delete(table)
    db.commit()
    
    logger.info(
        f"Table {table_id} ({table.name}) deleted by owner {user_id}; "
        f"detached {detached_history_count} hand_history rows"
    )
    
    return None


@app.get("/api/tables/me/active-seat")
def get_my_active_table_seat(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Return the current user's active seated table (if any).

    This is used by the frontend to auto-rejoin a table after a page reload
    while the disconnect grace period is still active.
    """
    user_id = current_user.get("user_id")
    partition = _get_partition_context_for_user_id(db, user_id)

    seat_records = (
        db.query(TableSeat, Table)
        .join(Table, Table.id == TableSeat.table_id)
        .filter(TableSeat.user_id == user_id)
        .order_by(TableSeat.occupied_at.desc(), TableSeat.id.desc())
        .all()
    )

    if not seat_records:
        return {"active": False}

    stale_seat_found = False

    for seat, table in seat_records:
        try:
            _ensure_partition_access(partition, is_test_only=table.is_test_only, test_run_tag=table.test_run_tag)
        except HTTPException:
            continue
        active_session = db.query(TableSession.id).filter(
            TableSession.user_id == user_id,
            TableSession.table_id == seat.table_id,
            TableSession.left_at.is_(None)
        ).order_by(TableSession.joined_at.desc()).first()

        if active_session:
            if stale_seat_found:
                db.commit()
            return {
                "active": True,
                "table_id": seat.table_id,
                "community_id": table.community_id,
                "seat_number": seat.seat_number,
                "occupied_at": seat.occupied_at.isoformat() if seat.occupied_at else None
            }

        # Self-heal stale seat rows that can trap users in auto-rejoin loops.
        seat.user_id = None
        seat.occupied_at = None
        stale_seat_found = True

    if stale_seat_found:
        db.commit()

    return {"active": False}


@app.post("/api/tables/{table_id}/queue/join", response_model=TableQueuePosition)
def join_table_queue(
    table_id: int,
    request: QueueJoinRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Join the queue for a full table
    Requires authentication
    """
    user_id = current_user.get("user_id")
    user = _get_user_or_404(db, user_id)
    _ensure_not_banned(user)
    partition = _build_partition_context_for_user(user)
    
    # Check if table exists
    table = _get_visible_table_or_404(db, table_id, partition)
    _assert_user_matches_resource_partition(user, table, "Cross-run queueing is not allowed")
    if table.game_type == GameType.TOURNAMENT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Queueing is not available for tournament tables"
        )

    if request.buy_in_amount < table.buy_in:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Minimum buy-in is {table.buy_in} chips"
        )

    locked_table = _lock_table_for_update(db, table_id)
    if not locked_table:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Table not found")

    if locked_table.max_queue_size <= 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Queue is not enabled for this table"
        )

    existing_queue_entry = (
        db.query(TableQueue)
        .filter(
            TableQueue.table_id == table_id,
            TableQueue.user_id == user_id,
        )
        .with_for_update()
        .first()
    )
    if existing_queue_entry:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You are already in the queue for this table"
        )

    seated = (
        db.query(TableSeat)
        .filter(
            TableSeat.table_id == table_id,
            TableSeat.user_id == user_id,
        )
        .with_for_update()
        .first()
    )
    if seated:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You are already seated at this table"
        )

    occupied_seat_count = _occupied_seat_count(db, table_id)
    if occupied_seat_count < locked_table.max_seats:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Table is no longer full; join a seat instead."
        )

    current_queue_size = int(
        db.query(func.count(TableQueue.id))
        .filter(TableQueue.table_id == table_id)
        .scalar()
        or 0
    )
    if current_queue_size >= locked_table.max_queue_size:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Queue is full (max {locked_table.max_queue_size} players)"
        )

    wallet = _lock_wallet_for_update(db, user_id, locked_table.community_id)
    if not wallet:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You don't have a wallet in this community. Join the community first."
        )

    requested_buy_in = Decimal(request.buy_in_amount)
    if wallet.balance < requested_buy_in:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient funds. Available: {wallet.balance}, Required: {request.buy_in_amount}"
        )

    wallet.balance -= requested_buy_in
    queue_entry = TableQueue(
        table_id=table_id,
        user_id=user_id,
        position=current_queue_size + 1,
        reserved_buy_in_amount=request.buy_in_amount,
    )
    db.add(queue_entry)
    db.commit()
    db.refresh(queue_entry)

    logger.info(
        "User %s joined queue for table %s at position %s with reserved buy-in %s",
        user_id,
        table_id,
        queue_entry.position,
        request.buy_in_amount,
    )

    return TableQueuePosition(
        table_id=table_id,
        user_id=user_id,
        username=user.username,
        position=queue_entry.position,
        joined_at=queue_entry.joined_at,
    )


@app.delete("/api/tables/{table_id}/queue/leave", status_code=status.HTTP_204_NO_CONTENT)
def leave_table_queue(
    table_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Leave the queue for a table
    Requires authentication
    """
    user_id = current_user.get("user_id")
    partition = _get_partition_context_for_user_id(db, user_id)
    visible_table = _get_visible_table_or_404(db, table_id, partition)
    if visible_table.game_type == GameType.TOURNAMENT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Queueing is not available for tournament tables"
        )

    table = _lock_table_for_update(db, table_id)
    if not table:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Table not found")

    queue_entry = (
        db.query(TableQueue)
        .filter(
            TableQueue.table_id == table_id,
            TableQueue.user_id == user_id,
        )
        .with_for_update()
        .first()
    )
    if not queue_entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You are not in the queue for this table"
        )

    wallet = _lock_wallet_for_update(db, user_id, table.community_id)
    if not wallet:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wallet not found")

    wallet.balance += Decimal(queue_entry.reserved_buy_in_amount)
    db.delete(queue_entry)
    _compact_table_queue_positions(db, table_id)
    db.commit()

    logger.info(f"User {user_id} left queue for table {table_id}")
    
    return None


@app.get("/api/tables/{table_id}/queue", response_model=list[TableQueuePosition])
def get_table_queue(
    table_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get the current queue for a table
    Requires authentication
    """
    partition = _get_partition_context_for_user_id(db, current_user.get("user_id"))
    table = _get_visible_table_or_404(db, table_id, partition)
    if table.game_type == GameType.TOURNAMENT:
        return []
    
    # Get queue entries with user info
    queue_entries = db.query(TableQueue).filter(
        TableQueue.table_id == table_id
    ).order_by(TableQueue.position).all()
    
    result = []
    for entry in queue_entries:
        user = db.query(User).filter(User.id == entry.user_id).first()
        result.append(TableQueuePosition(
            id=entry.id,
            table_id=table_id,
            user_id=entry.user_id,
            username=user.username if user else "Unknown",
            position=entry.position,
            joined_at=entry.joined_at
        ))
    
    return result


@app.get("/api/tables/{table_id}/seats", response_model=list[TableSeatResponse])
def get_table_seats(
    table_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get all seats for a table showing which are occupied
    Requires authentication
    """
    partition = _get_partition_context_for_user_id(db, current_user.get("user_id"))
    table = _get_visible_table_or_404(db, table_id, partition)

    _maybe_start_tournament_table(db, table)
    
    # Get all seats with user information
    from .models import TableSeat
    seats = db.query(TableSeat).filter(TableSeat.table_id == table_id).order_by(TableSeat.seat_number).all()
    
    # Populate username for occupied seats
    result = []
    for seat in seats:
        seat_data = TableSeatResponse(
            id=seat.id,
            seat_number=seat.seat_number,
            user_id=seat.user_id,
            occupied_at=seat.occupied_at,
            username=None
        )
        
        # If occupied, get username
        if seat.user_id:
            user = db.query(User).filter(User.id == seat.user_id).first()
            if user:
                seat_data.username = user.username
        
        result.append(seat_data)
    
    return result


@app.post("/api/tables/{table_id}/join")
async def join_table(
    table_id: int,
    request: TableJoinRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Join a table (the critical buy-in transaction)
    
    This orchestrates:
    1. Auth verification
    2. Wallet debit
    3. Seat player in game server
    4. Return success
    """
    user_id = current_user.get("user_id")
    username = current_user.get("username")
    user = _get_user_or_404(db, user_id)
    _ensure_not_banned(user)
    partition = _build_partition_context_for_user(user)
    new_session: TableSession | None = None
    wallet: Wallet | None = None
    tournament_registration: TournamentRegistration | None = None
    join_stack_amount = int(request.buy_in_amount)
    should_debit_wallet = True
    
    # Step 2: Get table and verify it exists
    table = _get_visible_table_or_404(db, table_id, partition)
    _assert_user_matches_resource_partition(user, table, "Cross-run table joins are not allowed")

    if table.game_type == GameType.TOURNAMENT:
        _maybe_start_tournament_table(db, table)
        db.refresh(table)
        tournament_registration = db.query(TournamentRegistration).filter(
            TournamentRegistration.table_id == table_id,
            TournamentRegistration.user_id == user_id,
            TournamentRegistration.status.in_([
                TournamentRegistrationStatus.CONFIRMED.value,
                TournamentRegistrationStatus.REGISTERED.value,  # Backward compatibility for already-running legacy tournaments.
            ]),
        ).first()
        if not tournament_registration:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You must register for this tournament before joining a seat",
            )
        if table.tournament_state != "running":
            state = table.tournament_state or "scheduled"
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Tournament is not running yet (current state: {state}).",
            )
        join_stack_amount = max(100, int(tournament_registration.starting_stack or table.tournament_starting_stack or 1000))
        should_debit_wallet = False
    else:
        if request.buy_in_amount < table.buy_in:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Buy-in amount must be at least {table.buy_in}"
            )
        join_stack_amount = int(request.buy_in_amount)
    
    # Step 2b: Verify seat number is valid
    from .models import TableSeat
    if request.seat_number < 1 or request.seat_number > table.max_seats:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Seat number must be between 1 and {table.max_seats}"
        )

    # Check if user is already seated at this table
    existing_seat = db.query(TableSeat).filter(
        TableSeat.table_id == table_id,
        TableSeat.user_id == user_id
    ).first()

    if existing_seat:
        if existing_seat.seat_number != request.seat_number:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"You are already seated at this table in seat {existing_seat.seat_number}. Rejoin that seat or leave first."
            )

        wallet = db.query(Wallet).filter(
            Wallet.user_id == user_id,
            Wallet.community_id == table.community_id
        ).first()

        if table.game_type != GameType.TOURNAMENT and not wallet:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="You don't have a wallet in this community. Join the community first."
            )

        # Idempotent rejoin: ensure game server has this seat mapping (important after game-server restarts).
        try:
            seat_request = SeatPlayerRequest(
                table_id=table_id,
                user_id=user_id,
                username=username,
                stack=join_stack_amount,
                seat_number=request.seat_number,
                community_id=table.community_id,
                table_name=table.name,
                is_test_only=table.is_test_only,
                test_run_tag=table.test_run_tag,
            )

            response = await post_game_server_json(
                "/_internal/seat-player",
                seat_request.model_dump(),
                timeout=10.0
            )

            if response.status_code != 200:
                response_text = response.text or ""
                try:
                    response_json = response.json()
                    if isinstance(response_json, dict) and response_json.get("error"):
                        response_text = str(response_json.get("error"))
                except Exception:
                    pass

                # The player may already exist in game state, which is fine for rejoin.
                if not (response.status_code == 400 and "already seated" in response_text.lower()):
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail=f"Failed to rejoin table: {response_text}"
                    )
        except httpx.RequestError as e:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Game server unavailable: {str(e)}"
            )

        logger.info(f"User {user_id} rejoined table {table_id} at existing seat {existing_seat.seat_number}")

        active_session = db.query(TableSession).filter(
            TableSession.user_id == user_id,
            TableSession.table_id == table_id,
            TableSession.left_at.is_(None)
        ).order_by(TableSession.joined_at.desc()).first()
        if not active_session:
            active_session = TableSession(
                user_id=user_id,
                table_id=table_id,
                community_id=table.community_id,
                table_name=table.name,
                buy_in_amount=join_stack_amount,
                is_test_only=table.is_test_only,
                test_run_tag=table.test_run_tag,
            )
            db.add(active_session)
            db.commit()
            db.refresh(active_session)

        return {
            "success": True,
            "message": f"Rejoined table at seat {existing_seat.seat_number}",
            "new_balance": float(wallet.balance) if wallet else 0.0,
            "table_id": table_id,
            "session_id": active_session.id if active_session else None
        }

    seat = db.query(TableSeat).filter(
        TableSeat.table_id == table_id,
        TableSeat.seat_number == request.seat_number
    ).first()

    if not seat:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Seat {request.seat_number} not found"
        )

    if seat.user_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Seat {request.seat_number} is already occupied"
        )

    # Step 4: Find user's wallet for this community (required for cash game buy-ins)
    wallet = db.query(Wallet).filter(
        Wallet.user_id == user_id,
        Wallet.community_id == table.community_id
    ).first()

    if should_debit_wallet:
        if not wallet:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="You don't have a wallet in this community. Join the community first."
            )
        
        # Step 5: Check sufficient funds
        if wallet.balance < join_stack_amount:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Insufficient funds. Available: {wallet.balance}, Required: {join_stack_amount}"
            )
        
        # Step 6: Debit wallet (critical transaction)
        wallet.balance -= join_stack_amount
    
    # Step 6b: Mark seat as occupied
    from sqlalchemy.sql import func
    seat.user_id = user_id
    seat.occupied_at = func.now()

    # Close stale active sessions (if any) for this user/table before opening a new one.
    stale_sessions = db.query(TableSession).filter(
        TableSession.user_id == user_id,
        TableSession.table_id == table_id,
        TableSession.left_at.is_(None)
    ).all()
    for stale_session in stale_sessions:
        stale_session.left_at = func.now()

    new_session = TableSession(
        user_id=user_id,
        table_id=table_id,
        community_id=table.community_id,
        table_name=table.name,
        buy_in_amount=join_stack_amount,
        is_test_only=table.is_test_only,
        test_run_tag=table.test_run_tag,
    )
    db.add(new_session)
    
    db.commit()
    if wallet:
        db.refresh(wallet)
    db.refresh(new_session)
    
    if should_debit_wallet and wallet:
        logger.info(f"Debited {join_stack_amount} from user {user_id}'s wallet. New balance: {wallet.balance}")
    elif table.game_type == GameType.TOURNAMENT:
        logger.info(f"Tournament seat join for user {user_id} at table {table_id} using starting stack {join_stack_amount}")
    logger.info(f"User {user_id} occupied seat {request.seat_number} at table {table_id}")
    
    # Step 7: Seat player in game server (internal HTTP call)
    try:
        seat_request = SeatPlayerRequest(
            table_id=table_id,
            user_id=user_id,
            username=username,
            stack=join_stack_amount,
            seat_number=request.seat_number,
            community_id=table.community_id,
            table_name=table.name,
            is_test_only=table.is_test_only,
            test_run_tag=table.test_run_tag,
        )
        
        response = await post_game_server_json(
            "/_internal/seat-player",
            seat_request.model_dump(),
            timeout=10.0
        )

        if response.status_code != 200:
            # Rollback: credit wallet back and free seat
            if should_debit_wallet and wallet:
                wallet.balance += join_stack_amount
            seat.user_id = None
            seat.occupied_at = None
            if new_session:
                persisted_session = db.query(TableSession).filter(TableSession.id == new_session.id).first()
                if persisted_session:
                    db.delete(persisted_session)
            db.commit()
            logger.error(f"Failed to seat player. Rolling back wallet debit and seat occupation. Response: {response.text}")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Failed to join table: {response.text}"
            )
    
    except httpx.RequestError as e:
        # Rollback: credit wallet back and free seat
        if should_debit_wallet and wallet:
            wallet.balance += join_stack_amount
        seat.user_id = None
        seat.occupied_at = None
        if new_session:
            persisted_session = db.query(TableSession).filter(TableSession.id == new_session.id).first()
            if persisted_session:
                db.delete(persisted_session)
        db.commit()
        logger.error(f"Game server request failed. Rolling back wallet debit and seat occupation. Error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Game server unavailable: {str(e)}"
        )
    
    # Step 8: Update table status if needed
    if table.status == TableStatus.WAITING:
        # You could add logic here to check if table is full and change status
        pass
    
    return {
        "success": True,
        "message": f"Successfully joined table with {join_stack_amount} chips",
        "new_balance": float(wallet.balance) if wallet else 0.0,
        "table_id": table_id,
        "session_id": new_session.id if new_session else None
    }


# ============================================================================
# Internal API Endpoints (for Game Server)
# ============================================================================

@app.post("/api/internal/auth/verify", response_model=TokenVerifyResponse)
def verify_token_internal(
    request: TokenVerifyRequest,
    db: Session = Depends(get_db)
):
    """
    Internal endpoint: Verify a JWT token and return user info
    
    This endpoint is called by the game server to validate player connections.
    """
    payload = decode_token(request.token)
    
    if not payload:
        return TokenVerifyResponse(
            valid=False,
            message="Invalid or expired token"
        )
    
    user_id = payload.get("user_id")
    username = payload.get("username")
    
    if not user_id or not username:
        return TokenVerifyResponse(
            valid=False,
            message="Token missing required fields"
        )
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return TokenVerifyResponse(valid=False, message="User not found")
    if user.is_banned:
        return TokenVerifyResponse(valid=False, message="User is banned")

    return TokenVerifyResponse(
        valid=True,
        user_id=user_id,
        username=username,
        is_test_user=bool(user.is_test_user),
        test_run_tag=user.test_run_tag,
    )


@app.post("/api/internal/wallets/debit", response_model=WalletOperationResponse)
def debit_wallet(operation: WalletOperation, db: Session = Depends(get_db)):
    """
    Internal endpoint: Deduct amount from a wallet
    
    This endpoint is called by the game server when a player buys into a game.
    Fails if insufficient funds.
    """
    # Find wallet
    wallet = db.query(Wallet).filter(
        Wallet.user_id == operation.user_id,
        Wallet.community_id == operation.community_id
    ).first()
    
    if not wallet:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Wallet not found"
        )
    
    # Check sufficient funds
    if wallet.balance < operation.amount:
        return WalletOperationResponse(
            success=False,
            new_balance=wallet.balance,
            message=f"Insufficient funds. Available: {wallet.balance}, Required: {operation.amount}"
        )
    
    # Debit the wallet
    wallet.balance -= operation.amount
    db.commit()
    db.refresh(wallet)
    
    return WalletOperationResponse(
        success=True,
        new_balance=wallet.balance,
        message=f"Debited {operation.amount} from wallet"
    )


@app.post("/api/internal/wallets/credit", response_model=WalletOperationResponse)
def credit_wallet(operation: WalletOperation, db: Session = Depends(get_db)):
    """
    Internal endpoint: Add amount to a wallet
    
    This endpoint is called by the game server when a player wins chips.
    """
    # Find wallet
    wallet = db.query(Wallet).filter(
        Wallet.user_id == operation.user_id,
        Wallet.community_id == operation.community_id
    ).first()
    
    if not wallet:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Wallet not found"
        )
    
    # Credit the wallet
    wallet.balance += operation.amount
    db.commit()
    db.refresh(wallet)
    
    return WalletOperationResponse(
        success=True,
        new_balance=wallet.balance,
        message=f"Credited {operation.amount} to wallet"
    )


@app.get("/api/internal/wallets/{user_id}/{community_id}", response_model=WalletResponse)
def get_wallet_internal(user_id: int, community_id: int, db: Session = Depends(get_db)):
    """
    Internal endpoint: Get a specific wallet
    
    This endpoint is called by the game server to check player balance.
    """
    wallet = db.query(Wallet).filter(
        Wallet.user_id == user_id,
        Wallet.community_id == community_id
    ).first()
    
    if not wallet:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Wallet not found"
        )
    
    return wallet


@app.get("/api/internal/tables/{table_id}")
def get_table_config(table_id: int, db: Session = Depends(get_db)):
    """
    Internal endpoint: Get table configuration
    
    Returns table details including action_timeout_seconds for game configuration.
    """
    table = db.query(Table).filter(Table.id == table_id).first()
    
    if not table:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Table not found"
        )
    
    return {
        "id": table.id,
        "name": table.name,
        "community_id": table.community_id,
        "max_seats": table.max_seats,
        "small_blind": table.small_blind,
        "big_blind": table.big_blind,
        "buy_in": table.buy_in,
        "is_permanent": table.is_permanent,
        "is_test_only": table.is_test_only,
        "test_run_tag": table.test_run_tag,
        "action_timeout_seconds": table.action_timeout_seconds,
        "max_queue_size": table.max_queue_size
    }


@app.get("/api/internal/tables/{table_id}/active-sessions")
def get_table_active_sessions(table_id: int, db: Session = Depends(get_db)):
    table = db.query(Table).filter(Table.id == table_id).first()
    if not table:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Table not found"
        )

    sessions = (
        db.query(TableSession)
        .filter(
            TableSession.table_id == table_id,
            TableSession.left_at.is_(None),
        )
        .order_by(TableSession.joined_at.asc(), TableSession.id.asc())
        .all()
    )
    return [
        {
            "session_id": session.id,
            "user_id": session.user_id,
            "table_id": session.table_id,
            "community_id": session.community_id,
            "buy_in_amount": session.buy_in_amount,
            "joined_at": session.joined_at.isoformat() if session.joined_at else None,
            "is_test_only": bool(session.is_test_only),
            "test_run_tag": session.test_run_tag,
        }
        for session in sessions
    ]


@app.post("/api/internal/tables/{table_id}/check-cleanup")
def check_table_cleanup(table_id: int, db: Session = Depends(get_db)):
    """
    Internal endpoint: Check if a table should be cleaned up
    
    This endpoint is called by the game server when all players leave a table.
    It checks if the table is permanent. If not, it deletes the table and all related data.
    """
    # Get table
    table = db.query(Table).filter(Table.id == table_id).first()
    
    if not table:
        return {"deleted": False, "message": "Table not found"}
    
    # Check if table is permanent
    if table.is_permanent:
        return {"deleted": False, "message": "Table is permanent"}
    
    # Check if table has any seated players
    from .models import TableSeat
    seated_count = db.query(TableSeat).filter(
        TableSeat.table_id == table_id,
        TableSeat.user_id.isnot(None)
    ).count()
    
    if seated_count > 0:
        return {"deleted": False, "message": f"Table has {seated_count} seated players"}
    
    # Preserve historical hands for analysis after table deletion.
    detached_history_count = _detach_hand_history_from_table(db, table_id)

    # Table is non-permanent and empty, delete it
    db.delete(table)
    db.commit()
    
    logger.info(
        f"Deleted non-permanent table {table_id} ({table.name}); "
        f"detached {detached_history_count} hand_history rows"
    )
    
    return {"deleted": True, "message": f"Table {table_id} deleted"}


@app.post("/api/internal/tables/{table_id}/unseat/{user_id}")
async def unseat_player(table_id: int, user_id: int, db: Session = Depends(get_db)):
    """
    Internal endpoint: Unseat a player from a table
    
    This endpoint is called by the game server when a player leaves.
    It clears the seat and automatically seats the first player in queue (if any).
    """
    table = _lock_table_for_update(db, table_id)
    if not table:
        return {"success": False, "message": "Table not found"}

    seat = (
        db.query(TableSeat)
        .filter(
            TableSeat.table_id == table_id,
            TableSeat.user_id == user_id,
        )
        .with_for_update()
        .first()
    )
    if not seat:
        return {"success": False, "message": "Player not seated at this table"}

    freed_seat_number = seat.seat_number
    seat.user_id = None
    seat.occupied_at = None

    active_session = (
        db.query(TableSession)
        .filter(
            TableSession.user_id == user_id,
            TableSession.table_id == table_id,
            TableSession.left_at.is_(None),
        )
        .order_by(TableSession.joined_at.desc())
        .first()
    )
    if active_session:
        active_session.left_at = func.now()

    logger.info("Unseating user %s from table %s seat %s", user_id, table_id, freed_seat_number)

    auto_seated_payload: dict[str, object] | None = None

    while True:
        first_in_queue = (
            db.query(TableQueue)
            .filter(TableQueue.table_id == table_id)
            .order_by(TableQueue.position.asc(), TableQueue.joined_at.asc(), TableQueue.id.asc())
            .first()
        )
        if not first_in_queue:
            db.commit()
            return {"success": True, "message": f"Player unseated from seat {freed_seat_number}"}

        queued_user = db.query(User).filter(User.id == first_in_queue.user_id).first()
        if not queued_user or queued_user.is_banned:
            refund_amount = int(first_in_queue.reserved_buy_in_amount or table.buy_in)
            queued_wallet = _lock_wallet_for_update(db, first_in_queue.user_id, table.community_id)
            if queued_wallet:
                queued_wallet.balance += Decimal(refund_amount)
            db.delete(first_in_queue)
            _compact_table_queue_positions(db, table_id)
            db.flush()
            continue

        promotion_id = str(uuid.uuid4())
        reserved_buy_in_amount = int(first_in_queue.reserved_buy_in_amount or table.buy_in)
        seat_request = SeatPlayerRequest(
            table_id=table_id,
            user_id=queued_user.id,
            username=queued_user.username,
            stack=reserved_buy_in_amount,
            seat_number=freed_seat_number,
            promotion_id=promotion_id,
            community_id=table.community_id,
            table_name=table.name,
            is_test_only=table.is_test_only,
            test_run_tag=table.test_run_tag,
        )

        runtime_applied = False
        runtime_response_text: str | None = None
        try:
            response = await post_game_server_json(
                "/_internal/seat-player",
                seat_request.model_dump(),
                timeout=2.0,
            )
            runtime_response_text = response.text
            if response.status_code == 200:
                runtime_applied = True
            else:
                logger.error(
                    "Promotion %s rejected by game server for table %s user %s: %s",
                    promotion_id,
                    table_id,
                    queued_user.id,
                    runtime_response_text,
                )
        except httpx.RequestError as exc:
            logger.warning(
                "Promotion %s transport failure for table %s user %s: %s",
                promotion_id,
                table_id,
                queued_user.id,
                exc,
            )
            try:
                confirm_response = await get_game_server_json(
                    f"/_internal/promotions/{promotion_id}",
                    timeout=2.0,
                )
            except httpx.RequestError as confirm_exc:
                logger.error(
                    "Promotion %s confirmation unavailable after transport failure: %s",
                    promotion_id,
                    confirm_exc,
                )
                db.commit()
                return {
                    "success": True,
                    "message": f"Player unseated from seat {freed_seat_number}",
                    "promotion_pending_confirmation": True,
                    "promotion_id": promotion_id,
                }

            try:
                confirmation_payload = confirm_response.json()
            except ValueError:
                confirmation_payload = {}

            confirmation_status = str(confirmation_payload.get("status") or "")
            if confirm_response.status_code == 200 and confirmation_status == "applied":
                runtime_applied = True
            elif confirmation_status == "not_found" and confirm_response.status_code in {200, 404}:
                runtime_applied = False
            elif confirm_response.status_code == 200:
                db.commit()
                return {
                    "success": True,
                    "message": f"Player unseated from seat {freed_seat_number}",
                    "promotion_pending_confirmation": True,
                    "promotion_id": promotion_id,
                }
            else:
                db.commit()
                return {
                    "success": True,
                    "message": f"Player unseated from seat {freed_seat_number}",
                    "promotion_pending_confirmation": True,
                    "promotion_id": promotion_id,
                }

        if runtime_applied:
            seat.user_id = queued_user.id
            seat.occupied_at = func.now()

            stale_sessions = (
                db.query(TableSession)
                .filter(
                    TableSession.user_id == queued_user.id,
                    TableSession.table_id == table_id,
                    TableSession.left_at.is_(None),
                )
                .all()
            )
            for stale_session in stale_sessions:
                stale_session.left_at = func.now()

            promoted_session = TableSession(
                user_id=queued_user.id,
                table_id=table_id,
                community_id=table.community_id,
                table_name=table.name,
                buy_in_amount=reserved_buy_in_amount,
                is_test_only=table.is_test_only,
                test_run_tag=table.test_run_tag,
            )
            db.add(promoted_session)
            db.delete(first_in_queue)
            _compact_table_queue_positions(db, table_id)

            try:
                db.commit()
            except Exception as commit_exc:
                db.rollback()
                logger.error(
                    "Promotion %s runtime applied but DB commit failed for table %s user %s: %s",
                    promotion_id,
                    table_id,
                    queued_user.id,
                    commit_exc,
                )
                try:
                    await rollback_game_server_promotion(promotion_id, timeout=3.0)
                except Exception as rollback_exc:
                    logger.error("Promotion %s rollback failed: %s", promotion_id, rollback_exc)

                recovery_table = _lock_table_for_update(db, table_id)
                recovery_seat = (
                    db.query(TableSeat)
                    .filter(
                        TableSeat.table_id == table_id,
                        TableSeat.seat_number == freed_seat_number,
                    )
                    .with_for_update()
                    .first()
                )
                if recovery_table and recovery_seat and recovery_seat.user_id == user_id:
                    recovery_seat.user_id = None
                    recovery_seat.occupied_at = None
                recovery_session = (
                    db.query(TableSession)
                    .filter(
                        TableSession.user_id == user_id,
                        TableSession.table_id == table_id,
                        TableSession.left_at.is_(None),
                    )
                    .order_by(TableSession.joined_at.desc())
                    .first()
                )
                if recovery_session:
                    recovery_session.left_at = func.now()
                db.commit()

                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Promotion runtime applied but database commit failed",
                ) from commit_exc

            auto_seated_payload = {
                "user_id": queued_user.id,
                "username": queued_user.username,
                "seat_number": freed_seat_number,
                "buy_in": reserved_buy_in_amount,
                "promotion_id": promotion_id,
            }
            logger.info(
                "Auto-seated user %s (%s) from queue to seat %s with reserved buy-in %s",
                queued_user.id,
                queued_user.username,
                freed_seat_number,
                reserved_buy_in_amount,
            )
            return {
                "success": True,
                "message": f"Player unseated from seat {freed_seat_number}",
                "auto_seated": auto_seated_payload,
            }

        queued_wallet = _lock_wallet_for_update(db, queued_user.id, table.community_id)
        if queued_wallet:
            queued_wallet.balance += Decimal(reserved_buy_in_amount)
        db.delete(first_in_queue)
        _compact_table_queue_positions(db, table_id)
        db.commit()
        logger.warning(
            "Promotion failed definitively for table %s user %s; queue row removed and funds refunded",
            table_id,
            queued_user.id,
        )
        return {
            "success": True,
            "message": f"Player unseated from seat {freed_seat_number}",
            "promotion_failed": True,
            "promotion_id": promotion_id,
            "runtime_error": runtime_response_text,
        }


@app.post("/api/tables/{table_id}/leave")
async def leave_table(
    table_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Leave a table and clear active seat/session state.

    This is a client-facing, idempotent safety path used alongside websocket leave_game.
    """
    user_id = current_user.get("user_id")
    partition = _get_partition_context_for_user_id(db, user_id)
    _get_visible_table_or_404(db, table_id, partition)

    # Best-effort unseat (also handles queue promotion).
    result = await unseat_player(table_id, user_id, db)

    # Always close stale active sessions for this user/table.
    from sqlalchemy.sql import func
    db.query(TableSession).filter(
        TableSession.user_id == user_id,
        TableSession.table_id == table_id,
        TableSession.left_at.is_(None)
    ).update({"left_at": func.now()})
    db.commit()

    if isinstance(result, dict):
        return {
            "success": True,
            "message": result.get("message", "Left table"),
            "unseat_result": result
        }

    return {"success": True, "message": "Left table"}


# ============================================================================
# Hand History Endpoints
# ============================================================================

@app.post("/_internal/history/record", status_code=status.HTTP_201_CREATED)
def record_hand_history(
    history: HandHistoryCreate,
    db: Session = Depends(get_db)
):
    """
    Internal endpoint: Record a completed hand
    
    This endpoint is called by the game server after each hand completes.
    It stores the full hand data in JSONB format for later retrieval.
    """
    try:
        table = None
        if history.table_id is not None:
            table = db.query(Table).filter(Table.id == history.table_id).first()
            if not table:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Table not found for hand history record"
                )
            if table.community_id != history.community_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Hand history community does not match table community"
                )

        is_test_only = table.is_test_only if table else bool(history.is_test_only)
        test_run_tag = table.test_run_tag if table else history.test_run_tag

        # Create hand history record
        hand_record = HandHistory(
            community_id=history.community_id,
            table_id=history.table_id,
            table_name=history.table_name,
            hand_data=history.hand_data,
            is_test_only=is_test_only,
            test_run_tag=test_run_tag,
        )
        
        db.add(hand_record)
        db.flush()
        recorded_at = hand_record.played_at or datetime.utcnow()

        # Link this hand to each participant's active table session.
        player_rows = history.hand_data.get("players", []) if isinstance(history.hand_data, dict) else []
        participant_user_ids: set[int] = set()
        for player_row in player_rows:
            try:
                participant_user_ids.add(int(player_row.get("user_id")))
            except (TypeError, ValueError):
                continue

        linked_sessions = 0
        for participant_user_id in participant_user_ids:
            # Prefer a session that spans the hand timestamp.
            session = db.query(TableSession).filter(
                TableSession.user_id == participant_user_id,
                TableSession.table_id == history.table_id,
                TableSession.community_id == history.community_id,
                TableSession.joined_at <= recorded_at,
                or_(
                    TableSession.left_at.is_(None),
                    TableSession.left_at >= recorded_at,
                )
            ).order_by(TableSession.joined_at.desc()).first()

            # Fallback for race conditions where leave is processed right as hand is recorded.
            if not session:
                session = db.query(TableSession).filter(
                    TableSession.user_id == participant_user_id,
                    TableSession.table_id == history.table_id,
                    TableSession.community_id == history.community_id,
                    TableSession.joined_at <= recorded_at,
                ).order_by(TableSession.joined_at.desc()).first()

            if not session:
                continue

            if session.is_test_only != is_test_only or session.test_run_tag != test_run_tag:
                continue

            exists = db.query(SessionHand).filter(
                SessionHand.session_id == session.id,
                SessionHand.hand_id == hand_record.id
            ).first()
            if exists:
                continue

            db.add(SessionHand(session_id=session.id, hand_id=hand_record.id))
            linked_sessions += 1

        db.commit()
        db.refresh(hand_record)
        
        return {
            "success": True,
            "hand_id": str(hand_record.id),
            "linked_sessions": linked_sessions,
            "message": "Hand history recorded"
        }
    except Exception as e:
        db.rollback()
        print(f"❌ Error recording hand history: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to record hand history: {str(e)}"
        )


@app.get("/api/me/hands", response_model=list[HandHistorySummary])
def get_my_hand_history(
    limit: int = 20,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get hand history for the current user
    
    Returns a paginated list of hands where the user was a participant.
    Only returns summary information - use /api/hands/{hand_id} for full details.
    """
    user_id = current_user["user_id"]
    partition = _get_partition_context_for_user_id(db, user_id)
    
    # Query hands where user_id appears in the hand_data.players array
    # PostgreSQL JSONB query: hand_data @> '{"players": [{"user_id": X}]}'
    # But we need to search more flexibly, so we use jsonb_array_elements
    
    if partition.kind == "normal":
        query = text("""
        SELECT h.id, h.table_name, h.played_at, h.hand_data
        FROM hand_history h
        WHERE h.is_test_only = FALSE
        AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(h.hand_data->'players') AS player
            WHERE (player->>'user_id')::int = :user_id
        )
        ORDER BY h.played_at DESC
        LIMIT :limit OFFSET :offset
    """)
        params = {"user_id": user_id, "limit": limit, "offset": offset}
    else:
        query = text("""
        SELECT h.id, h.table_name, h.played_at, h.hand_data
        FROM hand_history h
        WHERE h.is_test_only = TRUE
        AND h.test_run_tag = :test_run_tag
        AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(h.hand_data->'players') AS player
            WHERE (player->>'user_id')::int = :user_id
        )
        ORDER BY h.played_at DESC
        LIMIT :limit OFFSET :offset
    """)
        params = {"user_id": user_id, "limit": limit, "offset": offset, "test_run_tag": partition.run_tag}

    results = db.execute(query, params)
    
    # Transform results into summary format
    summaries = []
    for row in results:
        hand_data = row.hand_data
        
        # Extract summary information
        pot_size = hand_data.get("pot", 0)
        players = hand_data.get("players", [])
        winner = hand_data.get("winner", {})
        
        summaries.append(HandHistorySummary(
            id=str(row.id),
            table_name=row.table_name,
            played_at=row.played_at,
            pot_size=pot_size,
            winner_username=winner.get("username") if winner else None,
            player_count=len(players)
        ))
    
    return summaries


@app.get("/api/hands/{hand_id}", response_model=HandHistoryResponse)
def get_hand_details(
    hand_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get full details of a specific hand
    
    Only returns the hand if the current user was a participant.
    This prevents users from viewing hands they weren't involved in.
    """
    user_id = current_user["user_id"]
    partition = _get_partition_context_for_user_id(db, user_id)

    if partition.kind == "normal":
        query = text("""
        SELECT h.id, h.community_id, h.table_id, h.table_name, h.played_at, h.hand_data
        FROM hand_history h
        WHERE h.id = :hand_id
        AND h.is_test_only = FALSE
        AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(h.hand_data->'players') AS player
            WHERE (player->>'user_id')::int = :user_id
        )
    """)
        params = {"hand_id": hand_id, "user_id": user_id}
    else:
        query = text("""
        SELECT h.id, h.community_id, h.table_id, h.table_name, h.played_at, h.hand_data
        FROM hand_history h
        WHERE h.id = :hand_id
        AND h.is_test_only = TRUE
        AND h.test_run_tag = :test_run_tag
        AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(h.hand_data->'players') AS player
            WHERE (player->>'user_id')::int = :user_id
        )
    """)
        params = {"hand_id": hand_id, "user_id": user_id, "test_run_tag": partition.run_tag}

    result = db.execute(query, params).first()
    
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Hand not found or you were not a participant"
        )
    
    return HandHistoryResponse(
        id=str(result.id),
        community_id=result.community_id,
        table_id=result.table_id,
        table_name=result.table_name,
        played_at=result.played_at,
        hand_data=result.hand_data
    )


# ============================================================================
# Learning Endpoints
# ============================================================================

RANK_VALUE_MAP = {
    "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
    "10": 10, "T": 10, "J": 11, "Q": 12, "K": 13, "A": 14,
}


def _parse_card(card: dict[str, str]) -> tuple[int, str] | None:
    if not isinstance(card, dict):
        return None
    rank_raw = str(card.get("rank", "")).upper()
    suit_raw = str(card.get("suit", "")).lower()
    if rank_raw not in RANK_VALUE_MAP:
        return None
    if suit_raw not in {"hearts", "diamonds", "clubs", "spades"}:
        return None
    return RANK_VALUE_MAP[rank_raw], suit_raw


def _clamp_score(value: float) -> float:
    return max(0.0, min(1.0, value))


def _preflop_strength(hole_cards: list[dict[str, str]]) -> tuple[float, list[str]]:
    parsed = [_parse_card(card) for card in hole_cards]
    cards = [card for card in parsed if card is not None]
    if len(cards) != 2:
        return 0.2, ["invalid-cards"]

    (r1, s1), (r2, s2) = cards
    high = max(r1, r2)
    low = min(r1, r2)
    pair = r1 == r2
    suited = s1 == s2
    gap = abs(r1 - r2)
    tags: list[str] = []

    score = 0.35 + (high - 8) * 0.03
    if pair:
        tags.append("pocket-pair")
        if high >= 13:
            score += 0.45
        elif high >= 11:
            score += 0.34
        elif high >= 8:
            score += 0.24
        else:
            score += 0.15

    if suited:
        tags.append("suited")
        score += 0.06

    if high >= 11 and low >= 10:
        tags.append("broadway")
        score += 0.12

    if gap == 1:
        tags.append("connector")
        score += 0.08
    elif gap == 2:
        tags.append("one-gap")
        score += 0.03
    elif gap >= 5:
        tags.append("disconnected")
        score -= 0.07

    if high == 14 and low <= 9:
        tags.append("weak-ace-kicker")
        score -= 0.06

    return _clamp_score(score), tags


def _postflop_strength(
    hole_cards: list[dict[str, str]],
    community_cards: list[dict[str, str]]
) -> tuple[float, list[str]]:
    parsed = [_parse_card(card) for card in [*hole_cards, *community_cards]]
    cards = [card for card in parsed if card is not None]
    if len(cards) < 5:
        return 0.25, ["insufficient-postflop-cards"]

    rank_values = [rank for rank, _ in cards]
    suits = [suit for _, suit in cards]
    rank_counts = Counter(rank_values)
    suit_counts = Counter(suits)
    tags: list[str] = []
    score = 0.35

    has_flush = any(count >= 5 for count in suit_counts.values())
    has_flush_draw = any(count == 4 for count in suit_counts.values())

    unique_ranks = sorted(set(rank_values))
    if 14 in unique_ranks:
        unique_ranks = [1] + unique_ranks

    max_straight_run = 1
    run = 1
    for index in range(1, len(unique_ranks)):
        if unique_ranks[index] == unique_ranks[index - 1] + 1:
            run += 1
            max_straight_run = max(max_straight_run, run)
        else:
            run = 1

    has_straight = max_straight_run >= 5
    has_open_ended_draw = max_straight_run == 4

    count_values = sorted(rank_counts.values(), reverse=True)
    has_quads = count_values and count_values[0] == 4
    has_trips = count_values and count_values[0] == 3
    pair_count = sum(1 for value in count_values if value == 2)
    has_full_house = has_trips and (pair_count >= 1 or count_values.count(3) >= 2)
    has_two_pair = pair_count >= 2
    has_pair = pair_count >= 1 or has_trips

    if has_quads:
        tags.append("quads")
        score = max(score, 0.98)
    elif has_full_house:
        tags.append("full-house")
        score = max(score, 0.95)
    elif has_flush and has_straight:
        tags.append("straight-flush")
        score = max(score, 0.99)
    elif has_flush:
        tags.append("flush")
        score = max(score, 0.9)
    elif has_straight:
        tags.append("straight")
        score = max(score, 0.84)
    elif has_trips:
        tags.append("trips")
        score = max(score, 0.76)
    elif has_two_pair:
        tags.append("two-pair")
        score = max(score, 0.68)
    elif has_pair:
        tags.append("pair")
        score = max(score, 0.56)
    else:
        tags.append("high-card")
        score = max(score, 0.36)

    if has_flush_draw:
        tags.append("flush-draw")
        score += 0.08
    if has_open_ended_draw:
        tags.append("straight-draw")
        score += 0.06

    return _clamp_score(score), tags


def _build_learning_recommendation(payload: LearningCoachRequest) -> LearningCoachResponse:
    street = payload.street.lower()
    if street == "preflop":
        strength, tags = _preflop_strength(payload.hole_cards)
    else:
        strength, tags = _postflop_strength(payload.hole_cards, payload.community_cards)

    pot = max(0, int(payload.pot))
    to_call = max(0, int(payload.to_call))
    min_raise = max(1, int(payload.min_raise))
    stack = max(0, int(payload.stack))
    can_check = payload.can_check or to_call == 0
    pressure_ratio = to_call / max(1, pot + to_call)

    top_actions: list[LearningActionRecommendation] = []

    def add_action(action: str, score: float, rationale: str, amount: int | None = None) -> None:
        top_actions.append(
            LearningActionRecommendation(
                action=action,
                amount=amount,
                score=round(_clamp_score(score), 3),
                rationale=rationale,
            )
        )

    bet_half_pot = max(min_raise, int(math.ceil(max(1, pot) * 0.5)))
    bet_three_quarter = max(min_raise, int(math.ceil(max(1, pot) * 0.75)))
    raise_standard = max(min_raise, int(math.ceil(max(to_call * 2, pot * 0.75))))

    if can_check:
        if strength >= 0.88:
            add_action("bet", 0.93, "Very strong hand; build the pot.", bet_three_quarter)
            add_action("bet", 0.86, "Pressure weaker ranges with value.", bet_half_pot)
            add_action("check", 0.35, "Slow-play line, lower EV in most spots.")
        elif strength >= 0.67:
            add_action("bet", 0.82, "Likely ahead; extract value and deny equity.", bet_half_pot)
            add_action("check", 0.64, "Pot-control line is acceptable.")
            add_action("bet", 0.58, "Larger sizing for protection.", bet_three_quarter)
        elif strength >= 0.5:
            add_action("check", 0.74, "Medium strength; avoid overbuilding the pot.")
            add_action("bet", 0.62, "Small value/protection bet.", bet_half_pot)
            add_action("bet", 0.44, "Larger bluff/semi-bluff line.", bet_three_quarter)
        else:
            add_action("check", 0.88, "Weak hand; preserve chips.")
            add_action("bet", 0.38, "Occasional bluff to keep ranges mixed.", bet_half_pot)
            add_action("bet", 0.22, "Large bluff is high variance here.", bet_three_quarter)
    else:
        if strength >= 0.9:
            add_action("raise", 0.95, "Premium strength; maximize value.", min(raise_standard, stack))
            add_action("call", 0.76, "Call keeps weaker hands in.")
            add_action("fold", 0.05, "Folding this strength is a major leak.")
        elif strength >= 0.72:
            if pressure_ratio <= 0.38 and stack > to_call:
                add_action("raise", 0.8, "Strong enough to raise for value/protection.", min(raise_standard, stack))
            add_action("call", 0.77, "Profitable continue versus this price.")
            add_action("fold", 0.2, "Fold if villain is very tight and line is underbluffed.")
        elif strength >= 0.55:
            add_action("call", 0.66 if pressure_ratio <= 0.25 else 0.48, "Continue mainly when pot odds are favorable.")
            add_action("fold", 0.58 if pressure_ratio > 0.25 else 0.38, "Fold more often versus larger pressure.")
            add_action("raise", 0.31, "Occasional bluff/semi-bluff candidate.")
        elif strength >= 0.42:
            add_action("fold", 0.74, "Mostly behind without enough equity.")
            add_action("call", 0.43 if pressure_ratio <= 0.16 else 0.2, "Call only at strong price.")
            add_action("raise", 0.15, "Bluff line should be rare.")
        else:
            add_action("fold", 0.92, "Low equity versus aggression.")
            add_action("call", 0.18 if pressure_ratio <= 0.1 else 0.05, "Only continue with very cheap price.")
            add_action("raise", 0.03, "High-risk, low-reward bluff.")

    top_actions = sorted(top_actions, key=lambda item: item.score, reverse=True)[:3]
    best = top_actions[0]
    summary = f"Recommended: {best.action.upper()}" + (f" {best.amount}" if best.amount is not None else "")

    base_tags = list(dict.fromkeys([*tags, f"strength:{round(strength, 2)}", f"pressure:{round(pressure_ratio, 2)}"]))
    return LearningCoachResponse(
        recommended_action=best.action,
        summary=summary,
        tags=base_tags[:8],
        top_actions=top_actions,
    )


@app.get("/api/learning/sessions", response_model=list[LearningSessionSummary])
def get_learning_sessions(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user_id = current_user["user_id"]

    rows = (
        db.query(
            TableSession.id,
            TableSession.table_id,
            TableSession.community_id,
            TableSession.table_name,
            TableSession.buy_in_amount,
            TableSession.joined_at,
            TableSession.left_at,
            func.count(SessionHand.id).label("hand_count"),
            func.max(HandHistory.played_at).label("last_hand_at"),
        )
        .outerjoin(SessionHand, SessionHand.session_id == TableSession.id)
        .outerjoin(HandHistory, HandHistory.id == SessionHand.hand_id)
        .filter(TableSession.user_id == user_id)
        .group_by(
            TableSession.id,
            TableSession.table_id,
            TableSession.community_id,
            TableSession.table_name,
            TableSession.buy_in_amount,
            TableSession.joined_at,
            TableSession.left_at,
        )
        .order_by(TableSession.joined_at.desc())
        .all()
    )

    return [
        LearningSessionSummary(
            id=row.id,
            table_id=row.table_id,
            community_id=row.community_id,
            table_name=row.table_name,
            buy_in_amount=row.buy_in_amount,
            joined_at=row.joined_at,
            left_at=row.left_at,
            hand_count=int(row.hand_count or 0),
            last_hand_at=row.last_hand_at,
        )
        for row in rows
    ]


@app.get("/api/learning/sessions/{session_id}/hands", response_model=list[HandHistorySummary])
def get_learning_session_hands(
    session_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user_id = current_user["user_id"]
    session = db.query(TableSession).filter(
        TableSession.id == session_id,
        TableSession.user_id == user_id
    ).first()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    rows = (
        db.query(HandHistory)
        .join(SessionHand, SessionHand.hand_id == HandHistory.id)
        .filter(SessionHand.session_id == session_id)
        .order_by(HandHistory.played_at.desc())
        .all()
    )

    summaries: list[HandHistorySummary] = []
    for row in rows:
        hand_data = row.hand_data if isinstance(row.hand_data, dict) else {}
        players = hand_data.get("players", []) if isinstance(hand_data.get("players", []), list) else []
        winner = hand_data.get("winner", {}) if isinstance(hand_data.get("winner", {}), dict) else {}
        summaries.append(
            HandHistorySummary(
                id=str(row.id),
                table_name=row.table_name,
                played_at=row.played_at,
                pot_size=int(hand_data.get("pot", 0) or 0),
                winner_username=winner.get("username"),
                player_count=len(players),
            )
        )

    return summaries


@app.post("/api/learning/coach/recommend", response_model=LearningCoachResponse)
def get_learning_coach_recommendation(
    payload: LearningCoachRequest,
    current_user: dict = Depends(get_current_user),
):
    _ = current_user  # authenticated endpoint
    return _build_learning_recommendation(payload)


# ============================================================================
# Join Request Endpoints
# ============================================================================

@app.post("/api/communities/{community_id}/request-join", status_code=status.HTTP_201_CREATED)
def request_to_join_community(
    community_id: int,
    message: str | None = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Request to join a community. The commissioner will review the request.
    
    - **community_id**: ID of the community to join
    - **message**: Optional message to the commissioner (max 250 chars)
    """
    from .models import JoinRequest, InboxMessage
    
    user_id = current_user.get("user_id")
    username = current_user.get("username")
    user = _get_user_or_404(db, user_id)
    _ensure_not_banned(user)
    
    # Verify community exists
    community = db.query(Community).filter(Community.id == community_id).first()
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found"
        )

    if not _is_league_member(db, community.league_id, user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You must be a league member to request to join this community"
        )
    
    # Check if already a member
    existing_wallet = db.query(Wallet).filter(
        Wallet.user_id == user_id,
        Wallet.community_id == community_id
    ).first()
    
    if existing_wallet:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Already a member of this community"
        )
    
    # Check if pending request already exists
    existing_request = db.query(JoinRequest).filter(
        JoinRequest.user_id == user_id,
        JoinRequest.community_id == community_id,
        JoinRequest.status == "pending"
    ).first()
    
    if existing_request:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have a pending request for this community"
        )
    
    # Create join request
    join_request = JoinRequest(
        user_id=user_id,
        community_id=community_id,
        message=message[:250] if message else None,
        status="pending"
    )
    db.add(join_request)
    db.commit()
    db.refresh(join_request)
    
    # Send message to commissioner's inbox
    commissioner_id = community.commissioner_id
    if not commissioner_id:
        # Fall back to league owner
        league = db.query(League).filter(League.id == community.league_id).first()
        commissioner_id = league.owner_id if league else None
    
    if commissioner_id:
        inbox_message = InboxMessage(
            recipient_user_id=commissioner_id,
            sender_user_id=user_id,
            message_type="join_request",
            title=f"Join Request: {username}",
            content=f"{username} has requested to join {community.name}." + (f"\n\nMessage: {message}" if message else ""),
            message_metadata={
                "request_id": join_request.id,
                "community_id": community_id,
                "community_name": community.name,
                "user_id": user_id,
                "username": username
            },
            is_actionable=True
        )
        db.add(inbox_message)
        db.commit()
    
    return {"message": "Join request submitted successfully", "request_id": join_request.id}


@app.get("/api/communities/{community_id}/join-requests")
def get_community_join_requests(
    community_id: int,
    status_filter: str | None = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get join requests for a community (commissioner only)
    
    - **status_filter**: Optional filter by status (pending, approved, denied)
    """
    from .models import JoinRequest
    
    user_id = current_user.get("user_id")
    
    # Verify community exists and user is commissioner
    community = db.query(Community).filter(Community.id == community_id).first()
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found"
        )
    
    # Check if user is commissioner
    commissioner_id = community.commissioner_id
    if not commissioner_id:
        league = db.query(League).filter(League.id == community.league_id).first()
        commissioner_id = league.owner_id if league else None
    
    if user_id != commissioner_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the commissioner can view join requests"
        )
    
    # Build query
    query = db.query(JoinRequest).filter(JoinRequest.community_id == community_id)
    
    if status_filter:
        query = query.filter(JoinRequest.status == status_filter)
    
    requests = query.order_by(JoinRequest.created_at.desc()).all()
    
    # Build response with usernames
    result = []
    for req in requests:
        user = db.query(User).filter(User.id == req.user_id).first()
        result.append({
            "id": req.id,
            "user_id": req.user_id,
            "username": user.username if user else "Unknown",
            "community_id": req.community_id,
            "community_name": community.name,
            "message": req.message,
            "status": req.status,
            "custom_starting_balance": float(req.custom_starting_balance) if req.custom_starting_balance else None,
            "reviewed_by_user_id": req.reviewed_by_user_id,
            "reviewed_at": req.reviewed_at.isoformat() if req.reviewed_at else None,
            "created_at": req.created_at.isoformat()
        })
    
    return result


@app.post("/api/join-requests/{request_id}/review")
def review_join_request(
    request_id: int,
    approved: bool,
    custom_starting_balance: float | None = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Review a join request (commissioner only)
    
    - **approved**: True to approve, False to deny
    - **custom_starting_balance**: Optional custom starting balance (defaults to community default)
    """
    from .models import JoinRequest, InboxMessage
    from datetime import datetime
    
    user_id = current_user.get("user_id")
    
    # Get the join request
    join_request = db.query(JoinRequest).filter(JoinRequest.id == request_id).first()
    if not join_request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Join request not found"
        )
    
    if join_request.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"This request has already been {join_request.status}"
        )
    
    # Verify user is commissioner
    community = db.query(Community).filter(Community.id == join_request.community_id).first()
    if not community:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Community not found")
    
    commissioner_id = community.commissioner_id
    if not commissioner_id:
        league = db.query(League).filter(League.id == community.league_id).first()
        commissioner_id = league.owner_id if league else None
    
    if user_id != commissioner_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the commissioner can review join requests"
        )
    
    # Update request
    join_request.status = "approved" if approved else "denied"
    join_request.reviewed_by_user_id = user_id
    join_request.reviewed_at = datetime.now()
    
    if approved:
        # Use custom balance or community default
        starting_balance = Decimal(str(custom_starting_balance)) if custom_starting_balance else community.starting_balance
        join_request.custom_starting_balance = starting_balance

        existing_member = db.query(LeagueMember).filter(
            LeagueMember.league_id == community.league_id,
            LeagueMember.user_id == join_request.user_id
        ).first()
        if not existing_member:
            db.add(LeagueMember(league_id=community.league_id, user_id=join_request.user_id))
        
        # Create wallet for user
        new_wallet = Wallet(
            user_id=join_request.user_id,
            community_id=join_request.community_id,
            balance=starting_balance
        )
        db.add(new_wallet)
    
    # Get requester info
    requester = db.query(User).filter(User.id == join_request.user_id).first()
    
    # Send notification to requester
    inbox_message = InboxMessage(
        recipient_user_id=join_request.user_id,
        sender_user_id=user_id,
        message_type="join_approved" if approved else "join_denied",
        title=f"Join Request {'Approved' if approved else 'Denied'}",
        content=f"Your request to join {community.name} has been {'approved' if approved else 'denied'}." +
                (f" You have been given {starting_balance} chips to start!" if approved else ""),
        message_metadata={
            "community_id": community.id,
            "community_name": community.name,
            "approved": approved
        },
        is_actionable=False
    )
    db.add(inbox_message)
    
    db.commit()
    
    return {
        "message": f"Request {'approved' if approved else 'denied'} successfully",
        "request_id": request_id,
        "status": join_request.status
    }


@app.post("/api/league-join-requests/{request_id}/review")
def review_league_join_request(
    request_id: int,
    approved: bool,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Review a league join request (owner/admin only)
    """
    from .models import InboxMessage
    from datetime import datetime

    user_id = current_user.get("user_id")

    join_request = db.query(LeagueJoinRequest).filter(
        LeagueJoinRequest.id == request_id
    ).first()
    if not join_request:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Join request not found")

    if join_request.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"This request has already been {join_request.status}"
        )

    league = db.query(League).filter(League.id == join_request.league_id).first()
    if not league:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="League not found")

    if not (league.owner_id == user_id or _is_league_admin(db, league.id, user_id)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only league owners or admins can review join requests"
        )

    join_request.status = "approved" if approved else "denied"
    join_request.reviewed_by_user_id = user_id
    join_request.reviewed_at = datetime.now()

    if approved:
        existing_member = db.query(LeagueMember).filter(
            LeagueMember.league_id == league.id,
            LeagueMember.user_id == join_request.user_id
        ).first()
        if not existing_member:
            db.add(LeagueMember(league_id=league.id, user_id=join_request.user_id))

    inbox_message = InboxMessage(
        recipient_user_id=join_request.user_id,
        sender_user_id=user_id,
        message_type="league_join_approved" if approved else "league_join_denied",
        title=f"League Join Request {'Approved' if approved else 'Denied'}",
        content=f"Your request to join {league.name} has been {'approved' if approved else 'denied'}.",
        message_metadata={
            "league_id": league.id,
            "league_name": league.name,
            "approved": approved
        },
        is_actionable=False
    )
    db.add(inbox_message)

    db.commit()

    return {
        "message": f"Request {'approved' if approved else 'denied'} successfully",
        "request_id": request_id,
        "status": join_request.status
    }


# ============================================================================
# Inbox Endpoints
# ============================================================================

@app.get("/api/inbox")
def get_inbox(
    unread_only: bool = False,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get inbox messages for the current user
    
    - **unread_only**: If true, only return unread messages
    """
    from .models import InboxMessage
    
    user_id = current_user.get("user_id")
    
    query = db.query(InboxMessage).filter(InboxMessage.recipient_user_id == user_id)
    
    if unread_only:
        query = query.filter(InboxMessage.is_read == False)
    
    messages = query.order_by(InboxMessage.created_at.desc()).all()
    
    result = []
    for msg in messages:
        sender = db.query(User).filter(User.id == msg.sender_user_id).first() if msg.sender_user_id else None
        result.append({
            "id": msg.id,
            "sender_username": sender.username if sender else "System",
            "message_type": msg.message_type,
            "title": msg.title,
            "content": msg.content,
            "metadata": msg.message_metadata,
            "is_read": msg.is_read,
            "is_actionable": msg.is_actionable,
            "action_taken": msg.action_taken,
            "created_at": msg.created_at.isoformat(),
            "read_at": msg.read_at.isoformat() if msg.read_at else None
        })
    
    return result


@app.get("/api/inbox/unread-count")
def get_unread_count(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get count of unread messages"""
    from .models import InboxMessage
    
    user_id = current_user.get("user_id")
    
    count = db.query(InboxMessage).filter(
        InboxMessage.recipient_user_id == user_id,
        InboxMessage.is_read == False
    ).count()
    
    return {"unread_count": count}


@app.post("/api/inbox/{message_id}/read")
def mark_message_read(
    message_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Mark a message as read"""
    from .models import InboxMessage
    from datetime import datetime
    
    user_id = current_user.get("user_id")
    
    message = db.query(InboxMessage).filter(
        InboxMessage.id == message_id,
        InboxMessage.recipient_user_id == user_id
    ).first()
    
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    
    message.is_read = True
    message.read_at = datetime.now()
    db.commit()
    
    return {"message": "Message marked as read"}


@app.post("/api/inbox/{message_id}/action")
def take_message_action(
    message_id: int,
    action: str,
    custom_starting_balance: float | None = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Take action on an actionable message (e.g., approve/deny join request)
    
    - **action**: The action to take (approve, deny)
    - **custom_starting_balance**: Optional custom starting balance for approvals
    """
    from .models import InboxMessage
    
    user_id = current_user.get("user_id")
    
    message = db.query(InboxMessage).filter(
        InboxMessage.id == message_id,
        InboxMessage.recipient_user_id == user_id
    ).first()
    
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    
    if not message.is_actionable:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This message has no actions")
    
    if message.action_taken:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Action already taken: {message.action_taken}")
    
    # Handle join request actions
    if message.message_type == "join_request":
        if action not in ["approve", "deny"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid action. Use 'approve' or 'deny'")
        
        request_id = message.message_metadata.get("request_id")
        if not request_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid message metadata")
        
        # Call the review endpoint logic
        result = review_join_request(
            request_id=request_id,
            approved=(action == "approve"),
            custom_starting_balance=custom_starting_balance,
            current_user=current_user,
            db=db
        )
        
        # Mark message action as taken
        message.action_taken = action
        message.is_read = True
        db.commit()
        
        return result

    if message.message_type == "league_join_request":
        if action not in ["approve", "deny"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid action. Use 'approve' or 'deny'")

        request_id = message.message_metadata.get("request_id")
        if not request_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid message metadata")

        result = review_league_join_request(
            request_id=request_id,
            approved=(action == "approve"),
            current_user=current_user,
            db=db
        )

        message.action_taken = action
        message.is_read = True
        db.commit()

        return result
    
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown message type for action")


# ============================================================================
# Customization / Marketplace / Messaging / Feedback / Tournaments
# ============================================================================

@app.get("/api/me/gold-balance", response_model=GoldBalanceResponse)
def get_my_gold_balance(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user = _get_user_or_404(db, current_user.get("user_id"))
    return GoldBalanceResponse(gold_coins=int(user.gold_coins or 0))


@app.get("/api/marketplace/coin-packages")
def get_coin_packages():
    return [
        {"package_key": package_key, **values}
        for package_key, values in COIN_PACKAGES.items()
    ]


@app.post("/api/marketplace/coin-purchase-intents", response_model=CoinPurchaseIntentResponse, status_code=status.HTTP_201_CREATED)
def create_coin_purchase_intent(
    payload: CoinPurchaseIntentCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    package = COIN_PACKAGES.get(payload.package_key)
    if not package:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown coin package")

    user = _get_user_or_404(db, current_user.get("user_id"))
    _ensure_not_banned(user)

    intent = CoinPurchaseIntent(
        user_id=user.id,
        provider=settings.COIN_PAYMENT_PROVIDER,
        package_key=payload.package_key,
        gold_coins=package["gold_coins"],
        usd_cents=package["usd_cents"],
        status="pending",
        provider_reference=None,
        intent_metadata={"integration": "scaffold_v1"},
    )
    db.add(intent)
    db.commit()
    db.refresh(intent)

    intent.provider_reference = f"{intent.provider}_intent_{intent.id}"
    db.commit()
    db.refresh(intent)

    return CoinPurchaseIntentResponse(
        id=intent.id,
        provider=intent.provider,
        package_key=intent.package_key,
        gold_coins=int(intent.gold_coins),
        usd_cents=int(intent.usd_cents),
        status=intent.status.value if hasattr(intent.status, "value") else intent.status,
        provider_reference=intent.provider_reference,
        checkout_url=None,  # Placeholder until payment provider integration is wired.
        created_at=intent.created_at,
    )


@app.post("/api/admin/coin-purchase-intents/{intent_id}/complete")
def complete_coin_purchase_intent(
    intent_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    _require_global_admin(db, current_user)
    intent = db.query(CoinPurchaseIntent).filter(CoinPurchaseIntent.id == intent_id).first()
    if not intent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase intent not found")

    if (intent.status.value if hasattr(intent.status, "value") else intent.status) == "completed":
        return {"message": "Purchase intent already completed"}

    user = _get_user_or_404(db, intent.user_id)
    user.gold_coins = int(user.gold_coins or 0) + int(intent.gold_coins)
    intent.status = "completed"
    intent.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    return {
        "message": "Purchase completed and gold coins credited",
        "user_id": user.id,
        "gold_coins": int(user.gold_coins),
    }


@app.get("/api/me/creator-earnings", response_model=CreatorEarningsResponse)
def get_my_creator_earnings(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user = _get_user_or_404(db, current_user.get("user_id"))
    pending_cents = int(user.creator_cash_pending_cents or 0)
    paid_cents = int(user.creator_cash_paid_cents or 0)
    return CreatorEarningsResponse(
        pending_cents=pending_cents,
        paid_cents=paid_cents,
        total_cents=pending_cents + paid_cents,
        payout_email=user.creator_payout_email,
    )


@app.patch("/api/me/creator-earnings/profile", response_model=CreatorEarningsResponse)
def update_creator_payout_profile(
    payload: CreatorPayoutProfileUpdateRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user = _get_user_or_404(db, current_user.get("user_id"))
    _ensure_not_banned(user)
    user.creator_payout_email = payload.payout_email
    db.commit()
    db.refresh(user)
    pending_cents = int(user.creator_cash_pending_cents or 0)
    paid_cents = int(user.creator_cash_paid_cents or 0)
    return CreatorEarningsResponse(
        pending_cents=pending_cents,
        paid_cents=paid_cents,
        total_cents=pending_cents + paid_cents,
        payout_email=user.creator_payout_email,
    )


@app.get("/api/me/creator-payout-requests", response_model=list[CreatorPayoutRequestResponse])
def list_my_creator_payout_requests(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user_id = current_user.get("user_id")
    requests = (
        db.query(CreatorPayoutRequest)
        .filter(CreatorPayoutRequest.user_id == user_id)
        .order_by(CreatorPayoutRequest.requested_at.desc())
        .all()
    )
    return [_creator_payout_to_response(request) for request in requests]


@app.post("/api/me/creator-payout-requests", response_model=CreatorPayoutRequestResponse, status_code=status.HTTP_201_CREATED)
def request_creator_payout(
    payload: CreatorPayoutRequestCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user = _get_user_or_404(db, current_user.get("user_id"))
    _ensure_not_banned(user)
    if not user.creator_payout_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Set your creator payout email before requesting a payout",
        )

    available_cents = int(user.creator_cash_pending_cents or 0)
    if available_cents <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No creator earnings available")

    amount_cents = int(payload.amount_cents) if payload.amount_cents is not None else available_cents
    if amount_cents <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payout amount must be positive")
    if amount_cents > available_cents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Payout amount exceeds available earnings ({available_cents} cents)",
        )
    if amount_cents < CREATOR_PAYOUT_MIN_CENTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Minimum payout request is {CREATOR_PAYOUT_MIN_CENTS} cents",
        )

    user.creator_cash_pending_cents = available_cents - amount_cents
    payout_request = CreatorPayoutRequest(
        user_id=user.id,
        amount_cents=amount_cents,
        payout_email=user.creator_payout_email,
        status=CreatorPayoutStatus.PENDING.value,
    )
    db.add(payout_request)
    db.flush()

    global_admins = db.query(User).filter(User.is_admin == True, User.is_active == True).all()
    for admin in global_admins:
        if admin.id == user.id:
            continue
        db.add(InboxMessage(
            recipient_user_id=admin.id,
            sender_user_id=user.id,
            message_type="creator_payout_request",
            title=f"Creator Payout Request: {user.username}",
            content=f"{user.username} requested payout of ${(amount_cents / 100):.2f}.",
            message_metadata={
                "payout_request_id": payout_request.id,
                "user_id": user.id,
                "username": user.username,
                "amount_cents": amount_cents,
                "payout_email": user.creator_payout_email,
            },
            is_actionable=False,
        ))

    db.commit()
    db.refresh(payout_request)
    return _creator_payout_to_response(payout_request)


@app.get("/api/admin/creator-payout-requests", response_model=list[CreatorPayoutRequestResponse])
def list_creator_payout_requests_as_admin(
    status_filter: str | None = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    _require_global_admin(db, current_user)
    query = db.query(CreatorPayoutRequest)
    if status_filter:
        query = query.filter(CreatorPayoutRequest.status == status_filter)
    requests = query.order_by(CreatorPayoutRequest.requested_at.desc()).all()
    return [_creator_payout_to_response(request) for request in requests]


@app.post("/api/admin/creator-payout-requests/{request_id}/process", response_model=CreatorPayoutRequestResponse)
def process_creator_payout_request_as_admin(
    request_id: int,
    payload: CreatorPayoutProcessRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    admin = _require_global_admin(db, current_user)
    request = db.query(CreatorPayoutRequest).filter(CreatorPayoutRequest.id == request_id).first()
    if not request:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payout request not found")

    status_value = request.status.value if hasattr(request.status, "value") else request.status
    if status_value != CreatorPayoutStatus.PENDING.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Payout request already processed with status '{status_value}'",
        )

    creator = _get_user_or_404(db, request.user_id)
    amount_cents = int(request.amount_cents or 0)
    request.processor_note = payload.processor_note
    request.payout_reference = payload.payout_reference
    request.processed_by_user_id = admin.id
    request.processed_at = datetime.utcnow()

    if payload.action == "mark_paid":
        request.status = CreatorPayoutStatus.PAID.value
        creator.creator_cash_paid_cents = int(creator.creator_cash_paid_cents or 0) + amount_cents
        creator_message = InboxMessage(
            recipient_user_id=creator.id,
            sender_user_id=admin.id,
            message_type="creator_payout_paid",
            title="Creator payout processed",
            content=f"Your payout of ${(amount_cents / 100):.2f} has been marked as paid.",
            message_metadata={
                "payout_request_id": request.id,
                "amount_cents": amount_cents,
                "payout_reference": payload.payout_reference,
                "processor_note": payload.processor_note,
            },
            is_actionable=False,
        )
        db.add(creator_message)
    elif payload.action == "reject":
        request.status = CreatorPayoutStatus.REJECTED.value
        creator.creator_cash_pending_cents = int(creator.creator_cash_pending_cents or 0) + amount_cents
        creator_message = InboxMessage(
            recipient_user_id=creator.id,
            sender_user_id=admin.id,
            message_type="creator_payout_rejected",
            title="Creator payout rejected",
            content=(
                f"Your payout of ${(amount_cents / 100):.2f} was rejected."
                + (f" Reason: {payload.processor_note}" if payload.processor_note else "")
            ),
            message_metadata={
                "payout_request_id": request.id,
                "amount_cents": amount_cents,
                "processor_note": payload.processor_note,
            },
            is_actionable=False,
        )
        db.add(creator_message)
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid action")

    db.commit()
    db.refresh(request)
    return _creator_payout_to_response(request)


@app.get("/api/skins/catalog", response_model=list[SkinResponse])
def get_skin_catalog(
    category: str | None = Query(default=None),
    db: Session = Depends(get_db)
):
    query = db.query(Skin).filter(Skin.is_active == True)
    if category:
        query = query.filter(Skin.category == category)
    skins = query.order_by(Skin.created_at.desc()).all()
    return [_skin_to_response(skin) for skin in skins]


@app.get("/api/marketplace/items", response_model=list[SkinResponse])
def get_marketplace_items(
    db: Session = Depends(get_db)
):
    skins = db.query(Skin).filter(Skin.is_active == True).order_by(Skin.created_at.desc()).all()
    return [_skin_to_response(skin) for skin in skins]


@app.post("/api/admin/skins", response_model=SkinResponse, status_code=status.HTTP_201_CREATED)
def create_skin_listing(
    payload: SkinCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    admin_user = _require_global_admin(db, current_user)
    _validate_skin_design_spec(
        payload.design_spec.model_dump(),
        category=payload.category,
        require_runtime_assets=True,
    )

    existing = db.query(Skin).filter(Skin.slug == payload.slug).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Skin slug already exists")

    skin = Skin(
        slug=payload.slug,
        name=payload.name,
        description=payload.description,
        category=payload.category,
        price_gold_coins=payload.price_gold_coins,
        design_spec=payload.design_spec.model_dump(),
        preview_url=payload.preview_url,
        is_active=payload.is_active,
        created_by_user_id=admin_user.id,
    )
    db.add(skin)
    db.commit()
    db.refresh(skin)
    return _skin_to_response(skin)


@app.post("/api/marketplace/items/{skin_id}/buy", response_model=MarketplacePurchaseResponse)
def buy_marketplace_skin(
    skin_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user = _get_user_or_404(db, current_user.get("user_id"))
    _ensure_not_banned(user)
    skin = db.query(Skin).filter(Skin.id == skin_id, Skin.is_active == True).first()
    if not skin:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skin not found")

    owned = db.query(UserSkin).filter(UserSkin.user_id == user.id, UserSkin.skin_id == skin.id).first()
    if owned:
        return MarketplacePurchaseResponse(
            success=True,
            message="Skin already owned",
            gold_coins=int(user.gold_coins or 0),
            skin_id=skin.id,
        )

    price = int(skin.price_gold_coins or 0)
    if int(user.gold_coins or 0) < price:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not enough gold coins")

    user.gold_coins = int(user.gold_coins or 0) - price
    creator_royalty_usd_cents = 0
    if price > 0 and skin.created_by_user_id and skin.created_by_user_id != user.id:
        creator = db.query(User).filter(User.id == skin.created_by_user_id).first()
        if creator and creator.is_active:
            # Peg model: 1 gold coin ~= 1 USD cent for creator royalty accounting.
            creator_royalty_usd_cents = int(price * CREATOR_ROYALTY_PERCENT / 100)
            if creator_royalty_usd_cents > 0:
                creator.creator_cash_pending_cents = int(creator.creator_cash_pending_cents or 0) + creator_royalty_usd_cents

    user_skin = UserSkin(user_id=user.id, skin_id=skin.id, is_equipped=False)
    db.add(user_skin)
    db.commit()
    db.refresh(user)

    return MarketplacePurchaseResponse(
        success=True,
        message="Skin purchased successfully",
        gold_coins=int(user.gold_coins),
        skin_id=skin.id,
        creator_royalty_coins=0,
        creator_royalty_usd_cents=creator_royalty_usd_cents,
    )


@app.get("/api/me/skins", response_model=list[UserSkinResponse])
def get_my_skins(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user = _get_user_or_404(db, current_user.get("user_id"))
    skins = (
        db.query(UserSkin)
        .join(Skin, Skin.id == UserSkin.skin_id)
        .filter(UserSkin.user_id == user.id)
        .order_by(UserSkin.acquired_at.desc())
        .all()
    )
    return [_user_skin_to_response(row) for row in skins]


@app.post("/api/skins/{skin_id}/equip", response_model=MarketplacePurchaseResponse)
def equip_skin(
    skin_id: int,
    payload: EquipSkinRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user_id = current_user.get("user_id")
    user_skin = (
        db.query(UserSkin)
        .join(Skin, Skin.id == UserSkin.skin_id)
        .filter(UserSkin.user_id == user_id, UserSkin.skin_id == skin_id)
        .first()
    )
    if not user_skin:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skin not owned")

    target_category = user_skin.skin.category
    if payload.equip:
        category_skin_ids = [
            row[0]
            for row in db.query(Skin.id).filter(Skin.category == target_category).all()
        ]
        if category_skin_ids:
            db.query(UserSkin).filter(
                UserSkin.user_id == user_id,
                UserSkin.skin_id.in_(category_skin_ids)
            ).update({"is_equipped": False}, synchronize_session=False)
        user_skin.is_equipped = True
    else:
        user_skin.is_equipped = False

    db.commit()
    user = _get_user_or_404(db, user_id)
    return MarketplacePurchaseResponse(
        success=True,
        message="Skin equipment updated",
        gold_coins=int(user.gold_coins or 0),
        skin_id=skin_id,
    )


@app.post("/api/skins/submit-design", response_model=SkinSubmissionResponse, status_code=status.HTTP_201_CREATED)
def submit_skin_design(
    payload: SkinSubmissionCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user = _get_user_or_404(db, current_user.get("user_id"))
    _ensure_not_banned(user)
    if not payload.reference_image_url and payload.design_spec is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide either a reference_image_url or a design_spec",
        )

    if payload.design_spec is not None:
        design_spec = payload.design_spec.model_dump()
        _validate_skin_design_spec(design_spec, category=payload.category)
    else:
        design_spec = _default_skin_design_spec_from_reference(payload.reference_image_url, payload.category)

    submission = SkinSubmission(
        user_id=user.id,
        name=payload.name,
        category=payload.category,
        design_spec=design_spec,
        desired_price_gold_coins=payload.desired_price_gold_coins,
        reference_image_url=payload.reference_image_url,
        submitter_notes=payload.submitter_notes,
        status="pending",
        workflow_state=SkinSubmissionWorkflowState.PENDING_ADMIN_REVIEW.value,
    )
    db.add(submission)
    db.flush()
    _notify_global_admins_of_skin_submission(db, submission, user)
    db.commit()
    db.refresh(submission)
    return _skin_submission_to_response(submission, user.username)


@app.get("/api/skins/submissions/me", response_model=list[SkinSubmissionResponse])
def list_my_skin_submissions(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user = _get_user_or_404(db, current_user.get("user_id"))
    submissions = (
        db.query(SkinSubmission)
        .filter(SkinSubmission.user_id == user.id)
        .order_by(SkinSubmission.created_at.desc())
        .all()
    )
    return [_skin_submission_to_response(submission, user.username) for submission in submissions]


@app.get("/api/admin/skin-submissions", response_model=list[SkinSubmissionResponse])
def list_skin_submissions(
    status_filter: str | None = None,
    workflow_state_filter: str | None = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    _require_global_admin(db, current_user)
    query = db.query(SkinSubmission)
    if status_filter:
        query = query.filter(SkinSubmission.status == status_filter)
    if workflow_state_filter:
        query = query.filter(SkinSubmission.workflow_state == workflow_state_filter)
    submissions = query.order_by(SkinSubmission.created_at.desc()).all()

    user_ids = list({submission.user_id for submission in submissions})
    users_by_id = {
        user.id: user
        for user in db.query(User).filter(User.id.in_(user_ids)).all()
    } if user_ids else {}

    result: list[SkinSubmissionResponse] = []
    for submission in submissions:
        owner = users_by_id.get(submission.user_id)
        result.append(_skin_submission_to_response(submission, owner.username if owner else f"user_{submission.user_id}"))
    return result


@app.post("/api/admin/skin-submissions/{submission_id}/review")
def review_skin_submission(
    submission_id: int,
    payload: SkinSubmissionReview,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    admin = _require_global_admin(db, current_user)
    submission = db.query(SkinSubmission).filter(SkinSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skin submission not found")

    action = _skin_submission_action(payload)
    if action not in {"accept", "decline"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="action must be 'accept' or 'decline'")

    workflow_state = (
        submission.workflow_state.value
        if hasattr(submission.workflow_state, "value")
        else submission.workflow_state
    ) or SkinSubmissionWorkflowState.PENDING_ADMIN_REVIEW.value
    if workflow_state not in {
        SkinSubmissionWorkflowState.PENDING_ADMIN_REVIEW.value,
        SkinSubmissionWorkflowState.CREATOR_DECLINED.value,
        SkinSubmissionWorkflowState.ADMIN_ACCEPTED_WAITING_CREATOR.value,
    }:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Submission is not reviewable in state '{workflow_state}'",
        )

    submission.reviewed_by_user_id = admin.id
    submission.reviewed_at = datetime.utcnow()
    submission.review_notes = payload.review_notes
    submission.admin_comment = payload.review_notes

    if action == "accept":
        proposed_design_spec = (
            payload.proposed_design_spec.model_dump()
            if payload.proposed_design_spec is not None
            else submission.design_spec
        )
        _validate_skin_design_spec(
            proposed_design_spec,
            category=submission.category,
            require_runtime_assets=True,
        )
        proposed_price = payload.publish_price_gold_coins
        if proposed_price is None:
            proposed_price = int(submission.desired_price_gold_coins or 0)

        submission.status = "pending"
        submission.workflow_state = SkinSubmissionWorkflowState.ADMIN_ACCEPTED_WAITING_CREATOR.value
        submission.admin_proposed_design_spec = proposed_design_spec
        submission.admin_rendered_image_url = payload.publish_preview_url or submission.reference_image_url
        submission.admin_proposed_price_gold_coins = int(proposed_price)
        submission.creator_decision = None
        submission.creator_comment = None
        submission.creator_responded_at = None
        submission.finalized_skin_id = None

        creator_message = InboxMessage(
            recipient_user_id=submission.user_id,
            sender_user_id=admin.id,
            message_type="skin_submission_admin_accept",
            title=f"Skin Submission Proposal Ready: {submission.name}",
            content=(
                f"Admin proposed marketplace listing details for '{submission.name}'. "
                f"Review and accept/decline the proposal."
            ),
            message_metadata={
                "submission_id": submission.id,
                "submission_name": submission.name,
                "proposed_price_gold_coins": submission.admin_proposed_price_gold_coins,
                "admin_comment": submission.admin_comment,
                "admin_rendered_image_url": submission.admin_rendered_image_url,
                "proposed_design_spec": submission.admin_proposed_design_spec,
            },
            is_actionable=False,
        )
        db.add(creator_message)
    else:
        submission.status = "rejected"
        submission.workflow_state = SkinSubmissionWorkflowState.ADMIN_DECLINED.value
        submission.admin_proposed_design_spec = None
        submission.admin_rendered_image_url = None
        submission.admin_proposed_price_gold_coins = None
        submission.creator_decision = None
        submission.creator_comment = None
        submission.creator_responded_at = None
        submission.finalized_skin_id = None

        creator_message = InboxMessage(
            recipient_user_id=submission.user_id,
            sender_user_id=admin.id,
            message_type="skin_submission_admin_decline",
            title=f"Skin Submission Declined: {submission.name}",
            content=(
                f"Your submission '{submission.name}' was declined."
                + (f" Notes: {payload.review_notes}" if payload.review_notes else "")
            ),
            message_metadata={
                "submission_id": submission.id,
                "submission_name": submission.name,
                "admin_comment": payload.review_notes,
            },
            is_actionable=False,
        )
        db.add(creator_message)

    db.commit()

    return {
        "message": "Submission reviewed",
        "submission_id": submission.id,
        "status": submission.status.value if hasattr(submission.status, "value") else submission.status,
        "workflow_state": submission.workflow_state,
        "skin_id": submission.finalized_skin_id,
    }


@app.post("/api/skins/submissions/{submission_id}/creator-decision")
def creator_decide_skin_submission(
    submission_id: int,
    payload: SkinSubmissionCreatorDecision,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user = _get_user_or_404(db, current_user.get("user_id"))
    _ensure_not_banned(user)
    submission = db.query(SkinSubmission).filter(SkinSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skin submission not found")
    if submission.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only decide your own submissions")

    workflow_state = (
        submission.workflow_state.value
        if hasattr(submission.workflow_state, "value")
        else submission.workflow_state
    ) or SkinSubmissionWorkflowState.PENDING_ADMIN_REVIEW.value
    if workflow_state != SkinSubmissionWorkflowState.ADMIN_ACCEPTED_WAITING_CREATOR.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Submission is not waiting for creator decision",
        )

    submission.creator_comment = payload.creator_comment
    submission.creator_responded_at = datetime.utcnow()

    published_skin = None
    if payload.accept:
        proposed_design_spec = submission.admin_proposed_design_spec or submission.design_spec
        _validate_skin_design_spec(
            proposed_design_spec,
            category=submission.category,
            require_runtime_assets=True,
        )
        proposed_price = int(
            submission.admin_proposed_price_gold_coins
            if submission.admin_proposed_price_gold_coins is not None
            else submission.desired_price_gold_coins
        )

        base_slug = f"community-{submission.id}-{submission.name.lower().replace(' ', '-')[:70]}"
        slug = base_slug
        suffix = 1
        while db.query(Skin.id).filter(Skin.slug == slug).first() is not None:
            suffix += 1
            slug = f"{base_slug}-{suffix}"

        published_skin = Skin(
            slug=slug,
            name=submission.name,
            description=f"Community submission #{submission.id}",
            category=submission.category,
            price_gold_coins=proposed_price,
            design_spec=proposed_design_spec,
            preview_url=submission.admin_rendered_image_url or submission.reference_image_url,
            is_active=True,
            created_by_user_id=submission.user_id,
        )
        db.add(published_skin)
        db.flush()

        submission.status = "approved"
        submission.workflow_state = SkinSubmissionWorkflowState.CREATOR_ACCEPTED_PUBLISHED.value
        submission.creator_decision = "accepted"
        submission.finalized_skin_id = published_skin.id
    else:
        submission.status = "rejected"
        submission.workflow_state = SkinSubmissionWorkflowState.CREATOR_DECLINED.value
        submission.creator_decision = "declined"
        submission.finalized_skin_id = None

    if submission.reviewed_by_user_id:
        admin_message = InboxMessage(
            recipient_user_id=submission.reviewed_by_user_id,
            sender_user_id=user.id,
            message_type="skin_submission_creator_response",
            title=f"Creator {'Accepted' if payload.accept else 'Declined'}: {submission.name}",
            content=(
                f"{user.username} {'accepted' if payload.accept else 'declined'} the admin proposal for '{submission.name}'."
                + (f" Comment: {payload.creator_comment}" if payload.creator_comment else "")
            ),
            message_metadata={
                "submission_id": submission.id,
                "submission_name": submission.name,
                "creator_decision": submission.creator_decision,
                "creator_comment": payload.creator_comment,
                "published_skin_id": published_skin.id if published_skin else None,
            },
            is_actionable=False,
        )
        db.add(admin_message)

    db.commit()
    if published_skin:
        db.refresh(published_skin)

    return {
        "message": "Decision recorded",
        "submission_id": submission.id,
        "status": submission.status.value if hasattr(submission.status, "value") else submission.status,
        "workflow_state": submission.workflow_state,
        "skin_id": published_skin.id if published_skin else None,
    }


@app.get("/api/users/search")
def search_users(
    q: str = Query(..., min_length=2, max_length=50),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user_id = current_user.get("user_id")
    users = (
        db.query(User)
        .filter(User.id != user_id, User.is_active == True, User.username.ilike(f"%{q}%"))
        .order_by(User.username.asc())
        .limit(20)
        .all()
    )
    return [{"id": user.id, "username": user.username} for user in users]


@app.get("/api/player-notes/{target_user_id}", response_model=PlayerNoteResponse)
def get_player_note(
    target_user_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    owner = _get_user_or_404(db, current_user.get("user_id"))
    target = _get_user_or_404(db, target_user_id)
    if target.id == owner.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot create notes about yourself")

    note = db.query(PlayerNote).filter(
        PlayerNote.owner_user_id == owner.id,
        PlayerNote.target_user_id == target.id,
    ).first()

    return PlayerNoteResponse(
        target_user_id=target.id,
        target_username=target.username,
        notes=note.notes if note else "",
        updated_at=note.updated_at if note else None,
    )


@app.put("/api/player-notes/{target_user_id}", response_model=PlayerNoteResponse)
def upsert_player_note(
    target_user_id: int,
    payload: PlayerNoteUpsertRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    owner = _get_user_or_404(db, current_user.get("user_id"))
    _ensure_not_banned(owner)
    target = _get_user_or_404(db, target_user_id)
    if target.id == owner.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot create notes about yourself")

    normalized_notes = payload.notes.strip()
    note = db.query(PlayerNote).filter(
        PlayerNote.owner_user_id == owner.id,
        PlayerNote.target_user_id == target.id,
    ).first()

    if not normalized_notes:
        if note:
            db.delete(note)
            db.commit()
        return PlayerNoteResponse(
            target_user_id=target.id,
            target_username=target.username,
            notes="",
            updated_at=None,
        )

    if note:
        note.notes = normalized_notes
    else:
        note = PlayerNote(
            owner_user_id=owner.id,
            target_user_id=target.id,
            notes=normalized_notes,
        )
        db.add(note)

    db.commit()
    db.refresh(note)
    return PlayerNoteResponse(
        target_user_id=target.id,
        target_username=target.username,
        notes=note.notes,
        updated_at=note.updated_at,
    )


@app.get("/api/messages/conversations", response_model=list[ConversationSummaryResponse])
def get_conversations(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user_id = current_user.get("user_id")
    messages = (
        db.query(DirectMessage)
        .filter(or_(DirectMessage.sender_user_id == user_id, DirectMessage.recipient_user_id == user_id))
        .order_by(DirectMessage.created_at.desc())
        .all()
    )

    summaries: dict[int, ConversationSummaryResponse] = {}
    unread_counts: dict[int, int] = {}

    for msg in messages:
        other_user_id = msg.recipient_user_id if msg.sender_user_id == user_id else msg.sender_user_id
        if other_user_id not in summaries:
            other_user = db.query(User).filter(User.id == other_user_id).first()
            summaries[other_user_id] = ConversationSummaryResponse(
                user_id=other_user_id,
                username=other_user.username if other_user else f"user_{other_user_id}",
                last_message=msg.content,
                last_message_at=msg.created_at,
                unread_count=0,
            )
        if msg.recipient_user_id == user_id and msg.read_at is None:
            unread_counts[other_user_id] = unread_counts.get(other_user_id, 0) + 1

    for other_user_id, count in unread_counts.items():
        if other_user_id in summaries:
            summaries[other_user_id].unread_count = count

    return sorted(summaries.values(), key=lambda item: item.last_message_at, reverse=True)


@app.get("/api/messages/{other_user_id}", response_model=list[DirectMessageResponse])
def get_direct_message_thread(
    other_user_id: int,
    limit: int = Query(default=100, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user_id = current_user.get("user_id")
    me = _get_user_or_404(db, user_id)
    other_user = _get_user_or_404(db, other_user_id)

    query = (
        db.query(DirectMessage)
        .filter(
            or_(
                and_(DirectMessage.sender_user_id == user_id, DirectMessage.recipient_user_id == other_user_id),
                and_(DirectMessage.sender_user_id == other_user_id, DirectMessage.recipient_user_id == user_id),
            )
        )
        .order_by(DirectMessage.created_at.asc())
        .limit(limit)
    )
    messages = query.all()

    unread_rows = [
        message
        for message in messages
        if message.recipient_user_id == user_id and message.read_at is None
    ]
    if unread_rows:
        now = datetime.utcnow()
        for row in unread_rows:
            row.read_at = now
        db.commit()

    return [
        DirectMessageResponse(
            id=message.id,
            sender_user_id=message.sender_user_id,
            sender_username=me.username if message.sender_user_id == me.id else other_user.username,
            recipient_user_id=message.recipient_user_id,
            recipient_username=other_user.username if message.recipient_user_id == other_user.id else me.username,
            content=message.content,
            created_at=message.created_at,
            read_at=message.read_at,
        )
        for message in messages
    ]


@app.post("/api/messages/{recipient_user_id}", response_model=DirectMessageResponse, status_code=status.HTTP_201_CREATED)
def send_direct_message(
    recipient_user_id: int,
    payload: DirectMessageCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    sender = _get_user_or_404(db, current_user.get("user_id"))
    _ensure_not_banned(sender)
    recipient = _get_user_or_404(db, recipient_user_id)
    if recipient.id == sender.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot message yourself")

    message = DirectMessage(
        sender_user_id=sender.id,
        recipient_user_id=recipient.id,
        content=payload.content.strip(),
    )
    db.add(message)

    inbox_message = InboxMessage(
        recipient_user_id=recipient.id,
        sender_user_id=sender.id,
        message_type="direct_message",
        title=f"New message from {sender.username}",
        content=message.content,
        message_metadata={
            "sender_user_id": sender.id,
            "sender_username": sender.username,
        },
        is_actionable=False,
    )
    db.add(inbox_message)
    db.commit()
    db.refresh(message)

    return DirectMessageResponse(
        id=message.id,
        sender_user_id=sender.id,
        sender_username=sender.username,
        recipient_user_id=recipient.id,
        recipient_username=recipient.username,
        content=message.content,
        created_at=message.created_at,
        read_at=message.read_at,
    )


@app.get("/api/tournaments", response_model=list[TournamentResponse])
def list_tournaments(
    db: Session = Depends(get_db)
):
    tournaments = db.query(Tournament).order_by(Tournament.created_at.desc()).all()
    return [
        TournamentResponse(
            id=tournament.id,
            name=tournament.name,
            description=tournament.description,
            gold_prize_pool=tournament.gold_prize_pool,
            starts_at=tournament.starts_at,
            ends_at=tournament.ends_at,
            status=tournament.status.value if hasattr(tournament.status, "value") else tournament.status,
            created_by_user_id=tournament.created_by_user_id,
            created_at=tournament.created_at,
        )
        for tournament in tournaments
    ]


@app.post("/api/admin/tournaments", response_model=TournamentResponse, status_code=status.HTTP_201_CREATED)
def create_tournament(
    payload: TournamentCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    admin = _require_global_admin(db, current_user)
    tournament = Tournament(
        name=payload.name,
        description=payload.description,
        gold_prize_pool=payload.gold_prize_pool,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        status=payload.status,
        created_by_user_id=admin.id,
    )
    db.add(tournament)
    db.commit()
    db.refresh(tournament)
    return TournamentResponse(
        id=tournament.id,
        name=tournament.name,
        description=tournament.description,
        gold_prize_pool=tournament.gold_prize_pool,
        starts_at=tournament.starts_at,
        ends_at=tournament.ends_at,
        status=tournament.status.value if hasattr(tournament.status, "value") else tournament.status,
        created_by_user_id=tournament.created_by_user_id,
        created_at=tournament.created_at,
    )


@app.post("/api/admin/tournaments/{tournament_id}/award")
def award_tournament_gold(
    tournament_id: int,
    payload: TournamentAwardRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    admin = _require_global_admin(db, current_user)
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    total_award = sum(entry.gold_awarded for entry in payload.payouts)
    if total_award > tournament.gold_prize_pool:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Total payout exceeds tournament gold prize pool")

    awarded_users: list[dict] = []
    for entry in payload.payouts:
        user = _get_user_or_404(db, entry.user_id)
        existing = db.query(TournamentPayout).filter(
            TournamentPayout.tournament_id == tournament.id,
            TournamentPayout.user_id == user.id
        ).first()
        if existing:
            continue
        payout = TournamentPayout(
            tournament_id=tournament.id,
            user_id=user.id,
            rank=entry.rank,
            gold_awarded=entry.gold_awarded,
            awarded_by_user_id=admin.id,
        )
        db.add(payout)
        user.gold_coins = int(user.gold_coins or 0) + int(entry.gold_awarded)
        awarded_users.append({
            "user_id": user.id,
            "username": user.username,
            "gold_awarded": entry.gold_awarded,
            "rank": entry.rank,
        })

    tournament.status = "completed"
    db.commit()

    return {
        "message": "Tournament awards processed",
        "tournament_id": tournament.id,
        "awards": awarded_users,
    }


@app.post("/api/feedback", response_model=FeedbackResponse, status_code=status.HTTP_201_CREATED)
def submit_feedback(
    payload: FeedbackCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user = _get_user_or_404(db, current_user.get("user_id"))
    _ensure_not_banned(user)

    chief_complaint = _classify_feedback_complaint(payload.title, payload.description)
    report = FeedbackReport(
        user_id=user.id,
        feedback_type=payload.feedback_type,
        title=payload.title,
        description=payload.description,
        chief_complaint=chief_complaint,
        status="open",
        context=payload.context or {},
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    export_payload = {
        "id": report.id,
        "user_id": user.id,
        "username": user.username,
        "feedback_type": payload.feedback_type,
        "title": payload.title,
        "description": payload.description,
        "chief_complaint": chief_complaint,
        "context": payload.context or {},
        "created_at": report.created_at.isoformat(),
    }
    _write_feedback_to_disk(export_payload)
    _send_feedback_notification_email(
        subject=f"[Poker Feedback] {payload.feedback_type.value}: {payload.title}",
        body=json.dumps(export_payload, indent=2),
    )

    return FeedbackResponse(
        id=report.id,
        feedback_type=report.feedback_type.value if hasattr(report.feedback_type, "value") else report.feedback_type,
        title=report.title,
        description=report.description,
        chief_complaint=report.chief_complaint,
        status=report.status,
        created_at=report.created_at,
    )


@app.get("/api/admin/feedback", response_model=list[FeedbackResponse])
def list_feedback_reports(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    _require_global_admin(db, current_user)
    reports = db.query(FeedbackReport).order_by(FeedbackReport.created_at.desc()).all()
    return [
        FeedbackResponse(
            id=report.id,
            feedback_type=report.feedback_type.value if hasattr(report.feedback_type, "value") else report.feedback_type,
            title=report.title,
            description=report.description,
            chief_complaint=report.chief_complaint,
            status=report.status,
            created_at=report.created_at,
        )
        for report in reports
    ]


@app.get("/api/admin/feedback/complaints", response_model=list[FeedbackComplaintBucket])
def feedback_complaint_buckets(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    _require_global_admin(db, current_user)
    rows = (
        db.query(
            FeedbackReport.chief_complaint,
            func.count(FeedbackReport.id).label("count")
        )
        .group_by(FeedbackReport.chief_complaint)
        .order_by(func.count(FeedbackReport.id).desc())
        .all()
    )
    return [
        FeedbackComplaintBucket(chief_complaint=row[0], count=int(row[1]))
        for row in rows
    ]


# ============================================================================
# Create Community Endpoint (for dashboard)
# ============================================================================

@app.post("/api/leagues/{league_id}/communities", response_model=CommunityResponse, status_code=status.HTTP_201_CREATED)
def create_community_in_league(
    league_id: int,
    community_data: CommunityBase | None = Body(default=None),
    name: str | None = None,
    description: str | None = None,
    currency: str | None = None,
    starting_balance: float | None = None,
    _: None = Depends(_require_ui_create_request),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Create a new community within a league.
    The creator becomes the commissioner.
    """
    user_id = current_user.get("user_id")
    if community_data:
        name = community_data.name
        description = community_data.description
        currency = community_data.currency
        if "currency" not in community_data.model_fields_set:
            currency = None
        starting_balance = float(community_data.starting_balance)
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Community name is required"
        )
    if starting_balance is None:
        starting_balance = 1000.0
    
    # Verify league exists
    league = db.query(League).filter(League.id == league_id).first()
    if not league:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="League not found")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if not _is_league_member(db, league_id, user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You must be a member of this league to create a community"
        )
    if not currency:
        currency = league.currency
    # Create community with user as commissioner
    new_community = Community(
        name=name,
        description=description,
        league_id=league_id,
        currency=currency,
        starting_balance=Decimal(str(starting_balance)),
        commissioner_id=user_id
    )
    
    db.add(new_community)
    db.commit()
    db.refresh(new_community)
    
    # Auto-create wallet for the commissioner
    commissioner_wallet = Wallet(
        user_id=user_id,
        community_id=new_community.id,
        balance=Decimal(str(starting_balance))
    )
    db.add(commissioner_wallet)
    db.commit()
    
    return new_community


# ============================================================================
# Email Verification Endpoints (Production Mode)
# ============================================================================

@app.post("/auth/verify-email")
def verify_email(
    email: str,
    verification_code: str,
    db: Session = Depends(get_db)
):
    """
    Verify email with the 6-digit code sent to user's email.
    Only used in production mode.
    """
    # Find pending verification
    verification = db.query(EmailVerification).filter(
        EmailVerification.email == email,
        EmailVerification.verification_code == verification_code,
        EmailVerification.purpose == EMAIL_VERIFICATION_PURPOSE_REGISTRATION,
        EmailVerification.verified == False
    ).first()
    
    if not verification:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid verification code"
        )
    
    if verification.expires_at < datetime.now(verification.expires_at.tzinfo):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification code has expired. Please register again."
        )
    
    # Check if username/email now taken (race condition)
    existing_user = db.query(User).filter(
        (User.username == verification.username) | (User.email == verification.email)
    ).first()
    
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username or email already registered"
        )
    
    # Create the user
    new_user = User(
        username=verification.username,
        email=verification.email,
        hashed_password=verification.hashed_password,
        email_verified=True
    )
    
    db.add(new_user)
    verification.verified = True
    db.commit()
    db.refresh(new_user)
    
    # Create access token
    access_token = _issue_access_token_for_user(new_user)
    
    return {
        "success": True,
        "message": "Email verified successfully",
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": new_user.id,
            "username": new_user.username,
            "email": new_user.email,
            "created_at": new_user.created_at.isoformat() if new_user.created_at else None,
            "is_admin": new_user.is_admin
        }
    }


@app.post("/auth/resend-verification")
def resend_verification(
    email: str,
    db: Session = Depends(get_db)
):
    """
    Resend verification code to email.
    Only used in production mode.
    """
    if not settings.is_production:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email verification is only required in production mode"
        )
    
    # Find pending verification for this email
    verification = db.query(EmailVerification).filter(
        EmailVerification.email == email,
        EmailVerification.purpose == EMAIL_VERIFICATION_PURPOSE_REGISTRATION,
        EmailVerification.verified == False
    ).order_by(EmailVerification.created_at.desc()).first()
    
    if not verification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No pending verification found for this email"
        )
    
    # Generate new code
    new_code = _generate_verification_code()
    verification.verification_code = new_code
    verification.expires_at = datetime.now() + timedelta(minutes=settings.EMAIL_VERIFICATION_EXPIRE_MINUTES)
    db.commit()
    
    # Send email (simplified - in production use proper email service)
    _send_verification_email(email, verification.username, new_code)
    
    return {"message": "Verification code resent to your email"}


def _send_verification_email(email: str, username: str, code: str):
    """Send verification email. In dev mode, just logs the code."""
    if not settings.is_production:
        logger.info(f"[DEV MODE] Verification code for {email}: {code}")
        return
    
    # Production email sending
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    
    if not settings.SMTP_USER or not settings.SMTP_PASSWORD:
        logger.error("SMTP credentials not configured")
        return
    
    msg = MIMEMultipart()
    msg['From'] = settings.EMAIL_FROM
    msg['To'] = email
    msg['Subject'] = "DormStacks - Email Verification"
    
    body = f"""
    Hello {username},
    
    Your verification code is: {code}
    
    This code expires in {settings.EMAIL_VERIFICATION_EXPIRE_MINUTES} minutes.
    
    If you didn't request this, please ignore this email.
    
    - DormStacks Team
    """
    
    msg.attach(MIMEText(body, 'plain'))
    
    try:
        server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT)
        server.starttls()
        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.sendmail(settings.EMAIL_FROM, email, msg.as_string())
        server.quit()
        logger.info(f"Verification email sent to {email}")
    except Exception as e:
        logger.error(f"Failed to send verification email: {e}")


def _send_admin_login_email(email: str, username: str, code: str):
    """Send admin 2FA login verification email."""
    if not settings.is_production:
        logger.info(f"[DEV MODE] Admin login code for {email}: {code}")
        return
    
    # Production email sending
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    
    if not settings.SMTP_USER or not settings.SMTP_PASSWORD:
        logger.error("SMTP credentials not configured")
        return
    
    msg = MIMEMultipart()
    msg['From'] = settings.EMAIL_FROM
    msg['To'] = email
    msg['Subject'] = "DormStacks - Admin Login Verification"
    
    body = f"""
    Hello {username},
    
    You are logging in as an administrator.
    
    Your verification code is: {code}
    
    This code expires in {settings.EMAIL_VERIFICATION_EXPIRE_MINUTES} minutes.
    
    If you didn't attempt to login, please secure your account immediately.
    
    - DormStacks Team
    """
    
    msg.attach(MIMEText(body, 'plain'))
    
    try:
        server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT)
        server.starttls()
        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.sendmail(settings.EMAIL_FROM, email, msg.as_string())
        server.quit()
        logger.info(f"Admin login verification email sent to {email}")
    except Exception as e:
        logger.error(f"Failed to send admin login email: {e}")


def _send_account_recovery_email(email: str, username: str, code: str):
    """Send account recovery verification email."""
    if not settings.is_production:
        logger.info(f"[DEV MODE] Account recovery code for {email}: {code}")
        return

    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    if not settings.SMTP_USER or not settings.SMTP_PASSWORD:
        logger.error("SMTP credentials not configured")
        return

    msg = MIMEMultipart()
    msg['From'] = settings.EMAIL_FROM
    msg['To'] = email
    msg['Subject'] = "DormStacks - Account Recovery Verification"

    body = f"""
    Hello {username},

    We received a request to recover your account.

    Your verification code is: {code}

    This code expires in {settings.EMAIL_VERIFICATION_EXPIRE_MINUTES} minutes.

    If you did not request this, you can ignore this email.

    - DormStacks Team
    """

    msg.attach(MIMEText(body, 'plain'))

    try:
        server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT)
        server.starttls()
        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.sendmail(settings.EMAIL_FROM, email, msg.as_string())
        server.quit()
        logger.info(f"Account recovery email sent to {email}")
    except Exception as e:
        logger.error(f"Failed to send account recovery email: {e}")


# ============================================================================
# Profile Update Endpoints
# ============================================================================

@app.get("/api/profile", response_model=UserResponse)
def get_profile(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get current user's profile"""
    user = db.query(User).filter(User.id == current_user["user_id"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@app.post("/api/profile/request-update")
def request_profile_update(
    update_data: ProfileUpdateRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Request a profile update. Sends verification code to current email.
    User must verify before changes are applied.
    """
    user = db.query(User).filter(User.id == current_user["user_id"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not verify_password(update_data.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    
    # Validate that at least one field is being updated
    if not update_data.new_username and not update_data.new_email and not update_data.new_password:
        raise HTTPException(
            status_code=400,
            detail="At least one field (username, email, or password) must be provided"
        )

    metadata: dict[str, str] = {}

    # Check if new username is already taken
    if update_data.new_username and update_data.new_username != user.username:
        existing_user = db.query(User).filter(User.username == update_data.new_username).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Username already taken")
        metadata["new_username"] = update_data.new_username
    
    # Check if new email is already taken
    if update_data.new_email and update_data.new_email != user.email:
        existing_user = db.query(User).filter(User.email == update_data.new_email).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Email already in use")
        metadata["new_email"] = str(update_data.new_email)

    if update_data.new_password:
        if verify_password(update_data.new_password, user.hashed_password):
            raise HTTPException(status_code=400, detail="New password must be different from current password")
        metadata["new_hashed_password"] = get_password_hash(update_data.new_password)

    if not metadata:
        raise HTTPException(
            status_code=400,
            detail="No changes detected"
        )

    verification = _create_email_verification(
        db,
        email=user.email,
        username=user.username,
        hashed_password=user.hashed_password,
        purpose=EMAIL_VERIFICATION_PURPOSE_PROFILE_UPDATE,
        user_id=user.id,
        verification_metadata=metadata,
    )
    
    # Send verification email (in dev mode, just log it)
    if settings.is_production:
        send_profile_update_email(user.email, user.username, verification.verification_code)
    else:
        logger.info(
            "[DEV MODE] Profile update verification code for %s: %s",
            user.email,
            verification.verification_code,
        )
    
    return ProfileUpdateInitResponse(
        message="Verification code sent to your email",
        requires_verification=True,
        verification_sent_to=user.email
    )


@app.post("/api/profile/verify-update")
def verify_profile_update(
    verify_data: ProfileUpdateVerifyRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Verify profile update with code and apply changes.
    """
    user = db.query(User).filter(User.id == current_user["user_id"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Find the verification record
    verification = db.query(EmailVerification).filter(
        EmailVerification.user_id == user.id,
        EmailVerification.verification_code == verify_data.verification_code,
        EmailVerification.purpose == EMAIL_VERIFICATION_PURPOSE_PROFILE_UPDATE,
        EmailVerification.verified == False
    ).first()
    
    if not verification:
        raise HTTPException(status_code=400, detail="Invalid verification code")
    
    if verification.expires_at < datetime.now(verification.expires_at.tzinfo):
        raise HTTPException(status_code=400, detail="Verification code has expired")
    
    metadata = verification.verification_metadata if isinstance(verification.verification_metadata, dict) else {}
    pending_username = metadata.get("new_username")
    pending_email = metadata.get("new_email")
    pending_hashed_password = metadata.get("new_hashed_password")

    if pending_username and pending_username != user.username:
        existing = db.query(User).filter(
            User.username == pending_username,
            User.id != user.id,
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Username already taken")
        user.username = pending_username

    if pending_email and pending_email != user.email:
        existing = db.query(User).filter(
            User.email == pending_email,
            User.id != user.id,
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already in use")
        user.email = pending_email

    if isinstance(pending_hashed_password, str) and pending_hashed_password:
        user.hashed_password = pending_hashed_password
    
    # Mark verification as used
    verification.verified = True
    verification.verification_metadata = None
    db.commit()
    db.refresh(user)

    new_token = _issue_access_token_for_user(user)
    
    return ProfileUpdateResponse(
        success=True,
        message="Profile updated successfully",
        user=UserResponse.model_validate(user),
        access_token=new_token,
        email=user.email,
    )


def send_profile_update_email(email: str, username: str, code: str):
    """Send profile update verification email"""
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    
    msg = MIMEMultipart()
    msg['From'] = settings.EMAIL_FROM
    msg['To'] = email
    msg['Subject'] = 'Profile Update Verification - DormStacks'
    
    body = f"""
    Hello {username},
    
    You requested to update your profile. Your verification code is: {code}
    
    This code expires in {settings.EMAIL_VERIFICATION_EXPIRE_MINUTES} minutes.
    
    If you didn't request this change, please secure your account immediately.
    
    - DormStacks Team
    """
    
    msg.attach(MIMEText(body, 'plain'))
    
    try:
        server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT)
        server.starttls()
        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.sendmail(settings.EMAIL_FROM, email, msg.as_string())
        server.quit()
        logger.info(f"Profile update verification email sent to {email}")
    except Exception as e:
        logger.error(f"Failed to send profile update verification email: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

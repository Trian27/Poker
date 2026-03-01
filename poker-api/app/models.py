"""
Database models for the Poker Platform
"""
from sqlalchemy import (
    Column,
    Integer,
    String,
    ForeignKey,
    DateTime,
    Numeric,
    Boolean,
    Enum,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base
import enum
import uuid


class User(Base):
    """User accounts for the poker platform"""
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    is_active = Column(Boolean, default=True)
    email_verified = Column(Boolean, default=False)
    is_admin = Column(Boolean, default=False)  # Admin can create leagues
    is_banned = Column(Boolean, default=False)
    gold_coins = Column(Integer, default=0, nullable=False)
    creator_cash_pending_cents = Column(Integer, default=0, nullable=False)
    creator_cash_paid_cents = Column(Integer, default=0, nullable=False)
    creator_payout_email = Column(String(255), nullable=True)
    
    # Relationships
    owned_leagues = relationship("League", back_populates="owner")
    wallets = relationship("Wallet", back_populates="user")


class League(Base):
    """Top-level organizations (e.g., 'Friday Night Poker Club')"""
    __tablename__ = "leagues"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(String(500))
    currency = Column(String(10), nullable=False, default="chips")
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    owner = relationship("User", back_populates="owned_leagues")
    communities = relationship("Community", back_populates="league", cascade="all, delete-orphan")


class LeagueMember(Base):
    """League membership records."""
    __tablename__ = "league_members"

    id = Column(Integer, primary_key=True, index=True)
    league_id = Column(Integer, ForeignKey("leagues.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    league = relationship("League")
    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        UniqueConstraint("league_id", "user_id", name="uq_league_member"),
    )


class Community(Base):
    """Sub-groups within leagues with separate currencies"""
    __tablename__ = "communities"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(String(500))
    league_id = Column(Integer, ForeignKey("leagues.id"), nullable=False)
    currency = Column(String(10), nullable=False, default="chips")
    starting_balance = Column(Numeric(precision=15, scale=2), default=1000.00)
    commissioner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    league = relationship("League", back_populates="communities")
    commissioner = relationship("User", foreign_keys=[commissioner_id])
    wallets = relationship("Wallet", back_populates="community", cascade="all, delete-orphan")
    tables = relationship("Table", back_populates="community", cascade="all, delete-orphan")


class LeagueAdmin(Base):
    """League-level admins (separate from global admins)."""
    __tablename__ = "league_admins"

    id = Column(Integer, primary_key=True, index=True)
    league_id = Column(Integer, ForeignKey("leagues.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    invited_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    league = relationship("League")
    user = relationship("User", foreign_keys=[user_id])
    invited_by = relationship("User", foreign_keys=[invited_by_user_id])

    __table_args__ = (
        UniqueConstraint("league_id", "user_id", name="uq_league_admin"),
    )


class CommunityAdmin(Base):
    """Community-level admins (separate from global admins)."""
    __tablename__ = "community_admins"

    id = Column(Integer, primary_key=True, index=True)
    community_id = Column(Integer, ForeignKey("communities.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    invited_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    community = relationship("Community")
    user = relationship("User", foreign_keys=[user_id])
    invited_by = relationship("User", foreign_keys=[invited_by_user_id])

    __table_args__ = (
        UniqueConstraint("community_id", "user_id", name="uq_community_admin"),
    )


class TableStatus(str, enum.Enum):
    """Status of a poker table"""
    WAITING = "waiting"
    PLAYING = "playing"
    FINISHED = "finished"


class GameType(str, enum.Enum):
    """Type of poker game"""
    CASH = "cash"
    TOURNAMENT = "tournament"


class TableTournamentState(str, enum.Enum):
    """Lifecycle state for table-scoped tournaments."""
    SCHEDULED = "scheduled"
    WAITING_FOR_PLAYERS = "waiting_for_players"
    AWAITING_CONFIRMATIONS = "awaiting_confirmations"
    RUNNING = "running"
    COMPLETED = "completed"
    CANCELED = "canceled"


class Table(Base):
    """Poker tables within communities"""
    __tablename__ = "tables"
    
    id = Column(Integer, primary_key=True, index=True)
    community_id = Column(Integer, ForeignKey("communities.id"), nullable=False)
    name = Column(String(100), nullable=False)
    status = Column(Enum(TableStatus), default=TableStatus.WAITING, nullable=False)
    game_type = Column(Enum(GameType), default=GameType.CASH, nullable=False)
    max_seats = Column(Integer, default=8, nullable=False)
    small_blind = Column(Integer, default=10, nullable=False)
    big_blind = Column(Integer, default=20, nullable=False)
    buy_in = Column(Integer, default=1000, nullable=False)  # For tournaments, this is entry fee; for cash, minimum buy-in
    is_permanent = Column(Boolean, default=False, nullable=False)  # Permanent tables stay visible when empty
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)  # Track who created the table
    max_queue_size = Column(Integer, default=10, nullable=False)  # Maximum players in queue (0 = no queue)
    action_timeout_seconds = Column(Integer, default=30, nullable=False)  # Time limit for player actions in seconds
    agents_allowed = Column(Boolean, default=True, nullable=False)  # Whether autonomous agents (bots) can join
    tournament_start_time = Column(DateTime(timezone=True), nullable=True)
    tournament_starting_stack = Column(Integer, default=1000, nullable=False)
    tournament_security_deposit = Column(Integer, default=0, nullable=False)
    tournament_confirmation_window_seconds = Column(Integer, default=60, nullable=False)
    tournament_confirmation_deadline = Column(DateTime(timezone=True), nullable=True)
    tournament_blind_interval_minutes = Column(Integer, default=10, nullable=False)
    tournament_blind_progression_percent = Column(Integer, default=50, nullable=False)
    tournament_state = Column(String(30), nullable=True)
    tournament_payout = Column(JSONB, nullable=True)
    tournament_payout_is_percentage = Column(Boolean, default=True, nullable=False)
    tournament_prize_pool = Column(Integer, nullable=False, default=0)
    tournament_bracket = Column(JSONB, nullable=True)
    tournament_started_at = Column(DateTime(timezone=True), nullable=True)
    tournament_completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    community = relationship("Community", back_populates="tables")
    seats = relationship("TableSeat", back_populates="table", cascade="all, delete-orphan")
    creator = relationship("User")
    queue = relationship("TableQueue", back_populates="table", cascade="all, delete-orphan", order_by="TableQueue.position")


class TableSeat(Base):
    """Individual seats at a poker table"""
    __tablename__ = "table_seats"
    
    id = Column(Integer, primary_key=True, index=True)
    table_id = Column(Integer, ForeignKey("tables.id", ondelete="CASCADE"), nullable=False)
    seat_number = Column(Integer, nullable=False)  # 1, 2, 3, etc.
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # NULL = available
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    occupied_at = Column(DateTime(timezone=True), nullable=True)  # When user sat down
    
    # Relationships
    table = relationship("Table", back_populates="seats")
    user = relationship("User")
    
    # Unique constraint: one seat number per table, one user per table
    __table_args__ = (
        {"schema": None},
    )


class Wallet(Base):
    """Player's balance in a specific community (isolated currency)"""
    __tablename__ = "wallets"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    community_id = Column(Integer, ForeignKey("communities.id"), nullable=False)
    balance = Column(Numeric(precision=15, scale=2), default=0.00, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="wallets")
    community = relationship("Community", back_populates="wallets")
    
    # Unique constraint: one wallet per user per community
    __table_args__ = (
        {"schema": None},
    )


class HandHistory(Base):
    """Historical record of completed poker hands"""
    __tablename__ = "hand_history"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    community_id = Column(Integer, ForeignKey("communities.id"), nullable=False)
    table_id = Column(Integer, ForeignKey("tables.id"), nullable=True)  # NULL if table deleted
    table_name = Column(String(100), nullable=False)  # Denormalized for history
    played_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # JSONB stores the entire hand data: players, actions, cards, winner, pot, etc.
    # This is indexed and queryable in PostgreSQL
    hand_data = Column(JSONB, nullable=False)
    
    # Relationships
    community = relationship("Community")
    table = relationship("Table")


class TableSession(Base):
    """A user's table session from join to leave."""
    __tablename__ = "table_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    table_id = Column(Integer, ForeignKey("tables.id", ondelete="SET NULL"), nullable=True)
    community_id = Column(Integer, ForeignKey("communities.id", ondelete="CASCADE"), nullable=False)
    table_name = Column(String(100), nullable=False)
    buy_in_amount = Column(Integer, nullable=False, default=0)
    joined_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    left_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    user = relationship("User")
    table = relationship("Table")
    community = relationship("Community")


class SessionHand(Base):
    """Link table sessions to hand history rows (many-to-many)."""
    __tablename__ = "session_hands"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("table_sessions.id", ondelete="CASCADE"), nullable=False)
    hand_id = Column(UUID(as_uuid=True), ForeignKey("hand_history.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    session = relationship("TableSession")
    hand = relationship("HandHistory")

    __table_args__ = (
        UniqueConstraint("session_id", "hand_id", name="uq_session_hand"),
    )


class TournamentRegistrationStatus(str, enum.Enum):
    REGISTERED = "registered"
    CONFIRMED = "confirmed"
    WITHDRAWN = "withdrawn"
    ELIMINATED = "eliminated"
    NO_SHOW = "no_show"


class TournamentRegistration(Base):
    """Player registrations for table-scoped tournaments."""
    __tablename__ = "tournament_registrations"

    id = Column(Integer, primary_key=True, index=True)
    table_id = Column(Integer, ForeignKey("tables.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status = Column(String(20), nullable=False, default=TournamentRegistrationStatus.REGISTERED.value)
    paid_entry_fee = Column(Integer, nullable=False, default=0)
    paid_security_deposit = Column(Integer, nullable=False, default=0)
    starting_stack = Column(Integer, nullable=False, default=1000)
    seed = Column(Integer, nullable=True)
    confirmed_at = Column(DateTime(timezone=True), nullable=True)
    registered_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)

    table = relationship("Table")
    user = relationship("User")

    __table_args__ = (
        UniqueConstraint("table_id", "user_id", name="uq_tournament_registration"),
    )


class TableQueue(Base):
    """Queue for players waiting to join a full table"""
    __tablename__ = "table_queue"
    
    id = Column(Integer, primary_key=True, index=True)
    table_id = Column(Integer, ForeignKey("tables.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    position = Column(Integer, nullable=False)  # Queue position (1 = first in line)
    joined_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    table = relationship("Table", back_populates="queue")
    user = relationship("User")
    
    # Unique constraint: one user per table queue
    __table_args__ = (
        {"schema": None},
    )


class JoinRequestStatus(str, enum.Enum):
    """Status of a join request"""
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"


class JoinRequest(Base):
    """Requests to join a community"""
    __tablename__ = "join_requests"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    community_id = Column(Integer, ForeignKey("communities.id", ondelete="CASCADE"), nullable=False)
    message = Column(String(250), nullable=True)  # Optional description from user
    status = Column(String(20), default="pending", nullable=False)
    custom_starting_balance = Column(Numeric(precision=15, scale=2), nullable=True)
    reviewed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    user = relationship("User", foreign_keys=[user_id])
    community = relationship("Community")
    reviewer = relationship("User", foreign_keys=[reviewed_by_user_id])


class LeagueJoinRequest(Base):
    """Requests to join a league"""
    __tablename__ = "league_join_requests"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    league_id = Column(Integer, ForeignKey("leagues.id", ondelete="CASCADE"), nullable=False)
    message = Column(String(250), nullable=True)
    status = Column(String(20), default="pending", nullable=False)
    reviewed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user = relationship("User", foreign_keys=[user_id])
    league = relationship("League")
    reviewer = relationship("User", foreign_keys=[reviewed_by_user_id])


class InboxMessage(Base):
    """User inbox messages"""
    __tablename__ = "inbox_messages"
    
    id = Column(Integer, primary_key=True, index=True)
    recipient_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    sender_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    message_type = Column(String(50), nullable=False)
    title = Column(String(200), nullable=False)
    content = Column(String, nullable=False)
    message_metadata = Column("metadata", JSONB, nullable=True)  # Renamed to avoid conflict with SQLAlchemy
    is_read = Column(Boolean, default=False)
    is_actionable = Column(Boolean, default=False)
    action_taken = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    read_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    recipient = relationship("User", foreign_keys=[recipient_user_id])
    sender = relationship("User", foreign_keys=[sender_user_id])


class EmailVerification(Base):
    """Pending email verifications for new user registration"""
    __tablename__ = "email_verifications"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(100), nullable=False)
    username = Column(String(50), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    purpose = Column(String(50), nullable=False, default="registration", index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    verification_metadata = Column("metadata", JSONB, nullable=True)
    verification_code = Column(String(6), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    verified = Column(Boolean, default=False)
    user = relationship("User")


class SkinCategory(str, enum.Enum):
    CARDS = "cards"
    TABLE = "table"
    AVATAR = "avatar"
    EMOTE = "emote"
    OTHER = "other"


class SkinSubmissionStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class SkinSubmissionWorkflowState(str, enum.Enum):
    PENDING_ADMIN_REVIEW = "pending_admin_review"
    ADMIN_ACCEPTED_WAITING_CREATOR = "admin_accepted_waiting_creator"
    ADMIN_DECLINED = "admin_declined"
    CREATOR_ACCEPTED_PUBLISHED = "creator_accepted_published"
    CREATOR_DECLINED = "creator_declined"


class Skin(Base):
    """Cosmetic skin definitions listed in the marketplace."""
    __tablename__ = "skins"

    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String(120), unique=True, nullable=False, index=True)
    name = Column(String(120), nullable=False)
    description = Column(String(500), nullable=True)
    category = Column(Enum(SkinCategory), nullable=False)
    price_gold_coins = Column(Integer, nullable=False, default=0)
    design_spec = Column(JSONB, nullable=False)
    preview_url = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    created_by = relationship("User")


class UserSkin(Base):
    """Ownership + equip state of skins for each user."""
    __tablename__ = "user_skins"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    skin_id = Column(Integer, ForeignKey("skins.id", ondelete="CASCADE"), nullable=False)
    is_equipped = Column(Boolean, default=False, nullable=False)
    acquired_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")
    skin = relationship("Skin")

    __table_args__ = (
        UniqueConstraint("user_id", "skin_id", name="uq_user_skin"),
    )


class SkinSubmission(Base):
    """Community-submitted skin definitions awaiting review."""
    __tablename__ = "skin_submissions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(120), nullable=False)
    category = Column(Enum(SkinCategory), nullable=False)
    design_spec = Column(JSONB, nullable=False)
    desired_price_gold_coins = Column(Integer, nullable=False, default=100)
    reference_image_url = Column(String(1000), nullable=True)
    submitter_notes = Column(String(2000), nullable=True)
    status = Column(Enum(SkinSubmissionStatus), nullable=False, default=SkinSubmissionStatus.PENDING)
    workflow_state = Column(String(50), nullable=False, default=SkinSubmissionWorkflowState.PENDING_ADMIN_REVIEW.value)
    review_notes = Column(String(1000), nullable=True)
    admin_proposed_design_spec = Column(JSONB, nullable=True)
    admin_rendered_image_url = Column(String(1000), nullable=True)
    admin_proposed_price_gold_coins = Column(Integer, nullable=True)
    admin_comment = Column(String(2000), nullable=True)
    creator_decision = Column(String(20), nullable=True)
    creator_comment = Column(String(2000), nullable=True)
    creator_responded_at = Column(DateTime(timezone=True), nullable=True)
    finalized_skin_id = Column(Integer, ForeignKey("skins.id"), nullable=True)
    reviewed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", foreign_keys=[user_id])
    reviewed_by = relationship("User", foreign_keys=[reviewed_by_user_id])
    finalized_skin = relationship("Skin", foreign_keys=[finalized_skin_id])


class DirectMessage(Base):
    """Direct user-to-user messages (outside game tables)."""
    __tablename__ = "direct_messages"

    id = Column(Integer, primary_key=True, index=True)
    sender_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    recipient_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    content = Column(String(2000), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    read_at = Column(DateTime(timezone=True), nullable=True)

    sender = relationship("User", foreign_keys=[sender_user_id])
    recipient = relationship("User", foreign_keys=[recipient_user_id])


class PlayerNote(Base):
    """Private notes a user keeps about other users."""
    __tablename__ = "player_notes"

    id = Column(Integer, primary_key=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    target_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    notes = Column(String(2000), nullable=False, default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    owner = relationship("User", foreign_keys=[owner_user_id])
    target = relationship("User", foreign_keys=[target_user_id])

    __table_args__ = (
        UniqueConstraint("owner_user_id", "target_user_id", name="uq_player_note_owner_target"),
    )


class CoinPurchaseIntentStatus(str, enum.Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELED = "canceled"


class CoinPurchaseIntent(Base):
    """Payment intent placeholder for buying gold coins with real money."""
    __tablename__ = "coin_purchase_intents"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    provider = Column(String(50), nullable=False, default="stripe")
    package_key = Column(String(50), nullable=False)
    gold_coins = Column(Integer, nullable=False)
    usd_cents = Column(Integer, nullable=False)
    status = Column(Enum(CoinPurchaseIntentStatus), nullable=False, default=CoinPurchaseIntentStatus.PENDING)
    provider_reference = Column(String(255), nullable=True)
    intent_metadata = Column("metadata", JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User")


class CreatorPayoutStatus(str, enum.Enum):
    PENDING = "pending"
    PAID = "paid"
    REJECTED = "rejected"


class CreatorPayoutRequest(Base):
    """Creator cash-out requests for marketplace royalties."""
    __tablename__ = "creator_payout_requests"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    amount_cents = Column(Integer, nullable=False)
    payout_email = Column(String(255), nullable=False)
    status = Column(Enum(CreatorPayoutStatus), nullable=False, default=CreatorPayoutStatus.PENDING)
    processor_note = Column(String(2000), nullable=True)
    payout_reference = Column(String(255), nullable=True)
    processed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    requested_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    processed_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", foreign_keys=[user_id])
    processed_by = relationship("User", foreign_keys=[processed_by_user_id])


class TournamentStatus(str, enum.Enum):
    DRAFT = "draft"
    ANNOUNCED = "announced"
    RUNNING = "running"
    COMPLETED = "completed"
    CANCELED = "canceled"


class Tournament(Base):
    """Global-admin-managed tournaments awarding gold coins."""
    __tablename__ = "tournaments"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    description = Column(String(1000), nullable=True)
    gold_prize_pool = Column(Integer, nullable=False)
    starts_at = Column(DateTime(timezone=True), nullable=True)
    ends_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(Enum(TournamentStatus), nullable=False, default=TournamentStatus.ANNOUNCED)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    created_by = relationship("User")


class TournamentPayout(Base):
    """Gold coin awards for tournament winners."""
    __tablename__ = "tournament_payouts"

    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    rank = Column(Integer, nullable=True)
    gold_awarded = Column(Integer, nullable=False)
    awarded_at = Column(DateTime(timezone=True), server_default=func.now())
    awarded_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    tournament = relationship("Tournament")
    user = relationship("User", foreign_keys=[user_id])
    awarded_by = relationship("User", foreign_keys=[awarded_by_user_id])

    __table_args__ = (
        UniqueConstraint("tournament_id", "user_id", name="uq_tournament_payout"),
    )


class FeedbackType(str, enum.Enum):
    BUG = "bug"
    FEEDBACK = "feedback"


class FeedbackReport(Base):
    """User-submitted product feedback and bug reports."""
    __tablename__ = "feedback_reports"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    feedback_type = Column(Enum(FeedbackType), nullable=False)
    title = Column(String(200), nullable=False)
    description = Column(String(5000), nullable=False)
    chief_complaint = Column(String(100), nullable=False, default="other")
    status = Column(String(30), nullable=False, default="open")
    context = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")

"""
Database models for the Poker Platform
"""
from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Numeric, Boolean, Enum, UniqueConstraint
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
    
    # Relationships
    owned_leagues = relationship("League", back_populates="owner")
    wallets = relationship("Wallet", back_populates="user")


class League(Base):
    """Top-level organizations (e.g., 'Friday Night Poker Club')"""
    __tablename__ = "leagues"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(String(500))
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


class Table(Base):
    """Poker tables within communities"""
    __tablename__ = "tables"
    
    id = Column(Integer, primary_key=True, index=True)
    community_id = Column(Integer, ForeignKey("communities.id"), nullable=False)
    name = Column(String(100), nullable=False)
    status = Column(Enum(TableStatus), default=TableStatus.WAITING, nullable=False)
    game_type = Column(Enum(GameType), default=GameType.CASH, nullable=False)
    max_seats = Column(Integer, default=9, nullable=False)
    small_blind = Column(Integer, default=10, nullable=False)
    big_blind = Column(Integer, default=20, nullable=False)
    buy_in = Column(Integer, default=1000, nullable=False)  # For tournaments, this is entry fee; for cash, minimum buy-in
    is_permanent = Column(Boolean, default=False, nullable=False)  # Permanent tables stay visible when empty
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)  # Track who created the table
    max_queue_size = Column(Integer, default=10, nullable=False)  # Maximum players in queue (0 = no queue)
    action_timeout_seconds = Column(Integer, default=30, nullable=False)  # Time limit for player actions in seconds
    agents_allowed = Column(Boolean, default=True, nullable=False)  # Whether autonomous agents (bots) can join
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
    verification_code = Column(String(6), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    verified = Column(Boolean, default=False)

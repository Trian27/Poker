"""
Pydantic schemas for request/response validation
"""
from pydantic import BaseModel, EmailStr, Field, ConfigDict
from datetime import datetime
from decimal import Decimal
from typing import Optional
from enum import Enum


# ============================================================================
# Enums
# ============================================================================

class TableStatus(str, Enum):
    """Status of a poker table"""
    WAITING = "waiting"
    PLAYING = "playing"
    FINISHED = "finished"


class GameType(str, Enum):
    """Type of poker game"""
    CASH = "cash"
    TOURNAMENT = "tournament"


# ============================================================================
# User Schemas
# ============================================================================

class UserBase(BaseModel):
    """Base user schema"""
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr


class UserCreate(UserBase):
    """Schema for creating a new user"""
    password: str = Field(..., min_length=8, max_length=100)


class UserResponse(UserBase):
    """Schema for user responses"""
    id: int
    created_at: datetime
    is_active: bool
    
    model_config = ConfigDict(from_attributes=True)


class Token(BaseModel):
    """JWT token response"""
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    """Data contained in JWT token"""
    user_id: int
    username: str


class AdminInviteRequest(BaseModel):
    """Invite a user to be a league/community admin."""
    username: Optional[str] = None
    email: Optional[EmailStr] = None


class AdminUserResponse(BaseModel):
    """Response schema for admin users."""
    id: int
    username: str
    email: EmailStr


# ============================================================================
# League Schemas
# ============================================================================

class LeagueBase(BaseModel):
    """Base league schema"""
    name: str = Field(..., min_length=3, max_length=100)
    description: Optional[str] = Field(None, max_length=500)


class LeagueCreate(LeagueBase):
    """Schema for creating a new league"""
    pass


class LeagueResponse(LeagueBase):
    """Schema for league responses"""
    id: int
    owner_id: int
    created_at: datetime
    is_member: Optional[bool] = None
    has_pending_request: Optional[bool] = None
    
    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# Community Schemas
# ============================================================================

class CommunityBase(BaseModel):
    """Base community schema"""
    name: str = Field(..., min_length=3, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    starting_balance: Decimal = Field(default=Decimal("1000.00"), ge=0)


class CommunityCreate(CommunityBase):
    """Schema for creating a new community"""
    league_id: int


class CommunityResponse(CommunityBase):
    """Schema for community responses"""
    id: int
    league_id: int
    commissioner_id: Optional[int] = None
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# Wallet Schemas
# ============================================================================

class WalletBase(BaseModel):
    """Base wallet schema"""
    balance: Decimal = Field(default=Decimal("0.00"), ge=0)


class WalletCreate(BaseModel):
    """Schema for creating/joining a wallet"""
    community_id: int


class WalletResponse(WalletBase):
    """Schema for wallet responses"""
    id: int
    user_id: int
    community_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# Table Schemas
# ============================================================================

class TableSeatResponse(BaseModel):
    """Schema for seat information"""
    id: int
    seat_number: int
    user_id: Optional[int] = None
    username: Optional[str] = None  # Will be populated if occupied
    occupied_at: Optional[datetime] = None
    
    model_config = ConfigDict(from_attributes=True)


class TableBase(BaseModel):
    """Base table schema"""
    name: str = Field(..., min_length=3, max_length=100)
    game_type: GameType = Field(default=GameType.CASH)
    max_seats: int = Field(default=9, ge=2, le=10)
    small_blind: int = Field(default=10, gt=0)
    big_blind: int = Field(default=20, gt=0)
    buy_in: int = Field(default=1000, gt=0)


class TableCreate(TableBase):
    """Schema for creating a new table"""
    is_permanent: bool = Field(default=False, description="Whether this table persists when empty (owner-only)")
    max_queue_size: int = Field(default=10, ge=0, le=50, description="Maximum queue size (0 = no queue)")
    action_timeout_seconds: int = Field(default=30, ge=10, le=120, description="Timeout for player actions in seconds")
    agents_allowed: bool = Field(default=True, description="Whether autonomous agents (bots) can join this table")


class TableResponse(TableBase):
    """Schema for table responses"""
    id: int
    community_id: int
    status: TableStatus
    created_at: datetime
    is_permanent: bool
    created_by_user_id: int
    max_queue_size: int
    action_timeout_seconds: int
    agents_allowed: bool
    
    model_config = ConfigDict(from_attributes=True)


class TableJoinRequest(BaseModel):
    """Schema for joining a table"""
    buy_in_amount: int = Field(..., gt=0, description="Amount to buy in with")
    seat_number: int = Field(..., ge=1, description="Seat number to occupy (1-N)")


class SeatPlayerRequest(BaseModel):
    """Internal request to seat a player at a table"""
    table_id: int
    user_id: int
    username: str
    stack: int
    seat_number: int


# ============================================================================
# Internal API Schemas (for game server to call)
# ============================================================================

class WalletOperation(BaseModel):
    """Schema for wallet debit/credit operations"""
    user_id: int
    community_id: int
    amount: Decimal = Field(..., gt=0, description="Amount must be positive")


class WalletOperationResponse(BaseModel):
    """Response from wallet operation"""
    success: bool
    new_balance: Decimal
    message: Optional[str] = None


class TokenVerifyRequest(BaseModel):
    """Request to verify a JWT token"""
    token: str


class TokenVerifyResponse(BaseModel):
    """Response from token verification"""
    valid: bool
    user_id: Optional[int] = None
    username: Optional[str] = None
    message: Optional[str] = None


# ============================================================================
# Hand History Schemas
# ============================================================================

class HandHistoryCreate(BaseModel):
    """Schema for creating a hand history record (internal API)"""
    community_id: int
    table_id: Optional[int] = None
    table_name: str
    hand_data: dict  # JSONB data containing full hand details


class HandHistoryResponse(BaseModel):
    """Schema for hand history responses"""
    id: str  # UUID as string
    community_id: int
    table_id: Optional[int]
    table_name: str
    played_at: datetime
    hand_data: dict
    
    model_config = ConfigDict(from_attributes=True)


class HandHistorySummary(BaseModel):
    """Schema for hand history list (summary without full data)"""
    id: str  # UUID as string
    table_name: str
    played_at: datetime
    pot_size: int  # Extracted from hand_data
    winner_username: Optional[str] = None  # Extracted from hand_data
    player_count: int  # Extracted from hand_data
    
    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# Table Queue Schemas
# ============================================================================

class TableQueuePosition(BaseModel):
    """Schema for queue position response"""
    table_id: int
    user_id: int
    username: str
    position: int
    joined_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


class QueueJoinRequest(BaseModel):
    """Schema for joining a table queue"""
    buy_in_amount: int = Field(..., gt=0, description="Amount to buy in with when seated")


# ============================================================================
# Join Request Schemas
# ============================================================================

class JoinRequestCreate(BaseModel):
    """Schema for creating a join request"""
    community_id: int
    message: Optional[str] = Field(None, max_length=250, description="Optional message to commissioner")


class JoinRequestReview(BaseModel):
    """Schema for reviewing a join request (commissioner)"""
    approved: bool
    custom_starting_balance: Optional[Decimal] = Field(None, ge=0, description="Custom starting balance (optional)")


class JoinRequestResponse(BaseModel):
    """Schema for join request responses"""
    id: int
    user_id: int
    username: str
    community_id: int
    community_name: str
    message: Optional[str]
    status: str
    custom_starting_balance: Optional[Decimal]
    reviewed_by_user_id: Optional[int]
    reviewed_at: Optional[datetime]
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# Inbox Message Schemas
# ============================================================================

class InboxMessageResponse(BaseModel):
    """Schema for inbox message responses"""
    id: int
    sender_username: Optional[str]
    message_type: str
    title: str
    content: str
    metadata: Optional[dict]
    is_read: bool
    is_actionable: bool
    action_taken: Optional[str]
    created_at: datetime
    read_at: Optional[datetime]
    
    model_config = ConfigDict(from_attributes=True)


class InboxMessageAction(BaseModel):
    """Schema for taking action on an inbox message"""
    action: str = Field(..., description="Action to take (e.g., 'approve', 'deny')")
    custom_starting_balance: Optional[Decimal] = Field(None, ge=0)


# ============================================================================
# Email Verification Schemas
# ============================================================================

class EmailVerificationRequest(BaseModel):
    """Schema for verifying email with code"""
    email: str
    verification_code: str = Field(..., min_length=6, max_length=6)


class EmailVerificationResponse(BaseModel):
    """Response after email verification"""
    success: bool
    message: str
    access_token: Optional[str] = None
    token_type: Optional[str] = None


class RegistrationPendingResponse(BaseModel):
    """Response when registration requires email verification"""
    message: str
    requires_verification: bool


# ============================================================================
# Profile Update Schemas
# ============================================================================

class ProfileUpdateRequest(BaseModel):
    """Schema for requesting a profile update (initiates email verification)"""
    new_username: Optional[str] = Field(None, min_length=3, max_length=50)
    new_email: Optional[str] = Field(None, max_length=100)


class ProfileUpdateInitResponse(BaseModel):
    """Response when profile update verification is initiated"""
    message: str
    requires_verification: bool
    verification_sent_to: str


class ProfileUpdateVerifyRequest(BaseModel):
    """Schema for verifying profile update with code"""
    verification_code: str = Field(..., min_length=6, max_length=6)
    new_username: Optional[str] = None
    new_email: Optional[str] = None


class ProfileUpdateResponse(BaseModel):
    """Response after successful profile update"""
    success: bool
    message: str
    user: Optional[UserResponse] = None
    access_token: Optional[str] = None  # New token if email changed
    email: str

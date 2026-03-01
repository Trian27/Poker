"""
Pydantic schemas for request/response validation
"""
from pydantic import BaseModel, EmailStr, Field, ConfigDict
from datetime import datetime
from decimal import Decimal
from typing import Optional, Any
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


class TableTournamentState(str, Enum):
    """State for table-scoped tournaments."""
    SCHEDULED = "scheduled"
    WAITING_FOR_PLAYERS = "waiting_for_players"
    AWAITING_CONFIRMATIONS = "awaiting_confirmations"
    RUNNING = "running"
    COMPLETED = "completed"
    CANCELED = "canceled"


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
    is_banned: bool = False
    gold_coins: int = 0
    
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


class BanStatusRequest(BaseModel):
    """Set a user's ban status."""
    is_banned: bool


class CurrencyUpdateRequest(BaseModel):
    """Update currency code for leagues/communities."""
    currency: str = Field(..., min_length=1, max_length=10)


# ============================================================================
# League Schemas
# ============================================================================

class LeagueBase(BaseModel):
    """Base league schema"""
    name: str = Field(..., min_length=3, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    currency: str = Field(default="chips", max_length=10)


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
    currency: str = Field(default="chips", max_length=10)
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
    max_seats: int = Field(default=8, ge=2, le=8)
    small_blind: int = Field(default=10, gt=0)
    big_blind: int = Field(default=20, gt=0)
    buy_in: int = Field(default=1000, ge=0)
    tournament_start_time: Optional[datetime] = None
    tournament_starting_stack: int = Field(default=1000, ge=100)
    tournament_security_deposit: int = Field(default=0, ge=0)
    tournament_confirmation_window_seconds: int = Field(default=60, ge=30, le=300)
    tournament_blind_interval_minutes: int = Field(default=10, ge=2, le=120)
    tournament_blind_progression_percent: int = Field(default=50, ge=10, le=300)
    tournament_payout: Optional[list[int]] = Field(default=None, description="Optional rank-based payout amounts")
    tournament_payout_is_percentage: bool = Field(default=True, description="Interpret payout values as percentages")


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
    tournament_state: Optional[TableTournamentState] = None
    tournament_confirmation_deadline: Optional[datetime] = None
    tournament_prize_pool: int = 0
    tournament_bracket: Optional[dict[str, Any]] = None
    tournament_started_at: Optional[datetime] = None
    tournament_completed_at: Optional[datetime] = None
    tournament_registration_count: Optional[int] = None
    tournament_is_registered: Optional[bool] = None
    
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
    community_id: Optional[int] = None
    table_name: Optional[str] = None


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


class LearningSessionSummary(BaseModel):
    """Summary of a user's table session."""
    id: int
    table_id: Optional[int] = None
    community_id: int
    table_name: str
    buy_in_amount: int
    joined_at: datetime
    left_at: Optional[datetime] = None
    hand_count: int = 0
    last_hand_at: Optional[datetime] = None


class LearningActionRecommendation(BaseModel):
    action: str
    amount: Optional[int] = None
    score: float
    rationale: str


class LearningCoachRequest(BaseModel):
    """Input snapshot for learning coach recommendations."""
    street: str = Field(..., pattern="^(preflop|flop|turn|river)$")
    hole_cards: list[dict[str, str]]
    community_cards: list[dict[str, str]] = Field(default_factory=list)
    pot: int = Field(..., ge=0)
    to_call: int = Field(default=0, ge=0)
    min_raise: int = Field(default=1, ge=1)
    stack: int = Field(..., ge=0)
    players_in_hand: int = Field(default=2, ge=2, le=10)
    can_check: bool = False
    position: Optional[str] = None


class LearningCoachResponse(BaseModel):
    """Coach output for a decision point."""
    recommended_action: str
    summary: str
    tags: list[str]
    top_actions: list[LearningActionRecommendation]


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


class TournamentRegistrationResponse(BaseModel):
    table_id: int
    user_id: int
    username: str
    paid_entry_fee: int
    paid_security_deposit: int
    starting_stack: int
    status: str
    confirmed_at: Optional[datetime] = None
    registered_at: datetime


class TableTournamentDetailsResponse(BaseModel):
    table_id: int
    table_name: str
    state: TableTournamentState
    start_time: Optional[datetime] = None
    started_at: Optional[datetime] = None
    confirmation_deadline: Optional[datetime] = None
    buy_in: int
    security_deposit: int
    starting_stack: int
    blind_interval_minutes: int
    blind_progression_percent: int
    confirmation_window_seconds: int
    max_players: int
    registration_count: int
    prize_pool: int
    payout: list[int] = Field(default_factory=list)
    payout_is_percentage: bool = True
    bracket: Optional[dict[str, Any]] = None
    can_set_payout: bool = False
    is_registered: bool = False
    is_confirmed: bool = False
    registrations: list[TournamentRegistrationResponse] = Field(default_factory=list)


class TournamentPayoutUpdateRequest(BaseModel):
    payout: list[int] = Field(default_factory=list, max_length=50)
    is_percentage: bool = True


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


class AccountRecoveryRequest(BaseModel):
    """Request account recovery by email."""
    email: EmailStr


class AccountRecoveryVerifyRequest(BaseModel):
    """Verify recovery code and optionally reset password."""
    email: EmailStr
    verification_code: str = Field(..., min_length=6, max_length=6)
    new_password: Optional[str] = Field(None, min_length=8, max_length=100)


class AccountRecoveryVerifyResponse(BaseModel):
    success: bool
    message: str
    username: Optional[str] = None


# ============================================================================
# Profile Update Schemas
# ============================================================================

class ProfileUpdateRequest(BaseModel):
    """Schema for requesting a profile update (initiates email verification)"""
    current_password: str = Field(..., min_length=1, max_length=100)
    new_username: Optional[str] = Field(None, min_length=3, max_length=50)
    new_email: Optional[EmailStr] = None
    new_password: Optional[str] = Field(None, min_length=8, max_length=100)


class ProfileUpdateInitResponse(BaseModel):
    """Response when profile update verification is initiated"""
    message: str
    requires_verification: bool
    verification_sent_to: str


class ProfileUpdateVerifyRequest(BaseModel):
    """Schema for verifying profile update with code"""
    verification_code: str = Field(..., min_length=6, max_length=6)


class ProfileUpdateResponse(BaseModel):
    """Response after successful profile update"""
    success: bool
    message: str
    user: Optional[UserResponse] = None
    access_token: Optional[str] = None  # New token if email changed
    email: Optional[EmailStr] = None


# ============================================================================
# Customization / Marketplace Schemas
# ============================================================================

class SkinCategory(str, Enum):
    CARDS = "cards"
    TABLE = "table"
    AVATAR = "avatar"
    EMOTE = "emote"
    OTHER = "other"


class SkinSubmissionWorkflowState(str, Enum):
    PENDING_ADMIN_REVIEW = "pending_admin_review"
    ADMIN_ACCEPTED_WAITING_CREATOR = "admin_accepted_waiting_creator"
    ADMIN_DECLINED = "admin_declined"
    CREATOR_ACCEPTED_PUBLISHED = "creator_accepted_published"
    CREATOR_DECLINED = "creator_declined"


class SkinDesignSpec(BaseModel):
    """Expected format for skin submissions/import."""
    format_version: int = Field(default=1, ge=1)
    renderer: str = Field(default="web", min_length=1, max_length=50)
    asset_manifest: dict[str, str] = Field(
        default_factory=dict,
        description=(
            "Map of asset keys to URLs/paths. "
            "Cards should include card_front and card_back. "
            "Table skins can include table_felt and table_background."
        ),
    )
    theme_tokens: dict[str, Any] = Field(default_factory=dict, description="Color/shape/font tokens")
    notes: Optional[str] = Field(default=None, max_length=2000)


class SkinCreate(BaseModel):
    slug: str = Field(..., min_length=3, max_length=120)
    name: str = Field(..., min_length=3, max_length=120)
    description: Optional[str] = Field(None, max_length=500)
    category: SkinCategory
    price_gold_coins: int = Field(default=0, ge=0)
    design_spec: SkinDesignSpec
    preview_url: Optional[str] = Field(None, max_length=500)
    is_active: bool = True


class SkinResponse(BaseModel):
    id: int
    slug: str
    name: str
    description: Optional[str]
    category: SkinCategory
    price_gold_coins: int
    design_spec: dict[str, Any]
    preview_url: Optional[str]
    is_active: bool
    created_by_user_id: Optional[int] = None
    created_at: datetime


class UserSkinResponse(BaseModel):
    skin_id: int
    is_equipped: bool
    acquired_at: datetime
    skin: SkinResponse


class EquipSkinRequest(BaseModel):
    equip: bool = True


class SkinSubmissionCreate(BaseModel):
    name: str = Field(..., min_length=3, max_length=120)
    category: SkinCategory
    desired_price_gold_coins: int = Field(..., ge=1, le=1_000_000)
    reference_image_url: Optional[str] = Field(None, max_length=1000)
    submitter_notes: Optional[str] = Field(None, max_length=2000)
    design_spec: Optional[SkinDesignSpec] = None


class SkinSubmissionReview(BaseModel):
    action: Optional[str] = Field(default=None, pattern="^(accept|decline)$")
    approved: Optional[bool] = None  # Backward compatibility with previous API shape
    review_notes: Optional[str] = Field(None, max_length=1000)
    publish_slug: Optional[str] = Field(None, min_length=3, max_length=120)
    publish_price_gold_coins: Optional[int] = Field(default=None, ge=0, le=1_000_000)
    publish_preview_url: Optional[str] = Field(None, max_length=1000)
    proposed_design_spec: Optional[SkinDesignSpec] = None


class SkinSubmissionCreatorDecision(BaseModel):
    accept: bool
    creator_comment: Optional[str] = Field(None, max_length=2000)


class SkinSubmissionResponse(BaseModel):
    id: int
    user_id: int
    username: str
    name: str
    category: SkinCategory
    design_spec: dict[str, Any]
    desired_price_gold_coins: int
    reference_image_url: Optional[str]
    submitter_notes: Optional[str]
    status: str
    workflow_state: SkinSubmissionWorkflowState
    review_notes: Optional[str]
    admin_proposed_design_spec: Optional[dict[str, Any]]
    admin_rendered_image_url: Optional[str]
    admin_proposed_price_gold_coins: Optional[int]
    admin_comment: Optional[str]
    creator_decision: Optional[str]
    creator_comment: Optional[str]
    creator_responded_at: Optional[datetime]
    finalized_skin_id: Optional[int]
    reviewed_by_user_id: Optional[int]
    reviewed_at: Optional[datetime]
    created_at: datetime


class GoldBalanceResponse(BaseModel):
    gold_coins: int


class MarketplacePurchaseResponse(BaseModel):
    success: bool
    message: str
    gold_coins: int
    skin_id: Optional[int] = None
    creator_royalty_coins: Optional[int] = None
    creator_royalty_usd_cents: Optional[int] = None


class CoinPurchaseIntentCreate(BaseModel):
    package_key: str = Field(..., min_length=1, max_length=50)


class CoinPurchaseIntentResponse(BaseModel):
    id: int
    provider: str
    package_key: str
    gold_coins: int
    usd_cents: int
    status: str
    provider_reference: Optional[str]
    checkout_url: Optional[str] = None
    created_at: datetime


class CreatorEarningsResponse(BaseModel):
    pending_cents: int
    paid_cents: int
    total_cents: int
    payout_email: Optional[EmailStr] = None


class CreatorPayoutProfileUpdateRequest(BaseModel):
    payout_email: EmailStr


class CreatorPayoutRequestCreate(BaseModel):
    amount_cents: Optional[int] = Field(default=None, ge=1)


class CreatorPayoutRequestResponse(BaseModel):
    id: int
    amount_cents: int
    payout_email: EmailStr
    status: str
    processor_note: Optional[str] = None
    payout_reference: Optional[str] = None
    processed_by_user_id: Optional[int] = None
    requested_at: datetime
    processed_at: Optional[datetime] = None


class CreatorPayoutProcessRequest(BaseModel):
    action: str = Field(..., pattern="^(mark_paid|reject)$")
    processor_note: Optional[str] = Field(default=None, max_length=2000)
    payout_reference: Optional[str] = Field(default=None, max_length=255)


# ============================================================================
# Direct Message Schemas
# ============================================================================

class PlayerNoteUpsertRequest(BaseModel):
    notes: str = Field(default="", max_length=2000)


class PlayerNoteResponse(BaseModel):
    target_user_id: int
    target_username: str
    notes: str
    updated_at: Optional[datetime] = None


class DirectMessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000)


class DirectMessageResponse(BaseModel):
    id: int
    sender_user_id: int
    sender_username: str
    recipient_user_id: int
    recipient_username: str
    content: str
    created_at: datetime
    read_at: Optional[datetime]


class ConversationSummaryResponse(BaseModel):
    user_id: int
    username: str
    last_message: str
    last_message_at: datetime
    unread_count: int


# ============================================================================
# Tournament Schemas
# ============================================================================

class TournamentStatus(str, Enum):
    DRAFT = "draft"
    ANNOUNCED = "announced"
    RUNNING = "running"
    COMPLETED = "completed"
    CANCELED = "canceled"


class TournamentCreate(BaseModel):
    name: str = Field(..., min_length=3, max_length=120)
    description: Optional[str] = Field(None, max_length=1000)
    gold_prize_pool: int = Field(..., gt=0)
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    status: TournamentStatus = TournamentStatus.ANNOUNCED


class TournamentResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    gold_prize_pool: int
    starts_at: Optional[datetime]
    ends_at: Optional[datetime]
    status: TournamentStatus
    created_by_user_id: int
    created_at: datetime


class TournamentAwardEntry(BaseModel):
    user_id: int
    gold_awarded: int = Field(..., gt=0)
    rank: Optional[int] = Field(default=None, ge=1)


class TournamentAwardRequest(BaseModel):
    payouts: list[TournamentAwardEntry] = Field(..., min_length=1, max_length=50)


# ============================================================================
# Feedback Schemas
# ============================================================================

class FeedbackType(str, Enum):
    BUG = "bug"
    FEEDBACK = "feedback"


class FeedbackCreate(BaseModel):
    feedback_type: FeedbackType
    title: str = Field(..., min_length=3, max_length=200)
    description: str = Field(..., min_length=10, max_length=5000)
    context: Optional[dict[str, Any]] = None


class FeedbackResponse(BaseModel):
    id: int
    feedback_type: FeedbackType
    title: str
    description: str
    chief_complaint: str
    status: str
    created_at: datetime


class FeedbackComplaintBucket(BaseModel):
    chief_complaint: str
    count: int

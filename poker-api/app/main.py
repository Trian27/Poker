"""
Main FastAPI application with all routes
"""
from fastapi import FastAPI, Depends, HTTPException, status, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import or_
from sqlalchemy.orm import Session
from decimal import Decimal

from .config import settings
from .database import get_db, SessionLocal
from .models import (
    User, League, Community, Wallet, Table, TableStatus, HandHistory, TableSeat, TableQueue,
    LeagueAdmin, CommunityAdmin, LeagueMember, LeagueJoinRequest
)
from .schema_migrations import ensure_schema
from .schemas import (
    UserCreate, UserResponse, Token,
    AdminInviteRequest, AdminUserResponse,
    LeagueCreate, LeagueResponse,
    CommunityBase, CommunityCreate, CommunityResponse,
    WalletCreate, WalletResponse,
    TableCreate, TableResponse, TableJoinRequest, SeatPlayerRequest, TableSeatResponse,
    WalletOperation, WalletOperationResponse,
    TokenVerifyRequest, TokenVerifyResponse,
    HandHistoryCreate, HandHistoryResponse, HandHistorySummary,
    TableQueuePosition, QueueJoinRequest
)
from .auth import (
    get_password_hash, verify_password,
    create_access_token, decode_token
)
import httpx
import logging

logger = logging.getLogger(__name__)

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
    from .models import EmailVerification
    from datetime import datetime, timedelta
    import random
    
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
        # Check if pending verification exists
        existing_verification = db.query(EmailVerification).filter(
            EmailVerification.email == user_data.email,
            EmailVerification.verified == False
        ).first()
        
        if existing_verification:
            # Update existing verification
            verification_code = str(random.randint(100000, 999999))
            existing_verification.username = user_data.username
            existing_verification.hashed_password = hashed_password
            existing_verification.verification_code = verification_code
            existing_verification.expires_at = datetime.now() + timedelta(minutes=settings.EMAIL_VERIFICATION_EXPIRE_MINUTES)
            db.commit()
        else:
            # Create new verification
            verification_code = str(random.randint(100000, 999999))
            verification = EmailVerification(
                email=user_data.email,
                username=user_data.username,
                hashed_password=hashed_password,
                verification_code=verification_code,
                expires_at=datetime.now() + timedelta(minutes=settings.EMAIL_VERIFICATION_EXPIRE_MINUTES)
            )
            db.add(verification)
            db.commit()
        
        # Send verification email
        _send_verification_email(user_data.email, user_data.username, verification_code)
        
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
    from .models import EmailVerification
    from datetime import datetime, timedelta
    import random
    
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
        # Generate verification code
        verification_code = str(random.randint(100000, 999999))
        
        # Delete any existing pending verifications for this user
        db.query(EmailVerification).filter(
            EmailVerification.email == user.email,
            EmailVerification.verified == False
        ).delete()
        
        # Create new verification record
        verification = EmailVerification(
            email=user.email,
            username=user.username,
            hashed_password=user.hashed_password,
            verification_code=verification_code,
            expires_at=datetime.now() + timedelta(minutes=settings.EMAIL_VERIFICATION_EXPIRE_MINUTES)
        )
        db.add(verification)
        db.commit()
        
        # Send verification email
        _send_admin_login_email(user.email, user.username, verification_code)
        
        return {
            "requires_2fa": True,
            "message": "Verification code sent to your email",
            "email": user.email,
            "is_admin": True
        }
    
    # Create access token for non-admin or dev mode
    access_token = create_access_token(
        data={"user_id": user.id, "username": user.username}
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "is_admin": user.is_admin
        }
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
    from .models import EmailVerification
    from datetime import datetime
    
    # Find pending verification
    verification = db.query(EmailVerification).filter(
        EmailVerification.email == email,
        EmailVerification.verification_code == verification_code,
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
    access_token = create_access_token(
        data={"user_id": user.id, "username": user.username}
    )
    
    return {
        "success": True,
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "is_admin": user.is_admin
        }
    }


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
    
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "is_admin": user.is_admin
    }


# ============================================================================
# League Endpoints
# ============================================================================

@app.post("/api/leagues", response_model=LeagueResponse, status_code=status.HTTP_201_CREATED)
def create_league(
    league_data: LeagueCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Create a new league
    
    - **name**: League name (3-100 characters)
    - **description**: Optional description
    """
    user_id = current_user.get("user_id")
    
    # Create league
    new_league = League(
        name=league_data.name,
        description=league_data.description,
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
    leagues = db.query(League).all()

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
            "owner_id": league.owner_id,
            "created_at": league.created_at,
            "is_member": is_member,
            "has_pending_request": league.id in pending_ids
        })

    return result


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

    if not _is_league_member(db, league_id, user_id):
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

    # Verify league exists
    league = db.query(League).filter(League.id == community_data.league_id).first()
    if not league:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="League not found"
        )

    if not _is_league_member(db, league.id, user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You must be a member of this league to create a community"
        )

    # Create community
    new_community = Community(
        name=community_data.name,
        description=community_data.description,
        league_id=community_data.league_id,
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
            detail="You must be a league member to join this community"
        )

    if not _is_league_member(db, community.league_id, user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You must be a league member to request to join this community"
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
def list_communities(league_id: int | None = None, db: Session = Depends(get_db)):
    """
    List all communities (optionally filter by league)
    
    - **league_id**: Optional league ID to filter by
    """
    query = db.query(Community)
    
    if league_id:
        query = query.filter(Community.league_id == league_id)
    
    communities = query.all()
    return communities


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

    if not _is_league_member(db, community.league_id, user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You must be a league member to view admins"
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
    # Check if community exists
    community = db.query(Community).filter(Community.id == community_id).first()
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found"
        )

    # Get all tables for this community
    tables = db.query(Table).filter(Table.community_id == community_id).all()
    return tables


@app.post("/api/communities/{community_id}/tables", response_model=TableResponse, status_code=status.HTTP_201_CREATED)
def create_table(
    community_id: int,
    table: TableCreate,
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
    
    # Check if community exists
    community = db.query(Community).filter(Community.id == community_id).first()
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found"
        )
    
    # Check if user is trying to create a permanent table
    if table.is_permanent:
        # Get the league to check ownership
        league = db.query(League).filter(League.id == community.league_id).first()
        if not league or league.owner_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only community owners can create permanent tables"
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
        action_timeout_seconds=table.action_timeout_seconds
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


@app.delete("/api/tables/{table_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_table(
    table_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Delete a table (only community owners can delete tables)
    Requires authentication and ownership
    """
    user_id = current_user.get("user_id")
    
    # Get table
    table = db.query(Table).filter(Table.id == table_id).first()
    if not table:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Table not found"
        )
    
    # Get the community and league to check ownership
    community = db.query(Community).filter(Community.id == table.community_id).first()
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found"
        )
    
    league = db.query(League).filter(League.id == community.league_id).first()
    if not league or league.owner_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only community owners can delete tables"
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
    
    # Delete the table (seats will be cascade deleted)
    db.delete(table)
    db.commit()
    
    logger.info(f"Table {table_id} ({table.name}) deleted by owner {user_id}")
    
    return None


@app.post("/api/tables/{table_id}/queue/join", response_model=TableQueuePosition)
def join_table_queue(
    table_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Join the queue for a full table
    Requires authentication
    """
    user_id = current_user.get("user_id")
    
    # Check if table exists
    table = db.query(Table).filter(Table.id == table_id).first()
    if not table:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Table not found"
        )
    
    # Check if user is already in queue
    existing_queue_entry = db.query(TableQueue).filter(
        TableQueue.table_id == table_id,
        TableQueue.user_id == user_id
    ).first()
    
    if existing_queue_entry:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You are already in the queue for this table"
        )
    
    # Check if user is already seated
    from .models import TableSeat
    seated = db.query(TableSeat).filter(
        TableSeat.table_id == table_id,
        TableSeat.user_id == user_id
    ).first()
    
    if seated:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You are already seated at this table"
        )
    
    # Count current queue size
    current_queue_size = db.query(TableQueue).filter(
        TableQueue.table_id == table_id
    ).count()
    
    # Check if queue is full
    if table.max_queue_size and current_queue_size >= table.max_queue_size:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Queue is full (max {table.max_queue_size} players)"
        )
    
    # Add to queue with next position
    next_position = current_queue_size + 1
    
    from datetime import datetime, timezone
    queue_entry = TableQueue(
        table_id=table_id,
        user_id=user_id,
        position=next_position,
        joined_at=datetime.now(timezone.utc)
    )
    
    db.add(queue_entry)
    db.commit()
    db.refresh(queue_entry)
    
    logger.info(f"User {user_id} joined queue for table {table_id} at position {next_position}")
    
    # Get user name for response
    user = db.query(User).filter(User.id == user_id).first()
    
    return TableQueuePosition(
        id=queue_entry.id,
        table_id=table_id,
        user_id=user_id,
        username=user.username if user else "Unknown",
        position=next_position,
        joined_at=queue_entry.joined_at
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
    
    # Find queue entry
    queue_entry = db.query(TableQueue).filter(
        TableQueue.table_id == table_id,
        TableQueue.user_id == user_id
    ).first()
    
    if not queue_entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You are not in the queue for this table"
        )
    
    removed_position = queue_entry.position
    
    # Remove from queue
    db.delete(queue_entry)
    db.commit()
    
    # Reorder remaining queue entries
    remaining_entries = db.query(TableQueue).filter(
        TableQueue.table_id == table_id,
        TableQueue.position > removed_position
    ).order_by(TableQueue.position).all()
    
    for entry in remaining_entries:
        entry.position -= 1
    
    db.commit()
    
    logger.info(f"User {user_id} left queue for table {table_id} from position {removed_position}")
    
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
    # Check if table exists
    table = db.query(Table).filter(Table.id == table_id).first()
    if not table:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Table not found"
        )
    
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
    # Check if table exists
    table = db.query(Table).filter(Table.id == table_id).first()
    if not table:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Table not found"
        )
    
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
    
    # Step 2: Get table and verify it exists
    table = db.query(Table).filter(Table.id == table_id).first()
    if not table:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Table not found"
        )
    
    # Step 2b: Verify seat number is valid and available
    from .models import TableSeat
    if request.seat_number < 1 or request.seat_number > table.max_seats:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Seat number must be between 1 and {table.max_seats}"
        )
    
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
    
    # Check if user is already seated at this table
    existing_seat = db.query(TableSeat).filter(
        TableSeat.table_id == table_id,
        TableSeat.user_id == user_id
    ).first()
    
    if existing_seat:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"You are already seated at this table in seat {existing_seat.seat_number}"
        )
    
    # Step 3: Validate buy-in amount
    if request.buy_in_amount < table.buy_in:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Buy-in amount must be at least {table.buy_in}"
        )
    
    # Step 4: Find user's wallet for this community
    wallet = db.query(Wallet).filter(
        Wallet.user_id == user_id,
        Wallet.community_id == table.community_id
    ).first()
    
    if not wallet:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You don't have a wallet in this community. Join the community first."
        )
    
    # Step 5: Check sufficient funds
    if wallet.balance < request.buy_in_amount:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient funds. Available: {wallet.balance}, Required: {request.buy_in_amount}"
        )
    
    # Step 6: Debit wallet (critical transaction)
    wallet.balance -= request.buy_in_amount
    
    # Step 6b: Mark seat as occupied
    from sqlalchemy.sql import func
    seat.user_id = user_id
    seat.occupied_at = func.now()
    
    db.commit()
    db.refresh(wallet)
    
    logger.info(f"Debited {request.buy_in_amount} from user {user_id}'s wallet. New balance: {wallet.balance}")
    logger.info(f"User {user_id} occupied seat {request.seat_number} at table {table_id}")
    
    # Step 7: Seat player in game server (internal HTTP call)
    try:
        async with httpx.AsyncClient() as client:
            game_server_url = "http://game-server:3000/_internal/seat-player"
            seat_request = SeatPlayerRequest(
                table_id=table_id,
                user_id=user_id,
                username=username,
                stack=request.buy_in_amount,
                seat_number=request.seat_number
            )
            
            response = await client.post(
                game_server_url,
                json=seat_request.model_dump(),
                timeout=10.0
            )
            
            if response.status_code != 200:
                # Rollback: credit wallet back and free seat
                wallet.balance += request.buy_in_amount
                seat.user_id = None
                seat.occupied_at = None
                db.commit()
                logger.error(f"Failed to seat player. Rolling back wallet debit and seat occupation. Response: {response.text}")
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=f"Failed to join table: {response.text}"
                )
    
    except httpx.RequestError as e:
        # Rollback: credit wallet back and free seat
        wallet.balance += request.buy_in_amount
        seat.user_id = None
        seat.occupied_at = None
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
        "message": f"Successfully joined table with {request.buy_in_amount} chips",
        "new_balance": float(wallet.balance),
        "table_id": table_id
    }


# ============================================================================
# Internal API Endpoints (for Game Server)
# ============================================================================

@app.post("/api/internal/auth/verify", response_model=TokenVerifyResponse)
def verify_token_internal(request: TokenVerifyRequest):
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
    
    return TokenVerifyResponse(
        valid=True,
        user_id=user_id,
        username=username
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
        "action_timeout_seconds": table.action_timeout_seconds,
        "max_queue_size": table.max_queue_size
    }


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
    
    # Table is non-permanent and empty, delete it
    db.delete(table)
    db.commit()
    
    logger.info(f"Deleted non-permanent table {table_id} ({table.name})")
    
    return {"deleted": True, "message": f"Table {table_id} deleted"}


@app.post("/api/internal/tables/{table_id}/unseat/{user_id}")
async def unseat_player(table_id: int, user_id: int, db: Session = Depends(get_db)):
    """
    Internal endpoint: Unseat a player from a table
    
    This endpoint is called by the game server when a player leaves.
    It clears the seat and automatically seats the first player in queue (if any).
    """
    from .models import TableSeat
    
    # Find the seat
    seat = db.query(TableSeat).filter(
        TableSeat.table_id == table_id,
        TableSeat.user_id == user_id
    ).first()
    
    if not seat:
        return {"success": False, "message": "Player not seated at this table"}
    
    # Store the seat number before clearing it
    freed_seat_number = seat.seat_number
    
    # Clear the seat
    seat.user_id = None
    seat.occupied_at = None
    db.commit()
    
    logger.info(f"Unseated user {user_id} from table {table_id} seat {freed_seat_number}")
    
    # Check if there's anyone in the queue
    first_in_queue = db.query(TableQueue).filter(
        TableQueue.table_id == table_id
    ).order_by(TableQueue.position).first()
    
    if first_in_queue:
        queued_user_id = first_in_queue.user_id
        queued_user = db.query(User).filter(User.id == queued_user_id).first()
        
        if not queued_user:
            logger.error(f"Queued user {queued_user_id} not found")
            return {"success": True, "message": f"Player unseated from seat {freed_seat_number}"}
        
        # Get table info for buy-in requirement
        table = db.query(Table).filter(Table.id == table_id).first()
        if not table:
            logger.error(f"Table {table_id} not found")
            return {"success": True, "message": f"Player unseated from seat {freed_seat_number}"}
        
        # Check user's wallet
        wallet = db.query(Wallet).filter(
            Wallet.user_id == queued_user_id,
            Wallet.community_id == table.community_id
        ).first()
        
        if not wallet:
            logger.warning(f"User {queued_user_id} has no wallet in community {table.community_id}, cannot auto-seat")
            return {"success": True, "message": f"Player unseated from seat {freed_seat_number}"}
        
        # Check if wallet has sufficient funds for minimum buy-in
        if wallet.balance < table.buy_in:
            logger.warning(f"User {queued_user_id} has insufficient funds ({wallet.balance} < {table.buy_in}), cannot auto-seat")
            return {"success": True, "message": f"Player unseated from seat {freed_seat_number}"}
        
        # Auto-seat the queued player!
        buy_in_amount = table.buy_in  # Use minimum buy-in
        
        # Debit wallet
        wallet.balance -= buy_in_amount
        
        # Occupy the freed seat
        from sqlalchemy.sql import func
        seat.user_id = queued_user_id
        seat.occupied_at = func.now()
        
        # Remove from queue
        db.delete(first_in_queue)
        
        # Update queue positions for remaining players
        remaining_queue = db.query(TableQueue).filter(
            TableQueue.table_id == table_id,
            TableQueue.position > first_in_queue.position
        ).order_by(TableQueue.position).all()
        
        for entry in remaining_queue:
            entry.position -= 1
        
        db.commit()
        db.refresh(wallet)
        
        logger.info(f"Auto-seated user {queued_user_id} ({queued_user.username}) from queue to seat {freed_seat_number}")
        logger.info(f"Debited {buy_in_amount} from wallet. New balance: {wallet.balance}")
        
        # Notify game server to seat the player
        try:
            async with httpx.AsyncClient() as client:
                game_server_url = "http://game-server:3000/_internal/seat-player"
                seat_request = SeatPlayerRequest(
                    table_id=table_id,
                    user_id=queued_user_id,
                    username=queued_user.username,
                    stack=buy_in_amount,
                    seat_number=freed_seat_number
                )
                
                response = await client.post(
                    game_server_url,
                    json=seat_request.model_dump(),
                    timeout=5.0
                )
                
                if response.status_code == 200:
                    logger.info(f"Successfully seated queued player {queued_user.username} in game server")
                    return {
                        "success": True,
                        "message": f"Player unseated from seat {freed_seat_number}",
                        "auto_seated": {
                            "user_id": queued_user_id,
                            "username": queued_user.username,
                            "seat_number": freed_seat_number,
                            "buy_in": buy_in_amount
                        }
                    }
                else:
                    logger.error(f"Failed to seat player in game server: {response.text}")
                    # Rollback the seat assignment since game server failed
                    seat.user_id = None
                    seat.occupied_at = None
                    wallet.balance += buy_in_amount
                    db.commit()
                    return {"success": True, "message": f"Player unseated from seat {freed_seat_number}"}
                    
        except Exception as e:
            logger.error(f"Error notifying game server: {e}")
            # Rollback the seat assignment since game server failed
            seat.user_id = None
            seat.occupied_at = None
            wallet.balance += buy_in_amount
            db.commit()
            return {"success": True, "message": f"Player unseated from seat {freed_seat_number}"}
    
    return {"success": True, "message": f"Player unseated from seat {freed_seat_number}"}


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
        # Create hand history record
        hand_record = HandHistory(
            community_id=history.community_id,
            table_id=history.table_id,
            table_name=history.table_name,
            hand_data=history.hand_data
        )
        
        db.add(hand_record)
        db.commit()
        db.refresh(hand_record)
        
        return {
            "success": True,
            "hand_id": str(hand_record.id),
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
    
    # Query hands where user_id appears in the hand_data.players array
    # PostgreSQL JSONB query: hand_data @> '{"players": [{"user_id": X}]}'
    # But we need to search more flexibly, so we use jsonb_array_elements
    
    from sqlalchemy import text
    
    query = text("""
        SELECT h.id, h.table_name, h.played_at, h.hand_data
        FROM hand_history h
        WHERE EXISTS (
            SELECT 1 FROM jsonb_array_elements(h.hand_data->'players') AS player
            WHERE (player->>'user_id')::int = :user_id
        )
        ORDER BY h.played_at DESC
        LIMIT :limit OFFSET :offset
    """)
    
    results = db.execute(query, {"user_id": user_id, "limit": limit, "offset": offset})
    
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
    
    # Query the hand
    from sqlalchemy import text
    
    query = text("""
        SELECT h.id, h.community_id, h.table_id, h.table_name, h.played_at, h.hand_data
        FROM hand_history h
        WHERE h.id = :hand_id
        AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(h.hand_data->'players') AS player
            WHERE (player->>'user_id')::int = :user_id
        )
    """)
    
    result = db.execute(query, {"hand_id": hand_id, "user_id": user_id}).first()
    
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
    
    # Verify community exists
    community = db.query(Community).filter(Community.id == community_id).first()
    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found"
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
# Create Community Endpoint (for dashboard)
# ============================================================================

@app.post("/api/leagues/{league_id}/communities", response_model=CommunityResponse, status_code=status.HTTP_201_CREATED)
def create_community_in_league(
    league_id: int,
    community_data: CommunityBase | None = Body(default=None),
    name: str | None = None,
    description: str | None = None,
    starting_balance: float | None = None,
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
    # Create community with user as commissioner
    new_community = Community(
        name=name,
        description=description,
        league_id=league_id,
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
    from .models import EmailVerification
    from datetime import datetime
    
    # Find pending verification
    verification = db.query(EmailVerification).filter(
        EmailVerification.email == email,
        EmailVerification.verification_code == verification_code,
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
    access_token = create_access_token(
        data={"user_id": new_user.id, "username": new_user.username}
    )
    
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
    from .models import EmailVerification
    from datetime import datetime, timedelta
    import random
    
    if not settings.is_production:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email verification is only required in production mode"
        )
    
    # Find pending verification for this email
    verification = db.query(EmailVerification).filter(
        EmailVerification.email == email,
        EmailVerification.verified == False
    ).order_by(EmailVerification.created_at.desc()).first()
    
    if not verification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No pending verification found for this email"
        )
    
    # Generate new code
    new_code = str(random.randint(100000, 999999))
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
    msg['Subject'] = "Poker Platform - Email Verification"
    
    body = f"""
    Hello {username},
    
    Your verification code is: {code}
    
    This code expires in {settings.EMAIL_VERIFICATION_EXPIRE_MINUTES} minutes.
    
    If you didn't request this, please ignore this email.
    
    - Poker Platform Team
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
    msg['Subject'] = "Poker Platform - Admin Login Verification"
    
    body = f"""
    Hello {username},
    
    You are logging in as an administrator.
    
    Your verification code is: {code}
    
    This code expires in {settings.EMAIL_VERIFICATION_EXPIRE_MINUTES} minutes.
    
    If you didn't attempt to login, please secure your account immediately.
    
    - Poker Platform Team
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
    update_data: "ProfileUpdateRequest",
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Request a profile update. Sends verification code to current email.
    User must verify before changes are applied.
    """
    from .schemas import ProfileUpdateRequest, ProfileUpdateInitResponse
    from .models import EmailVerification
    import random
    import string
    
    user = db.query(User).filter(User.id == current_user["user_id"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Validate that at least one field is being updated
    if not update_data.new_username and not update_data.new_email:
        raise HTTPException(
            status_code=400,
            detail="At least one field (username or email) must be provided"
        )
    
    # Check if new username is already taken
    if update_data.new_username and update_data.new_username != user.username:
        existing_user = db.query(User).filter(User.username == update_data.new_username).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Username already taken")
    
    # Check if new email is already taken
    if update_data.new_email and update_data.new_email != user.email:
        existing_user = db.query(User).filter(User.email == update_data.new_email).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Email already in use")
    
    # Generate verification code
    verification_code = ''.join(random.choices(string.digits, k=6))
    
    # Store pending update in EmailVerification table with metadata
    # Delete any existing pending profile updates for this user
    db.query(EmailVerification).filter(
        EmailVerification.email == user.email,
        EmailVerification.verified == False
    ).delete()
    
    # Create new verification record
    verification = EmailVerification(
        email=user.email,
        verification_code=verification_code,
        expires_at=datetime.now() + timedelta(minutes=settings.EMAIL_VERIFICATION_EXPIRE_MINUTES)
    )
    db.add(verification)
    db.commit()
    
    # Send verification email (in dev mode, just log it)
    if settings.is_production:
        send_profile_update_email(user.email, user.username, verification_code)
    else:
        logger.info(f"[DEV MODE] Profile update verification code for {user.email}: {verification_code}")
    
    return ProfileUpdateInitResponse(
        message="Verification code sent to your email",
        requires_verification=True,
        verification_sent_to=user.email
    )


@app.post("/api/profile/verify-update")
def verify_profile_update(
    verify_data: "ProfileUpdateVerifyRequest",
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Verify profile update with code and apply changes.
    """
    from .schemas import ProfileUpdateVerifyRequest, ProfileUpdateResponse
    from .models import EmailVerification
    
    user = db.query(User).filter(User.id == current_user["user_id"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Find the verification record
    verification = db.query(EmailVerification).filter(
        EmailVerification.email == user.email,
        EmailVerification.verification_code == verify_data.verification_code,
        EmailVerification.verified == False
    ).first()
    
    if not verification:
        raise HTTPException(status_code=400, detail="Invalid verification code")
    
    if verification.expires_at < datetime.now():
        raise HTTPException(status_code=400, detail="Verification code has expired")
    
    # Apply updates
    new_token = None
    if verify_data.new_username and verify_data.new_username != user.username:
        # Check again that username is available
        existing = db.query(User).filter(User.username == verify_data.new_username).first()
        if existing:
            raise HTTPException(status_code=400, detail="Username already taken")
        user.username = verify_data.new_username
    
    if verify_data.new_email and verify_data.new_email != user.email:
        # Check again that email is available
        existing = db.query(User).filter(User.email == verify_data.new_email).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already in use")
        user.email = verify_data.new_email
        # Generate new token with updated email
        new_token = create_access_token(data={"sub": user.email, "user_id": user.id})
    
    # Mark verification as used
    verification.verified = True
    db.commit()
    db.refresh(user)
    
    return ProfileUpdateResponse(
        success=True,
        message="Profile updated successfully",
        user=UserResponse.model_validate(user),
        access_token=new_token
    )


def send_profile_update_email(email: str, username: str, code: str):
    """Send profile update verification email"""
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    
    msg = MIMEMultipart()
    msg['From'] = settings.EMAIL_FROM
    msg['To'] = email
    msg['Subject'] = 'Profile Update Verification - Poker Platform'
    
    body = f"""
    Hello {username},
    
    You requested to update your profile. Your verification code is: {code}
    
    This code expires in {settings.EMAIL_VERIFICATION_EXPIRE_MINUTES} minutes.
    
    If you didn't request this change, please secure your account immediately.
    
    - Poker Platform Team
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

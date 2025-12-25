"""
Main FastAPI application with all routes
"""
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from decimal import Decimal

from .config import settings
from .database import engine, Base, get_db
from .models import User, League, Community, Wallet, Table, TableStatus, HandHistory, TableSeat, TableQueue
from .schemas import (
    UserCreate, UserResponse, Token,
    LeagueCreate, LeagueResponse,
    CommunityCreate, CommunityResponse,
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

# Security scheme for JWT Bearer tokens
security = HTTPBearer()

# Create database tables
Base.metadata.create_all(bind=engine)

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
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> dict:
    """
    Dependency to get current user from JWT token in Authorization header
    Raises HTTPException if token is invalid
    """
    token = credentials.credentials
    payload = decode_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token"
        )
    return payload


# ============================================================================
# Authentication Endpoints (Public)
# ============================================================================

@app.post("/auth/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register_user(user_data: UserCreate, db: Session = Depends(get_db)):
    """
    Register a new user account
    
    - **username**: Unique username (3-50 characters)
    - **email**: Unique email address
    - **password**: Password (min 8 characters)
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
    
    # Create new user
    hashed_password = get_password_hash(user_data.password)
    new_user = User(
        username=user_data.username,
        email=user_data.email,
        hashed_password=hashed_password
    )
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return new_user


@app.post("/auth/login", response_model=Token)
def login(username: str, password: str, db: Session = Depends(get_db)):
    """
    Login with username and password to get JWT token
    
    - **username**: Your username
    - **password**: Your password
    
    Returns JWT access token to use for authenticated requests
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
    
    # Create access token
    access_token = create_access_token(
        data={"user_id": user.id, "username": user.username}
    )
    
    return {"access_token": access_token, "token_type": "bearer"}


# ============================================================================
# League Endpoints (Public - requires auth)
# ============================================================================

@app.post("/api/leagues", response_model=LeagueResponse, status_code=status.HTTP_201_CREATED)
def create_league(
    league_data: LeagueCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Create a new league (requires authentication)
    
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
    db.commit()
    db.refresh(new_league)
    
    return new_league


@app.get("/api/leagues", response_model=list[LeagueResponse])
def list_leagues(db: Session = Depends(get_db)):
    """List all leagues"""
    leagues = db.query(League).all()
    return leagues


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
    # Verify league exists
    league = db.query(League).filter(League.id == community_data.league_id).first()
    if not league:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="League not found"
        )
    
    # Create community
    new_community = Community(
        name=community_data.name,
        description=community_data.description,
        league_id=community_data.league_id,
        starting_balance=community_data.starting_balance
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


# ============================================================================
# Wallet Endpoints (Public - requires auth)
# ============================================================================

@app.get("/api/wallets", response_model=list[WalletResponse])
def get_my_wallets(token: str, db: Session = Depends(get_db)):
    """
    Get all wallets for the authenticated user
    """
    # Verify token
    payload = decode_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token"
        )
    
    user_id = payload.get("user_id")
    
    # Get all wallets for this user
    wallets = db.query(Wallet).filter(Wallet.user_id == user_id).all()
    return wallets


# ============================================================================
# Table Endpoints (Public - requires auth)
# ============================================================================

@app.get("/api/communities/{community_id}/tables", response_model=list[TableResponse])
def get_community_tables(community_id: int, token: str, db: Session = Depends(get_db)):
    """
    Get all tables for a specific community
    Requires authentication
    """
    # Verify token
    payload = decode_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token"
        )
    
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

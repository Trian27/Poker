# Poker Platform - Complete Deployment Guide

## System Architecture

This poker platform consists of three main services:

1. **FastAPI Backend** (Port 8000) - Authentication, wallets, communities, leagues
2. **Node.js Game Server** (Port 3000) - Real-time poker game engine with Socket.IO
3. **React Frontend** (Port 5173) - User interface with Vite

### Data Flow

```
User Browser (React) → FastAPI (Auth/Wallets) → PostgreSQL
                    ↓
                Socket.IO → Node.js Game Server
                          ↓
                    FastAPI (Wallet Operations)
```

## Prerequisites

- **Python 3.13+**
- **Node.js 18+** and npm
- **PostgreSQL** (running on default port 5432)
- **Redis** (optional, for future use)

## Setup Instructions

### 1. Database Setup

```bash
# Create PostgreSQL database
createdb poker_db

# Or using psql
psql -U postgres
CREATE DATABASE poker_db;
\q
```

### 2. FastAPI Backend Setup

```bash
cd /Users/trian/Projects/Poker/poker-api

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Set environment variables (optional - defaults shown)
export DATABASE_URL="postgresql://user:password@localhost/poker_db"
export SECRET_KEY="your-secret-key-here"
export ALGORITHM="HS256"
export ACCESS_TOKEN_EXPIRE_MINUTES="30"

# Run the server
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`
- Alternative docs: `http://localhost:8000/redoc`

### 3. Node.js Game Server Setup

```bash
cd /Users/trian/Projects/Poker/GameImplementation

# Install dependencies
npm install

# Build TypeScript
npm run build

# Start the server
npm start
```

The game server will be available at: `http://localhost:3000`

### 4. React Frontend Setup

```bash
cd /Users/trian/Projects/Poker/poker-ui

# Install dependencies
npm install

# Start development server
npm run dev
```

The frontend will be available at: `http://localhost:5173`

## Testing the System

### 1. Test FastAPI Backend

```bash
cd /Users/trian/Projects/Poker/poker-api
source venv/bin/activate
python test_chunk2.py
```

Expected output: All 15 tests should pass ✅

### 2. Test the Complete Flow

1. **Open browser** → `http://localhost:5173`
2. **Register a new account**
   - Username: testuser1
   - Email: test1@example.com
   - Password: password123
3. **Create or join a community**
   - Note the starting balance (e.g., 10000 chips)
4. **Click "Join Game"**
   - 1000 chips will be debited from your wallet
   - You'll enter the game lobby
5. **Open another browser/incognito window**
   - Register another user (testuser2)
   - Join the same community
   - Click "Join Game"
6. **Play poker!**
   - Game will start when 2 players join
   - Use Fold, Check, Call, Bet, Raise, All In buttons
   - Watch your chips and cards update in real-time
7. **After game ends**
   - Remaining chips are credited back to your wallet
   - Check your wallet balance on the dashboard

## Key Features Implemented

### Authentication & Authorization
- ✅ JWT token-based authentication
- ✅ Bcrypt password hashing
- ✅ Socket.IO authentication middleware
- ✅ Protected routes in React

### Wallet System
- ✅ Buy-in debiting (1000 chips per game)
- ✅ Payout crediting (remaining stack after game)
- ✅ Refunds for leaving lobby or disconnecting
- ✅ Insufficient funds validation

### Real-time Game Engine
- ✅ Texas Hold'em poker rules
- ✅ Socket.IO bidirectional communication
- ✅ Game state broadcasting to all players
- ✅ Player actions (fold, check, call, bet, raise, all-in)
- ✅ Hand evaluation and winner determination

### User Interface
- ✅ Responsive design
- ✅ Authentication pages (login/register)
- ✅ Dashboard with communities and wallets
- ✅ Live game table with:
  - Player cards (showing your cards + opponent's back)
  - Community cards (flop, turn, river)
  - Pot size and current bet
  - Action buttons
  - Real-time updates

## API Endpoints

### Public Endpoints
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login and get JWT token

### Protected Endpoints (require JWT token)
- `GET /api/communities` - List all communities
- `POST /api/communities` - Create new community
- `POST /api/communities/{id}/join` - Join a community
- `GET /api/leagues` - List leagues for user's communities
- `GET /api/wallets` - Get user's wallets

### Internal Endpoints (used by game server)
- `GET /api/internal/auth/verify` - Verify JWT token
- `POST /api/internal/wallet/debit` - Debit from wallet
- `POST /api/internal/wallet/credit` - Credit to wallet

## Socket.IO Events

### Client → Server
- `join_game` - Join game lobby with communityId
- `game_action` - Perform game action (fold/check/call/bet/raise/all-in)
- `leave_game` - Leave current game

### Server → Client
- `connect` - Connection established
- `disconnect` - Connection closed
- `lobby_joined` - Successfully joined lobby
- `game_started` - Game has started with 2 players
- `game_state_update` - Game state changed
- `player_left` - Another player left the game
- `error` - Error message (e.g., insufficient funds)
- `action_error` - Invalid game action

## Environment Variables

### FastAPI (.env or export)
```bash
DATABASE_URL=postgresql://user:password@localhost/poker_db
SECRET_KEY=your-secret-key-change-in-production
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
```

### React (poker-ui/.env)
```bash
VITE_API_URL=http://localhost:8000
VITE_SOCKET_URL=http://localhost:3000
```

## Troubleshooting

### PostgreSQL Connection Issues
```bash
# Check if PostgreSQL is running
pg_isready

# Start PostgreSQL (macOS with Homebrew)
brew services start postgresql

# Check connection
psql -U postgres -d poker_db
```

### Port Already in Use
```bash
# Find process using port 8000
lsof -ti:8000 | xargs kill -9

# Find process using port 3000
lsof -ti:3000 | xargs kill -9

# Find process using port 5173
lsof -ti:5173 | xargs kill -9
```

### CORS Issues
- FastAPI allows `http://localhost:5173` in CORS
- Node.js Socket.IO allows all origins (`*`)
- If you change ports, update CORS settings

### Authentication Failures
- Check JWT token in browser localStorage
- Verify token is being sent in Socket.IO auth headers
- Check FastAPI logs for authentication errors

### Wallet Balance Issues
- Check PostgreSQL wallet table for actual balance
- Verify debit/credit operations in FastAPI logs
- Game server logs show all wallet operations

## Production Deployment Considerations

### Security
- [ ] Change `SECRET_KEY` to a strong random value
- [ ] Use environment variables for all secrets
- [ ] Enable HTTPS/WSS for production
- [ ] Restrict CORS to specific domains
- [ ] Add rate limiting to API endpoints
- [ ] Implement proper error handling and logging

### Performance
- [ ] Add Redis for game state caching
- [ ] Use Redis Pub/Sub for multi-server Socket.IO
- [ ] Add database connection pooling
- [ ] Implement database indexes
- [ ] Add CDN for static assets

### Monitoring
- [ ] Add application logging (Winston, Sentry)
- [ ] Monitor database performance
- [ ] Track WebSocket connection metrics
- [ ] Alert on wallet transaction failures

### Scalability
- [ ] Use Redis adapter for Socket.IO horizontal scaling
- [ ] Deploy multiple game servers behind load balancer
- [ ] Separate read/write database replicas
- [ ] Implement game session persistence

## Testing Checklist

- [ ] User registration works
- [ ] User login returns valid JWT
- [ ] Community creation and joining works
- [ ] Wallet balance shows correctly
- [ ] Game buy-in debits wallet
- [ ] Socket.IO connection authenticates
- [ ] Two players can join and start a game
- [ ] Cards are dealt correctly
- [ ] All player actions work (fold, check, call, bet, raise)
- [ ] Pot updates correctly
- [ ] Hand winner is determined correctly
- [ ] Payouts credit back to wallet
- [ ] Leaving game refunds remaining chips
- [ ] Disconnecting refunds remaining chips

## Development Team Notes

### Completed
✅ Chunk 1: TypeScript poker game engine with comprehensive tests
✅ Chunk 2: FastAPI backend with auth, wallets, communities (15/15 tests passing)
✅ Chunk 3: React frontend with Socket.IO integration
✅ Node.js Socket.IO server with JWT authentication
✅ Wallet integration (buy-ins, payouts, refunds)

### Next Steps (Future Enhancements)
- Add Redis for game state persistence
- Implement tournament mode
- Add chat functionality
- Add spectator mode
- Add hand history
- Add player statistics
- Add leaderboards
- Add friend system
- Add private tables

## Support & Documentation

- **API Documentation**: http://localhost:8000/docs
- **Game Engine Tests**: `/Users/trian/Projects/Poker/GameImplementation/src/engine/__tests__/`
- **API Tests**: `/Users/trian/Projects/Poker/poker-api/test_chunk2.py`

## License

[Your License Here]

## Contributors

[Your Name/Team]

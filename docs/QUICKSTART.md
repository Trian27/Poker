# Quick Start Guide - Poker Platform

## 🚀 Fastest Way to Get Started

### Configure Python Once
Copy `.env.example` to `.env` and set `PYTHON_BIN` to the exact Python interpreter inside your local virtual environment.

Example:

```dotenv
PYTHON_BIN=/Users/your-user/.virtualenvs/poker/bin/python
```

The repo scripts use `PYTHON_BIN` directly. You do not need to activate a separate shell virtualenv before running them.

### One-Command Start (Recommended)
```bash
cd /Users/trian/Projects/Poker
cp .env.example .env
# Edit .env and set PYTHON_BIN
./scripts/start-all.sh
```
Then open: **http://localhost:5173**

### One-Command Stop
```bash
./scripts/stop-all.sh
```

---

## 🎯 Quick Test Flow

1. **Open** → http://localhost:5173
2. **Register** → Create testuser1
3. **Create Community** → "Test Poker Room" with 10000 starting balance
4. **Join Game** → Click button (1000 chips debited)
5. **Open Incognito** → Register testuser2
6. **Join Same Community**
7. **Join Game** → Game starts!
8. **Play Poker** → Use action buttons
9. **Check Wallet** → Return to dashboard to see balance

---

## 📋 Manual Start (Step-by-Step)

### Terminal 1: FastAPI
```bash
cd /Users/trian/Projects/Poker/poker-api
/Users/your-user/.virtualenvs/poker/bin/python -m uvicorn app.main:app --reload --port 8000
```

### Terminal 2: Game Server
```bash
cd /Users/trian/Projects/Poker/GameImplementation
npm start
```

### Terminal 3: React Frontend
```bash
cd /Users/trian/Projects/Poker/poker-ui
npm run dev
```

---

## 🔧 Common Commands

### Check if PostgreSQL is Running
```bash
pg_isready
```

### Run API Tests
```bash
./scripts/test-gameplay.sh full
```

### Build React for Production
```bash
cd poker-ui && npm run build
```

### Build TypeScript Game Server
```bash
cd GameImplementation && npm run build
```

---

## 🌐 Service URLs

| Service | URL | Purpose |
|---------|-----|---------|
| **React Frontend** | http://localhost:5173 | User interface |
| **FastAPI Backend** | http://localhost:8000 | REST API |
| **API Documentation** | http://localhost:8000/docs | Interactive API docs |
| **Game Server** | http://localhost:3000 | Socket.IO websockets |

---

## 🐛 Quick Troubleshooting

### Port Already in Use
```bash
# Kill process on port 8000
lsof -ti:8000 | xargs kill -9

# Kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Kill process on port 5173
lsof -ti:5173 | xargs kill -9
```

### PostgreSQL Not Running
```bash
# macOS with Homebrew
brew services start postgresql

# Check status
brew services list
```

### Clear Everything and Restart
```bash
./scripts/stop-all.sh
# Wait 5 seconds
./scripts/start-all.sh
```

### Reset Database
```bash
# Drop and recreate database
dropdb poker_db && createdb poker_db

# Restart FastAPI (it will recreate tables)
```

---

## 📊 What's Happening Behind the Scenes

```
User Registers/Logs In
    ↓
FastAPI creates JWT token
    ↓
React stores token in localStorage
    ↓
User joins game
    ↓
React sends token via Socket.IO auth
    ↓
Node.js verifies token with FastAPI
    ↓
Node.js debits wallet (1000 chips)
    ↓
Game starts when 2 players ready
    ↓
Players take actions
    ↓
Game ends
    ↓
Node.js credits remaining chips to wallets
```

---

## 🎮 Socket.IO Events Cheat Sheet

### Emit from Client
```typescript
socket.emit('join_game', { communityId: 1 })
socket.emit('game_action', { action: 'bet', amount: 100 })
socket.emit('leave_game')
```

### Listen on Client
```typescript
socket.on('lobby_joined', (data) => { /* waiting for opponent */ })
socket.on('game_started', (data) => { /* game begins */ })
socket.on('game_state_update', (data) => { /* cards, pot, turn */ })
socket.on('error', (data) => { /* insufficient funds, etc */ })
```

---

## 💰 Wallet Transaction Flow

| Event | Amount | Description |
|-------|--------|-------------|
| **Join Game** | -1000 | Buy-in debited |
| **Leave Lobby** | +1000 | Refund (game not started) |
| **Game Ends** | +stack | Remaining chips credited |
| **Disconnect** | +stack | Auto refund |

---

## 📁 Project Structure Quick Reference

```
/Users/trian/Projects/Poker/
├── poker-api/          # FastAPI backend (port 8000)
│   ├── app/
│   │   ├── main.py     # API routes
│   │   ├── auth.py     # JWT + bcrypt
│   │   └── models.py   # SQLAlchemy models
│   └── test_chunk2.py  # 15 API tests
│
├── GameImplementation/ # Node.js game server (port 3000)
│   └── src/
│       ├── server.ts   # Socket.IO + wallet integration
│       └── engine/     # Poker game logic
│
└── poker-ui/           # React frontend (port 5173)
    └── src/
        ├── pages/      # Login, Register, Dashboard, GameTable
        ├── api.ts      # Axios client
        └── types.ts    # TypeScript interfaces
```

---

## 🔑 Key Files to Know

### Backend
- `poker-api/app/main.py` - API endpoints
- `poker-api/app/auth.py` - JWT authentication
- `poker-api/app/models.py` - Database models

### Game Server
- `GameImplementation/src/server.ts` - Socket.IO + auth + wallet
- `GameImplementation/src/engine/Game.ts` - Poker game engine

### Frontend
- `poker-ui/src/App.tsx` - Routes
- `poker-ui/src/pages/GameTablePage.tsx` - Real-time game UI
- `poker-ui/src/api.ts` - HTTP client with auth

---

## 🧪 Test Coverage

- ✅ **API Tests**: 15/15 passing (`test_chunk2.py`)
- ✅ **Game Engine Tests**: Comprehensive unit tests in `__tests__/`
- ✅ **Build Tests**: TypeScript + React builds with no errors
- ⏳ **E2E Tests**: Manual testing recommended (see above)

---

## 📚 Full Documentation

- **Deployment Guide**: `DEPLOYMENT_GUIDE.md`
- **Chunk 3 Implementation**: `CHUNK3_COMPLETE.md`
- **Project Summary**: `PROJECT_SUMMARY.md`
- **API Docs**: http://localhost:8000/docs (when running)

---

## 💡 Pro Tips

1. **Use two browsers** for testing (Chrome + Incognito or Firefox)
2. **Open browser console** to see Socket.IO connection logs
3. **Check Network tab** to see API calls and WebSocket frames
4. **Monitor server logs** for authentication and wallet operations
5. **Test insufficient funds** by trying to join with low wallet balance

---

## 🎓 Learning the Codebase

Start here:
1. Read `PROJECT_SUMMARY.md` for architecture overview
2. Run tests: `python test_chunk2.py` to understand API
3. Read `server.ts` to see Socket.IO authentication
4. Read `GameTablePage.tsx` to see frontend implementation
5. Play a game to see it all working together!

---

## ⚡ Development Workflow

```bash
# 1. Make changes to backend
cd poker-api
# Edit files...
# FastAPI auto-reloads ✓

# 2. Make changes to game server
cd GameImplementation
# Edit src/server.ts...
npm run build && npm start

# 3. Make changes to frontend
cd poker-ui
# Edit src/pages/...
# Vite auto-reloads ✓
```

---

**Need Help?** Check `DEPLOYMENT_GUIDE.md` for detailed troubleshooting!

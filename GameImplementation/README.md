# Poker Game Server

A real-time poker platform with microservice architecture, featuring tournament support, web UI, and agent-based API interfaces.

## Features

### Game Engine
- Complete Texas Hold'em game logic
- Real-time multiplayer via WebSocket
- Comprehensive hand evaluation (Royal Flush → High Card)
- Full betting rounds (preflop, flop, turn, river, showdown)
- All actions supported (fold, check, call, bet, raise, all-in)
- Automatic game progression and winner determination
- Wikipedia-compliant rules (heads-up, antes, burn cards)

### Tournament System
- Automatic blind structure generation using exponential growth formula
- Configurable parameters: starting stack, player count, duration, blind levels
- Preset structures: Fast/Standard/Deep-stack tournaments
- Break support: Automatic scheduled breaks during play
- Ante escalation: Configurable ante introduction at specific levels
- Tournament state management: Registration, blind progression, elimination tracking
- Late registration: Configurable level cutoff for late entries

## Quick Start

### Installation
```bash
npm install
```

### Run Tests
```bash
npm test
# Expected: All tests passing
```

### Start the Server
```bash
npm run dev
# Server starts on http://localhost:3000
```

### Connect Clients (in separate terminals)
```bash
# Terminal 2 - First Player
npm run client Alice

# Terminal 3 - Second Player  
npm run client Bob
```

### Play Poker!
When both players connect, a game starts automatically. Follow the prompts to:
- **fold**: Give up your hand
- **check**: Pass action (when no bet to match)
- **call**: Match the current bet
- **bet <amount>**: Make a bet when no one else has
- **raise <amount>**: Increase the current bet
- **all-in**: Bet your entire stack

## Project Structure

```
src/
├── engine/              # Core game logic (headless)
│   ├── Card.ts         # Playing card with suit and rank
│   ├── Deck.ts         # 52-card deck with shuffle + burn cards
│   ├── Hand.ts         # Hand evaluation (Royal Flush → High Card)
│   ├── Player.ts       # Player state (stack, bets, cards)
│   └── Game.ts         # Game orchestration and flow
├── engine/__tests__/    # Comprehensive game tests
├── tournament/          # Tournament system
│   ├── BlindStructure.ts    # Blind level generation with formula
│   └── Tournament.ts        # Tournament state management
├── tournament/__tests__/    # Tournament tests
├── server.ts           # Socket.io real-time server
├── client.ts           # CLI test client
└── tournamentExample.ts # Tournament usage examples
```

## Next Steps

1. Add Redis for state management
2. Build FastAPI services for auth and community management
3. Create React web UI
4. Build Python Agent API service

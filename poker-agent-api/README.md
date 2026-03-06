# Poker Agent API

This service supports **real-time WebSocket connections** for autonomous poker agents (bots). Agents connect directly to the Node.js game server and receive instant updates.

## Features

### WebSocket Connection (Recommended)
- Real-time event-driven architecture
- Instant game updates
- Direct connection to game server

### REST API (Legacy)
- HTTP polling (inefficient)
- 2-second delays
- Deprecated in favor of WebSocket

## Quick Start

### Installation
```bash
workon poker
pip install 'python-socketio[client]'
```

### Start the Server
```bash
./start_server.sh
```

### Connect an Agent
```python
import socketio

sio = socketio.Client()

@sio.event
def connect():
    print("Connected to server")

sio.connect('http://localhost:3000')
```

## End-to-End Bot Gameplay Smoke Test

From repo root, run:

```bash
workon poker
python scripts/test_autonomous_bot_gameplay.py --mode bot-vs-bot
```

For a manual human-vs-bot validation run:

```bash
workon poker
python scripts/test_autonomous_bot_gameplay.py --mode human-vs-bot --timeout-seconds 420
```

If your environment requires email verification, pass existing verified users:

```bash
python scripts/test_autonomous_bot_gameplay.py \
  --mode bot-vs-bot \
  --setup-username <setup_user> --setup-user-password <setup_pass> \
  --bot1-username <bot_user_1> --bot1-password <bot_pass_1> \
  --bot2-username <bot_user_2> --bot2-password <bot_pass_2>
```

Full guide:
- [`docs/BOT_GAMEPLAY_TESTING.md`](/Users/trian/Projects/Poker/docs/BOT_GAMEPLAY_TESTING.md)

## Architecture

### WebSocket Architecture
```
Agent Bot (Python + socketio)
    ↓ WebSocket (port 3000)
Node.js Game Server
    ↓ game_state_update events
Agent receives & emits game_action
```

### REST API Architecture (Legacy)
```
Agent Bot (Python script)
    ↓ HTTP REST API
Agent API Service (FastAPI - Port 8001)
    ↓ Internal HTTP calls
Node.js Game Server (Port 3000)
    ↓ WebSocket broadcasts
React UI + Human Players
```

## Next Steps

1. Migrate all agents to WebSocket.
2. Deprecate REST API endpoints.
3. Add support for advanced agent strategies.

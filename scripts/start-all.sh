#!/bin/bash

# Poker Platform - Start All Services
# This script starts all four microservices:
# 1. FastAPI Auth/Wallet Service (Port 8000)
# 2. Node.js Game Server (Port 3000)
# 3. Agent API Service (Port 8001)
# 4. React Frontend (Port 5173)

echo "🎰 Starting Poker Platform..."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Create logs directory if it doesn't exist
mkdir -p "$SCRIPT_DIR/logs"

# Check if PostgreSQL is running
echo -e "${BLUE}Checking PostgreSQL...${NC}"
if ! pg_isready -q; then
    echo -e "${RED}❌ PostgreSQL is not running. Please start it first:${NC}"
    echo "   brew services start postgresql"
    exit 1
fi
echo -e "${GREEN}✅ PostgreSQL is running${NC}"
echo ""

# Start FastAPI in background
echo -e "${BLUE}Starting FastAPI Backend (Port 8000)...${NC}"
cd "$SCRIPT_DIR/poker-api"

# Use workon poker virtual environment
source ~/.virtualenvs/poker/bin/activate
pip install -q -r requirements.txt

# Start FastAPI
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 > ../logs/fastapi.log 2>&1 &
FASTAPI_PID=$!
echo -e "${GREEN}✅ FastAPI started (PID: $FASTAPI_PID)${NC}"
echo ""

# Wait for FastAPI to be ready
echo -e "${YELLOW}Waiting for FastAPI to be ready...${NC}"
for i in {1..10}; do
    if curl -s http://localhost:8000/api/health > /dev/null; then
        echo -e "${GREEN}✅ FastAPI is ready${NC}"
        break
    fi
    sleep 1
done
echo ""

# Start Node.js Game Server in background
echo -e "${BLUE}Starting Node.js Game Server (Port 3000)...${NC}"
cd "$SCRIPT_DIR/GameImplementation"
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing Node.js dependencies...${NC}"
    npm install
fi

npm run build > /dev/null 2>&1
npm start > ../logs/gameserver.log 2>&1 &
GAMESERVER_PID=$!
echo -e "${GREEN}✅ Game Server started (PID: $GAMESERVER_PID)${NC}"
echo ""

# Start Agent API in background
echo -e "${BLUE}Starting Agent API Service (Port 8001)...${NC}"
cd "$SCRIPT_DIR/poker-agent-api"

# Use workon poker virtual environment
source ~/.virtualenvs/poker/bin/activate
pip install -q -r requirements.txt

# Start Agent API
python -m uvicorn app.main:app --host 0.0.0.0 --port 8001 > ../logs/agentapi.log 2>&1 &
AGENTAPI_PID=$!
echo -e "${GREEN}✅ Agent API started (PID: $AGENTAPI_PID)${NC}"
echo ""

# Wait for Agent API to be ready
echo -e "${YELLOW}Waiting for Agent API to be ready...${NC}"
for i in {1..10}; do
    if curl -s http://localhost:8001/health > /dev/null; then
        echo -e "${GREEN}✅ Agent API is ready${NC}"
        break
    fi
    sleep 1
done
echo ""

# Start React Frontend in background
echo -e "${BLUE}Starting React Frontend (Port 5173)...${NC}"
cd "$SCRIPT_DIR/poker-ui"
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing React dependencies...${NC}"
    npm install
fi

npm run dev > ../logs/frontend.log 2>&1 &
FRONTEND_PID=$!
echo -e "${GREEN}✅ React Frontend started (PID: $FRONTEND_PID)${NC}"
echo ""

# Save PIDs to file for stop script
echo "$FASTAPI_PID" > "$SCRIPT_DIR/.pids"
echo "$GAMESERVER_PID" >> "$SCRIPT_DIR/.pids"
echo "$AGENTAPI_PID" >> "$SCRIPT_DIR/.pids"
echo "$FRONTEND_PID" >> "$SCRIPT_DIR/.pids"

echo ""
echo -e "${GREEN}🎉 All services are running!${NC}"
echo ""
echo "📊 Service URLs:"
echo "   • Frontend:      http://localhost:5173"
echo "   • Auth/Wallet:   http://localhost:8000 (FastAPI)"
echo "   • Agent API:     http://localhost:8001 (Agent Bot API)"
echo "   • Game Server:   http://localhost:3000 (Socket.IO + HTTP)"
echo "   • API Docs:      http://localhost:8000/docs"
echo "   • Agent Docs:    http://localhost:8001/docs"
echo ""
echo "📝 Logs are in: $SCRIPT_DIR/logs/"
echo ""
echo "To stop all services, run:"
echo "   ./stop-all.sh"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop watching logs (services will keep running)${NC}"
echo ""

# Tail all logs
trap "echo ''; echo 'Services are still running. Use ./stop-all.sh to stop them.'; exit 0" INT
tail -f "$SCRIPT_DIR/logs/fastapi.log" "$SCRIPT_DIR/logs/gameserver.log" "$SCRIPT_DIR/logs/frontend.log"

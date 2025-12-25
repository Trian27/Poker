#!/bin/bash

# Poker Platform - Stop All Services

echo "🛑 Stopping Poker Platform services..."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Read PIDs from file
if [ -f "$SCRIPT_DIR/.pids" ]; then
    echo -e "${BLUE}Stopping services from PIDs file...${NC}"
    while read -r pid; do
        if ps -p "$pid" > /dev/null 2>&1; then
            echo "  Killing process $pid"
            kill "$pid" 2>/dev/null
        fi
    done < "$SCRIPT_DIR/.pids"
    rm "$SCRIPT_DIR/.pids"
    echo -e "${GREEN}✅ Stopped services from PIDs file${NC}"
else
    echo -e "${BLUE}No PIDs file found, searching for processes by port...${NC}"
fi

echo ""

# Kill processes by port as backup
echo -e "${BLUE}Ensuring all ports are freed...${NC}"

# Kill FastAPI (port 8000)
if lsof -ti:8000 > /dev/null 2>&1; then
    echo "  Stopping FastAPI (port 8000)"
    lsof -ti:8000 | xargs kill -9 2>/dev/null
fi

# Kill Game Server (port 3000)
if lsof -ti:3000 > /dev/null 2>&1; then
    echo "  Stopping Game Server (port 3000)"
    lsof -ti:3000 | xargs kill -9 2>/dev/null
fi

# Kill React Frontend (port 5173)
if lsof -ti:5173 > /dev/null 2>&1; then
    echo "  Stopping React Frontend (port 5173)"
    lsof -ti:5173 | xargs kill -9 2>/dev/null
fi

echo ""
echo -e "${GREEN}✅ All services stopped${NC}"
echo ""
echo "To start services again, run:"
echo "   ./start-all.sh"

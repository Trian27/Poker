#!/bin/bash
# Start script for Poker Agent API

echo "🤖 Starting Poker Agent API..."

# Activate virtual environment
source ~/.virtualenvs/poker/bin/activate

# Start the server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001

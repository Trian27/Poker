#!/bin/bash

# Docker Health Check Script
# Verifies all services are running and healthy

echo "🐳 Checking Docker Compose Services..."
echo ""

# Check if docker-compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ docker-compose not found. Please install Docker Desktop."
    exit 1
fi

# Check if services are running
echo "📊 Service Status:"
docker-compose ps

echo ""
echo "🏥 Health Checks:"

# PostgreSQL
echo -n "PostgreSQL... "
if docker-compose exec -T postgres-db pg_isready -U poker_user -d poker_db > /dev/null 2>&1; then
    echo "✅ Healthy"
else
    echo "❌ Not Ready"
fi

# Redis
echo -n "Redis... "
if docker-compose exec -T redis-cache redis-cli ping > /dev/null 2>&1; then
    echo "✅ Healthy"
else
    echo "❌ Not Ready"
fi

# Auth API
echo -n "Auth API (8000)... "
if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo "✅ Responding"
else
    echo "❌ Not Responding"
fi

# Agent API
echo -n "Agent API (8001)... "
if curl -s http://localhost:8001/health > /dev/null 2>&1; then
    echo "✅ Responding"
else
    echo "❌ Not Responding"
fi

# Game Server
echo -n "Game Server (3000)... "
if curl -s http://localhost:3000/_internal/health > /dev/null 2>&1; then
    echo "✅ Responding"
else
    echo "❌ Not Responding"
fi

# React UI
echo -n "React UI (5173)... "
if curl -s http://localhost:5173 > /dev/null 2>&1; then
    echo "✅ Responding"
else
    echo "❌ Not Responding"
fi

echo ""
echo "✨ Health check complete!"
echo ""
echo "📝 Quick commands:"
echo "  View logs: docker-compose logs -f"
echo "  Stop all: docker-compose down"
echo "  Rebuild: docker-compose up --build"

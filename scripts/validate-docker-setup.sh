#!/bin/bash

# Chunk 9 Validation Script
# Verifies Docker setup is complete and ready to use

echo "🔍 Chunk 9 Docker Setup Validation"
echo "===================================="
echo ""

PROJECT_ROOT="/Users/trian/Projects/Poker"
cd "$PROJECT_ROOT" || exit 1

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check counter
CHECKS=0
PASSED=0

check() {
    CHECKS=$((CHECKS + 1))
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓${NC} $2"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}✗${NC} $2 - Missing: $1"
    fi
}

echo "📋 File Verification:"
echo ""

# Core Docker files
check "docker-compose.yml" "Docker Compose orchestration"
check ".dockerignore" "Docker ignore patterns"
check ".env.example" "Environment template"

# Dockerfiles
check "poker-ui/Dockerfile" "React UI Dockerfile"
check "poker-ui/nginx.conf" "Nginx configuration"
check "GameImplementation/Dockerfile" "Game Server Dockerfile"
check "poker-api/Dockerfile" "Auth API Dockerfile"
check "poker-agent-api/Dockerfile" "Agent API Dockerfile"

# Documentation
check "DOCKER_GUIDE.md" "Comprehensive Docker guide"
check "DOCKER_README.md" "Quick start guide"
check "CHUNK9_DOCKER_COMPLETE.md" "Implementation summary"
check "docker-health-check.sh" "Health check script"

echo ""
echo "🔧 Configuration Verification:"
echo ""

# Check for environment variable usage in code
if grep -q "process.env.AUTH_API_URL" GameImplementation/src/server.ts; then
    echo -e "${GREEN}✓${NC} Game Server uses AUTH_API_URL env var"
    CHECKS=$((CHECKS + 1))
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗${NC} Game Server missing AUTH_API_URL env var"
    CHECKS=$((CHECKS + 1))
fi

if grep -q "import.meta.env.VITE_API_URL" poker-ui/src/api.ts; then
    echo -e "${GREEN}✓${NC} React UI uses VITE_API_URL env var"
    CHECKS=$((CHECKS + 1))
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗${NC} React UI missing VITE_API_URL env var"
    CHECKS=$((CHECKS + 1))
fi

if grep -q "import.meta.env.VITE_GAME_SERVER_URL" poker-ui/src/pages/GameTablePage.tsx; then
    echo -e "${GREEN}✓${NC} Game Table uses VITE_GAME_SERVER_URL env var"
    CHECKS=$((CHECKS + 1))
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗${NC} Game Table missing VITE_GAME_SERVER_URL env var"
    CHECKS=$((CHECKS + 1))
fi

echo ""
echo "🐳 Docker Prerequisites:"
echo ""

# Check if Docker is installed
if command -v docker &> /dev/null; then
    echo -e "${GREEN}✓${NC} Docker installed"
    CHECKS=$((CHECKS + 1))
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗${NC} Docker not found - Install Docker Desktop"
    CHECKS=$((CHECKS + 1))
fi

# Check if docker-compose is installed
if command -v docker-compose &> /dev/null; then
    echo -e "${GREEN}✓${NC} docker-compose installed"
    CHECKS=$((CHECKS + 1))
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗${NC} docker-compose not found"
    CHECKS=$((CHECKS + 1))
fi

# Check if Docker daemon is running
if docker info &> /dev/null; then
    echo -e "${GREEN}✓${NC} Docker daemon running"
    CHECKS=$((CHECKS + 1))
    PASSED=$((PASSED + 1))
else
    echo -e "${YELLOW}⚠${NC} Docker daemon not running - Start Docker Desktop"
    CHECKS=$((CHECKS + 1))
fi

echo ""
echo "📊 Results: $PASSED/$CHECKS checks passed"
echo ""

if [ $PASSED -eq $CHECKS ]; then
    echo -e "${GREEN}✅ Chunk 9 setup is COMPLETE and ready to use!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. cp .env.example .env"
    echo "  2. Edit .env with your secrets"
    echo "  3. docker-compose up --build"
    echo ""
    exit 0
else
    echo -e "${RED}❌ Some checks failed. Please review above.${NC}"
    echo ""
    exit 1
fi

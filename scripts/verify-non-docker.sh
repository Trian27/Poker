#!/bin/bash

# Non-Docker Verification Script
# Tests that all services work with the traditional startup method
# Project Root: /Users/trian/Projects/Poker
# Virtual Environment: poker (via 'workon poker')

set -e  # Exit on error

PROJECT_ROOT="/Users/trian/Projects/Poker"
cd "$PROJECT_ROOT" || exit 1

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔍 Poker Platform Verification (Non-Docker Mode)${NC}"
echo "=================================================="
echo ""
echo "Project Root: $PROJECT_ROOT"
echo "Virtual Env: poker (workon poker)"
echo ""

CHECKS_PASSED=0
CHECKS_TOTAL=0

check_pass() {
    echo -e "${GREEN}✓${NC} $1"
    CHECKS_PASSED=$((CHECKS_PASSED + 1))
    CHECKS_TOTAL=$((CHECKS_TOTAL + 1))
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
    CHECKS_TOTAL=$((CHECKS_TOTAL + 1))
}

check_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    CHECKS_TOTAL=$((CHECKS_TOTAL + 1))
}

# ============================================
# 1. Directory Structure
# ============================================
echo -e "${BLUE}📁 Checking Directory Structure...${NC}"

if [ -d "$PROJECT_ROOT/poker-api" ]; then
    check_pass "poker-api directory exists"
else
    check_fail "poker-api directory missing"
fi

if [ -d "$PROJECT_ROOT/poker-agent-api" ]; then
    check_pass "poker-agent-api directory exists"
else
    check_fail "poker-agent-api directory missing"
fi

if [ -d "$PROJECT_ROOT/GameImplementation" ]; then
    check_pass "GameImplementation directory exists"
else
    check_fail "GameImplementation directory missing"
fi

if [ -d "$PROJECT_ROOT/poker-ui" ]; then
    check_pass "poker-ui directory exists"
else
    check_fail "poker-ui directory missing"
fi

echo ""

# ============================================
# 2. Python Virtual Environment
# ============================================
echo -e "${BLUE}🐍 Checking Python Virtual Environment...${NC}"

if [ -f "$HOME/.virtualenvs/poker/bin/activate" ]; then
    check_pass "Virtual environment 'poker' exists at ~/.virtualenvs/poker"
else
    check_fail "Virtual environment 'poker' not found at ~/.virtualenvs/poker"
fi

# Check if workon command exists
if command -v workon &> /dev/null; then
    check_pass "virtualenvwrapper installed (workon command available)"
else
    check_warn "virtualenvwrapper not found (workon command unavailable)"
fi

echo ""

# ============================================
# 3. Python Dependencies
# ============================================
echo -e "${BLUE}📦 Checking Python Dependencies...${NC}"

# Activate virtualenv and check packages
source "$HOME/.virtualenvs/poker/bin/activate" 2>/dev/null || true

if python -c "import fastapi" 2>/dev/null; then
    check_pass "FastAPI installed"
else
    check_fail "FastAPI not installed"
fi

if python -c "import uvicorn" 2>/dev/null; then
    check_pass "Uvicorn installed"
else
    check_fail "Uvicorn not installed"
fi

if python -c "import sqlalchemy" 2>/dev/null; then
    check_pass "SQLAlchemy installed"
else
    check_fail "SQLAlchemy not installed"
fi

if python -c "import httpx" 2>/dev/null; then
    check_pass "httpx installed"
else
    check_fail "httpx not installed"
fi

echo ""

# ============================================
# 4. Node.js Dependencies
# ============================================
echo -e "${BLUE}📦 Checking Node.js Dependencies...${NC}"

if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    check_pass "Node.js installed ($NODE_VERSION)"
else
    check_fail "Node.js not installed"
fi

if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    check_pass "npm installed ($NPM_VERSION)"
else
    check_fail "npm not installed"
fi

if [ -d "$PROJECT_ROOT/GameImplementation/node_modules" ]; then
    check_pass "GameImplementation dependencies installed"
else
    check_warn "GameImplementation dependencies not installed (run: cd GameImplementation && npm install)"
fi

if [ -d "$PROJECT_ROOT/poker-ui/node_modules" ]; then
    check_pass "poker-ui dependencies installed"
else
    check_warn "poker-ui dependencies not installed (run: cd poker-ui && npm install)"
fi

echo ""

# ============================================
# 5. Database Services
# ============================================
echo -e "${BLUE}🗄️  Checking Database Services...${NC}"

# Check PostgreSQL
if command -v psql &> /dev/null; then
    check_pass "PostgreSQL client installed"
    
    # Try to connect
    if psql -U trian -d poker_platform -c "SELECT 1" &> /dev/null; then
        check_pass "PostgreSQL database 'poker_platform' accessible"
    else
        check_warn "PostgreSQL database 'poker_platform' not accessible (may need to be running)"
    fi
else
    check_warn "PostgreSQL client not found"
fi

# Check Redis
if command -v redis-cli &> /dev/null; then
    check_pass "Redis client installed"
    
    # Try to ping Redis
    if redis-cli ping &> /dev/null 2>&1; then
        check_pass "Redis server is running and accessible"
    else
        check_warn "Redis server not running (start with: redis-server)"
    fi
else
    check_warn "Redis client not found"
fi

echo ""

# ============================================
# 6. Configuration Files
# ============================================
echo -e "${BLUE}⚙️  Checking Configuration Files...${NC}"

if [ -f "$PROJECT_ROOT/docker-compose.yml" ]; then
    check_pass "docker-compose.yml exists (for future Docker use)"
else
    check_fail "docker-compose.yml missing"
fi

if [ -f "$PROJECT_ROOT/start-all.sh" ]; then
    check_pass "start-all.sh exists"
else
    check_fail "start-all.sh missing"
fi

if [ -f "$PROJECT_ROOT/stop-all.sh" ]; then
    check_pass "stop-all.sh exists"
else
    check_fail "stop-all.sh missing"
fi

echo ""

# ============================================
# 7. Build Verification
# ============================================
echo -e "${BLUE}🔨 Checking Build Artifacts...${NC}"

if [ -d "$PROJECT_ROOT/GameImplementation/dist" ]; then
    check_pass "GameImplementation TypeScript compiled (dist/ exists)"
else
    check_warn "GameImplementation not built (run: cd GameImplementation && npm run build)"
fi

if [ -d "$PROJECT_ROOT/poker-ui/dist" ]; then
    check_pass "poker-ui React built (dist/ exists)"
else
    check_warn "poker-ui not built (run: cd poker-ui && npm run build)"
fi

echo ""

# ============================================
# 8. Docker Files (for future use)
# ============================================
echo -e "${BLUE}🐳 Checking Docker Files (for future containerization)...${NC}"

if [ -f "$PROJECT_ROOT/poker-ui/Dockerfile" ]; then
    check_pass "poker-ui/Dockerfile exists"
else
    check_fail "poker-ui/Dockerfile missing"
fi

if [ -f "$PROJECT_ROOT/GameImplementation/Dockerfile" ]; then
    check_pass "GameImplementation/Dockerfile exists"
else
    check_fail "GameImplementation/Dockerfile missing"
fi

if [ -f "$PROJECT_ROOT/poker-api/Dockerfile" ]; then
    check_pass "poker-api/Dockerfile exists"
else
    check_fail "poker-api/Dockerfile missing"
fi

if [ -f "$PROJECT_ROOT/poker-agent-api/Dockerfile" ]; then
    check_pass "poker-agent-api/Dockerfile exists"
else
    check_fail "poker-agent-api/Dockerfile missing"
fi

# Check if Docker is installed
if command -v docker &> /dev/null; then
    check_pass "Docker installed (ready for containerization)"
else
    check_warn "Docker not installed (optional - see installation guide below)"
fi

echo ""

# ============================================
# Summary
# ============================================
echo "=================================================="
echo -e "${BLUE}📊 Results: $CHECKS_PASSED/$CHECKS_TOTAL checks passed${NC}"
echo "=================================================="
echo ""

if [ $CHECKS_PASSED -eq $CHECKS_TOTAL ]; then
    echo -e "${GREEN}✅ All checks passed! Platform is ready to run.${NC}"
    echo ""
    echo "Start the platform with:"
    echo "  ./start-all.sh"
    echo ""
    exit 0
elif [ $CHECKS_PASSED -ge $((CHECKS_TOTAL * 3 / 4)) ]; then
    echo -e "${YELLOW}⚠️  Most checks passed. Platform should work with minor issues.${NC}"
    echo ""
    echo "Start the platform with:"
    echo "  ./start-all.sh"
    echo ""
    exit 0
else
    echo -e "${RED}❌ Several checks failed. Please review above.${NC}"
    echo ""
    exit 1
fi

# ============================================
# Docker Installation Guide (informational)
# ============================================
echo ""
echo -e "${BLUE}📝 Docker Installation (Optional - For Future Use):${NC}"
echo "=================================================="
echo ""
echo "Docker is NOT required to run the platform currently."
echo "It's set up for future containerization when you're ready."
echo ""
echo "To install Docker Desktop (macOS):"
echo "  1. Visit: https://www.docker.com/products/docker-desktop"
echo "  2. Download Docker Desktop for Mac"
echo "  3. Install and start Docker Desktop"
echo "  4. Verify: docker --version"
echo "  5. Then run: docker-compose up --build"
echo ""

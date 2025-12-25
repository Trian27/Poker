# Poker Platform API

FastAPI service for authentication, league/community management, and wallet operations.

## Features

- **User Authentication**: Registration and JWT-based login
- **League Management**: Create and manage poker leagues
- **Community Management**: Sub-groups within leagues with isolated currency
- **Wallet System**: Player balances per community with debit/credit operations
- **Internal API**: Endpoints for game server to verify tokens and handle money

## Quick Start

### 1. Activate Virtual Environment

```bash
source venv/bin/activate
```

### 2. Run the Server

```bash
uvicorn app.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`

### 3. View API Documentation

FastAPI automatically generates interactive API documentation:

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## Database

The API uses PostgreSQL with SQLAlchemy ORM. Database: `poker_platform`

### Models

- **User**: User accounts with authentication
- **League**: Top-level organizations
- **Community**: Sub-groups within leagues (isolated currency)
- **Wallet**: Player balance in a specific community

## API Endpoints

### Public Endpoints (Authentication Required)

- `/auth/register`: Register a new user
- `/auth/login`: Login and receive JWT
- `/leagues`: Manage leagues
- `/communities`: Manage communities within leagues
- `/wallets`: Perform wallet operations

## Next Steps

1. Add more detailed error handling.
2. Implement rate limiting for public endpoints.
3. Add support for multi-currency wallets.

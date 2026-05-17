# Poker Platform Project

## Overview
The Poker Platform is a comprehensive system designed to manage online poker games. It includes features for player management, game logic, queue systems, and integration with external services like Redis and PostgreSQL. The platform is modular, with separate components for the backend API, game logic, and user interface.

## Project Structure

### 1. **Backend APIs**
- **`poker-api/`**: The main backend API for managing poker tables, player actions, and game states.
  - Built with Python (FastAPI).
  - Handles database interactions with PostgreSQL.
  - Key Features:
    - Player management.
    - Table and queue systems.
    - Action timeout logic.
    - See [poker-api/README.md](poker-api/README.md) for details.
- **`poker-agent-api/`**: Manages WebSocket communication for real-time updates.
  - Built with Python.
  - Handles agent-based interactions and seat selection.
  - See [poker-agent-api/README.md](poker-agent-api/README.md) for details.

### 2. **Game Logic**
- **`GameImplementation/`**: Contains the core game logic.
  - Built with Node.js.
  - Implements game rules, action timers, and player interactions.
  - See [GameImplementation/README.md](GameImplementation/README.md) for details.

### 3. **Frontend**
- **`poker-ui/`**: The user interface for the poker platform.
  - Built with modern web technologies (React, Vite).
  - Provides a responsive and interactive experience for players.
  - See [poker-ui/README.md](poker-ui/README.md) for details.

### 4. **Testing**
- Multiple test scripts are available for unit and integration testing.
  - Example: `test_action_timeout.py`, `test_auto_seat_queue.py`.

### 5. **Deployment**
- Dockerized setup for easy deployment.
  - `docker-compose.yml`: Orchestrates all services.
  - `docker-health-check.sh`: Verifies the health of running services.

## Key Features

### 1. **Action Timeout System**
- Ensures players act within a specified time.
- Automatically folds or checks if the timer expires.
- Fully tested with `test_action_timeout.py`.

### 2. **Auto-Seat Queue System**
- Automatically seats players from a queue when a spot becomes available.
- Validates player wallet balance before seating.
- Tested at the API level with `test_auto_seat_queue.py`.

### 3. **Redis Integration**
- Caches game states and player data for fast access.
- Fully documented in `REDIS_INTEGRATION.md`.

### 4. **WebSocket Communication**
- Real-time updates for player actions and game states.
- Managed by `poker-agent-api/`.

### 5. **Frontend Features**
- Interactive UI for joining tables, playing games, and viewing history.
- Built with React and styled for responsiveness.

## How to Run

### Prerequisites
- Docker and Docker Compose installed.
- Node.js and Python installed for development.
- Copy `.env.example` to `.env` and set `PYTHON_BIN` to the exact Python interpreter inside your local virtual environment.

### Local Python Configuration
Repo shell scripts do not rely on activating a virtualenv in your shell. They read `PYTHON_BIN` from `.env` and use that interpreter directly.

Example:

```dotenv
PYTHON_BIN=/Users/your-user/.virtualenvs/poker/bin/python
```

### Steps
1. Clone the repository:
  ```bash
  git clone <repository-url>
  cd Poker
  ```
2. Copy the environment template and set your Python interpreter:
  ```bash
  cp .env.example .env
  # Edit .env and set PYTHON_BIN to your virtualenv's python
  ```
3. Start all services (Docker):
  ```bash
  docker-compose up --build
  ```
4. Start all services (Non-Docker, development mode):
  ```bash
  ./scripts/start-all.sh
  ```
5. Stop all services (Non-Docker):
  ```bash
  ./scripts/stop-all.sh
  ```
6. Verify services are running:
  ```bash
  ./docker-health-check.sh
  ```
7. Access the platform:
  - Backend API: `http://localhost:8000`
  - Game Server: `http://localhost:3000`
  - Frontend: `http://localhost:5173`

### Test Entry Points
Run the repo test driver from the project root:

```bash
./scripts/test-gameplay.sh full
./scripts/test-gameplay.sh compose-browser-pr-smoke
./scripts/test-gameplay.sh compose-autonomous
./scripts/test-gameplay.sh compose-browser-e2e
```

### Browser Test Layers
- Mocked UI smoke:
  - `npm run test:e2e:gameplay`
  - fast PR UI and routing sanity
- Compose Browser PR Smoke:
  - `./scripts/test-gameplay.sh compose-browser-pr-smoke`
  - required real-stack happy path only
- Compose Browser E2E:
  - `./scripts/test-gameplay.sh compose-browser-e2e`
  - scheduled/manual heavy suite for happy path + queue + reconnect

## Additional Guides

### Deployment Guide
For detailed deployment instructions, see [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md).

### Quickstart Guide
For a quick setup, see [QUICKSTART.md](docs/QUICKSTART.md).

### Docker Guide
For containerized deployment, see [DOCKER_GUIDE.md](docs/DOCKER_GUIDE.md).

### Technical Decisions
For architectural decisions and design patterns, see [TECHNICAL_DECISIONS.md](docs/TECHNICAL_DECISIONS.md).

### Testing Status
For testing coverage and status, see [TESTING_STATUS.md](docs/TESTING_STATUS.md).

### Operations Runbook
For maintenance safety checks (including DB target verification before cleanup), see [OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md).

## Contributing
1. Fork the repository.
2. Create a feature branch.
3. Submit a pull request.

## License
This project is licensed under the MIT License.

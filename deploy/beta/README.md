# Beta Deployment Stack

This directory contains the production-shaped beta deployment files.

## Files

- `../../docker-compose.beta.yml` - standalone beta stack
- `Caddyfile` - same-origin reverse proxy for UI, API, and Socket.IO
- `.env.beta.example` - server-side environment template

## First Run

1. Copy `.env.beta.example` to `.env.beta` and fill in real values.
2. Ensure the G5 runtime bundle exists at `./.runtime/engines/g5/current/app`.
3. Start the stack:

```bash
docker compose --env-file deploy/beta/.env.beta -f docker-compose.beta.yml up -d --build
```

## Health Checks

- public app: `https://<your-domain>/`
- API health: `https://<your-domain>/health`
- internal game health: `docker compose --env-file deploy/beta/.env.beta -f docker-compose.beta.yml exec game-server wget -q -O - http://127.0.0.1:3000/health`

## Backups

Use `scripts/backup-postgres.sh` from the repo root:

```bash
./scripts/backup-postgres.sh docker-compose.beta.yml backups/postgres deploy/beta/.env.beta
```

If `deploy/beta/.env.beta` exists, the script auto-detects it for the beta compose file.

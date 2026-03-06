# Operations Runbook

This runbook exists to prevent production/dev mix-ups during maintenance tasks (especially database cleanup).

## Database Target Safety Checklist

Before running any delete/truncate script:

1. Confirm which stack is live.
   - Docker:
     ```bash
     cd /Users/trian/Projects/Poker
     docker-compose ps
     ```
   - Local processes:
     ```bash
     lsof -iTCP -sTCP:LISTEN -n -P | rg ':(5173|8000|8001|3000|5432)\b'
     ```

2. Confirm which database the running auth API is using.
   - Docker auth-api:
     ```bash
     docker-compose exec -T auth-api printenv DATABASE_URL
     ```
   - Local auth-api process:
     - Check `poker-api/app/config.py` default and current shell environment:
     ```bash
     echo "$DATABASE_URL"
     ```

3. Inspect data in the target DB first.
   - Docker DB:
     ```bash
     docker-compose exec -T postgres-db psql -U poker_user -d poker_db -c "SELECT id, name FROM leagues ORDER BY id;"
     docker-compose exec -T postgres-db psql -U poker_user -d poker_db -c "SELECT id, name FROM communities ORDER BY id;"
     ```
   - Local DB:
     ```bash
     psql -d poker_platform -c "SELECT id, name FROM leagues ORDER BY id;"
     psql -d poker_platform -c "SELECT id, name FROM communities ORDER BY id;"
     ```

4. Run cleanup on the confirmed target only.

5. Verify with both SQL and API.
   - SQL:
     ```bash
     # Example (Docker)
     docker-compose exec -T postgres-db psql -U poker_user -d poker_db -c "SELECT COUNT(*) FROM leagues;"
     docker-compose exec -T postgres-db psql -U poker_user -d poker_db -c "SELECT COUNT(*) FROM communities;"
     ```
   - API:
     ```bash
     curl -s -H "Authorization: Bearer <token>" http://localhost:8000/api/leagues
     ```

## Full Non-User Data Cleanup (Keep Accounts)

Use this only after checklist confirmation. This preserves `users` and removes platform/game entities.

```sql
BEGIN;
TRUNCATE TABLE
  coin_purchase_intents,
  communities,
  community_admins,
  creator_payout_requests,
  direct_messages,
  email_verifications,
  feedback_reports,
  hand_history,
  inbox_messages,
  join_requests,
  league_admins,
  league_join_requests,
  league_members,
  leagues,
  player_notes,
  session_hands,
  skin_submissions,
  skins,
  table_queue,
  table_seats,
  table_sessions,
  tables,
  tournament_payouts,
  tournament_registrations,
  tournaments,
  user_skins,
  wallets
RESTART IDENTITY CASCADE;
COMMIT;
```

## Incident Note (2026-03-05)

A cleanup was first run against local DB (`poker_platform`) while the UI/API were connected to Docker DB (`poker_db`), so old leagues still appeared in UI.  
Preventive action: always run the checklist above before destructive operations.

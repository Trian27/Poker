# Autonomous Bot Gameplay Testing

This guide gives you a repeatable way to test real bot gameplay end-to-end.

## What This Validates
- bot account registration/login
- league/community/table provisioning (UI-only policy)
- table seat assignment and game-server seating sync
- autonomous bot websocket connection and gameplay actions
- hand history recording for participants

## UI-Only Creation Policy

Creation endpoints for leagues/communities/tables are restricted to browser UI requests.

- Use the web UI to create leagues, communities, and tables.
- Direct scripted creation calls are intentionally blocked.
- Bot agents still join/play using normal authenticated accounts after the table exists.

## Script Added
- [`scripts/test_autonomous_bot_gameplay.py`](/Users/trian/Projects/Poker/scripts/test_autonomous_bot_gameplay.py)

## Prerequisites
1. Start services:
   - auth API (`:8000`)
   - game server (`:3000`)
   - optional UI (`:5173`) for human-vs-bot mode
2. Use a dev/test environment where registration does not require email verification.
3. Activate your Python environment with required deps:
   - `requests`
   - `python-jose`
   - `python-socketio[client]`

## Mode 1: Fully Automated Bot-vs-Bot
Run from repo root:

```bash
workon poker
python scripts/test_autonomous_bot_gameplay.py --mode bot-vs-bot
```

Expected result:
- both bot agents connect
- at least one hand is completed
- both participants have matching hand-history entries
- script exits `0` with `SMOKE TEST PASSED`

Note: if your environment has UI-only creation enabled, this mode must use pre-existing UI-created table/community setup instead of script provisioning.

If your environment requires email verification for registration, use existing verified users:

```bash
workon poker
python scripts/test_autonomous_bot_gameplay.py \
  --mode bot-vs-bot \
  --setup-username <setup_user> --setup-user-password <setup_pass> \
  --bot1-username <bot_user_1> --bot1-password <bot_pass_1> \
  --bot2-username <bot_user_2> --bot2-password <bot_pass_2>
```

## Mode 2: Human-vs-Bot (Manual Gameplay Validation)
Run:

```bash
workon poker
python scripts/test_autonomous_bot_gameplay.py --mode human-vs-bot --timeout-seconds 420
```

The script prints:
- generated human username/password
- community URL
- direct game URL

Use those credentials in the UI and play at least one full hand against the bot.
The script passes when both users have recorded hand history for the test table.

### UI-Assisted API Join

From Community Lobby:
1. Click `Join Table`.
2. In the seat modal, click `Join via API`.
3. Copy the generated snippet. It includes:
   - login command for a bot account
   - optional seat join call
   - `agent_websocket.py` command with the correct `table_<id>` game id

If registration requires email verification, pass existing verified accounts:

```bash
workon poker
python scripts/test_autonomous_bot_gameplay.py \
  --mode human-vs-bot --timeout-seconds 420 \
  --setup-username <setup_user> --setup-user-password <setup_pass> \
  --human-username <human_user> --human-password <human_pass> \
  --bot1-username <bot_user> --bot1-password <bot_pass>
```

## Useful Flags
- `--auth-api-url http://localhost:8000`
- `--game-server-url http://localhost:3000`
- `--ui-url http://localhost:5173`
- `--buy-in 1000`
- `--small-blind 10 --big-blind 20`
- `--action-timeout-seconds 10`
- `--timeout-seconds 240`
- `--poll-interval-seconds 2`

## Troubleshooting
1. `Registration requires email verification`:
   - Run in dev mode, or use pre-verified users.
2. `Timed out waiting for bot websocket connections`:
   - Verify game server is up and reachable at `:3000`.
3. `Timed out waiting for recorded hand history`:
   - Check game-server and auth-api logs for action processing and hand recording.
   - Ensure users were seated successfully and bots connected.
4. `Seat occupied` or join failures:
   - rerun script; each run uses unique users/table names.

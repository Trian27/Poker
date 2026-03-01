# Tournament Settings Implementation (Current Decisions)

This documents what was implemented for the latest tournament-settings update, including defaults chosen where behavior was unspecified.

## Implemented behavior

- Community members can create tournament tables.
- Tournament creation now supports:
  - `start time`
  - `player limit` (preset options only: `2`, `4`, `8`)
  - `buy-in`
  - `security deposit`
  - `starting blinds` (`small blind`, `big blind`)
  - `starting stack`
  - `blind progression settings`
  - `payout settings` (percentage or fixed, with permission checks)
- Tournament registration now charges both:
  - entry fee (`buy_in`)
  - security deposit
- Before start, registered players can unregister and receive a full refund (entry + deposit).
- At start time, tournament moves into a final confirmation state (`awaiting_confirmations`).
- Registered players must confirm participation within the confirmation window.
- If a player fails to confirm in time:
  - they are marked `no_show`
  - their entry fee is refunded
  - their security deposit is forfeited
- If fewer than 2 players are confirmed by deadline, tournament is canceled and confirmed players are refunded.
- When tournament starts running:
  - confirmed players are seeded
  - bracket JSON is generated
  - payout amounts are locked for display in bracket metadata

## Payout rules implemented

- Non-commissioner/non-global-admin creators can only use percentage payouts.
- Community commissioners and global admins can use:
  - percentage payouts, or
  - fixed chip payouts (including totals above collected entry fees)
- Default percentage payout (if omitted): `60,30,10`

## Bracket fairness decisions

- Bracket generator now uses a staged layout that balances first-stage table sizes.
- It tries to avoid opening heads-up tables when there are larger tables that can donate a player.
- If a heads-up first table is mathematically unavoidable, this is noted in bracket fairness notes.

## Defaults chosen

- Allowed tournament player limits: `2`, `4`, `8`
- Default security deposit: `10%` of buy-in (rounded up)
- Default confirmation window: `60s`
- Default blind interval: `10 minutes`
- Default blind progression: `+50%` per blind level
- If start time is reached with fewer than 2 registrations:
  - state becomes `waiting_for_players`
  - start time auto-reschedules by `5 minutes`

## API additions/changes

- New endpoint:
  - `POST /api/tables/{table_id}/tournament/confirm`
- Updated payload/response support for tournament fields:
  - security deposit
  - confirmation window/deadline
  - blind progression settings
  - payout mode (`percentage` vs `fixed`)

## Database changes

Migration added:
- `poker-api/migrations/017_tournament_settings_upgrade.sql`

New table columns include:
- tournament settings fields on `tables`
- security deposit + confirmation timestamp on `tournament_registrations`

## UI updates

Community lobby tournament create/edit UX now supports:
- player-limit presets (2/4/8)
- security deposit input
- confirmation window input
- blind progression inputs
- payout mode toggle + payout editing
- start-time confirmation button when tournament enters confirmation state

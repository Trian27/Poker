-- Migration 017: Tournament settings, confirmation window, and security deposit support

ALTER TABLE tables
    ADD COLUMN IF NOT EXISTS tournament_security_deposit INTEGER NOT NULL DEFAULT 0;

ALTER TABLE tables
    ADD COLUMN IF NOT EXISTS tournament_confirmation_window_seconds INTEGER NOT NULL DEFAULT 60;

ALTER TABLE tables
    ADD COLUMN IF NOT EXISTS tournament_confirmation_deadline TIMESTAMPTZ;

ALTER TABLE tables
    ADD COLUMN IF NOT EXISTS tournament_blind_interval_minutes INTEGER NOT NULL DEFAULT 10;

ALTER TABLE tables
    ADD COLUMN IF NOT EXISTS tournament_blind_progression_percent INTEGER NOT NULL DEFAULT 50;

ALTER TABLE tables
    ADD COLUMN IF NOT EXISTS tournament_payout_is_percentage BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE tournament_registrations
    ADD COLUMN IF NOT EXISTS paid_security_deposit INTEGER NOT NULL DEFAULT 0;

ALTER TABLE tournament_registrations
    ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

-- Backfill existing tournament rows with a reasonable default security deposit (10% of buy-in)
UPDATE tables
SET tournament_security_deposit = CASE
    WHEN buy_in > 0 THEN GREATEST(0, CEIL(buy_in * 0.10)::INTEGER)
    ELSE 0
END
WHERE (game_type = 'TOURNAMENT' OR LOWER(game_type::text) = 'tournament')
  AND COALESCE(tournament_security_deposit, 0) = 0;

ALTER TABLE tables
    DROP CONSTRAINT IF EXISTS chk_tables_tournament_confirmation_window_range;

ALTER TABLE tables
    ADD CONSTRAINT chk_tables_tournament_confirmation_window_range
    CHECK (tournament_confirmation_window_seconds BETWEEN 30 AND 300);

ALTER TABLE tables
    DROP CONSTRAINT IF EXISTS chk_tables_tournament_blind_interval_range;

ALTER TABLE tables
    ADD CONSTRAINT chk_tables_tournament_blind_interval_range
    CHECK (tournament_blind_interval_minutes BETWEEN 2 AND 120);

ALTER TABLE tables
    DROP CONSTRAINT IF EXISTS chk_tables_tournament_blind_progression_range;

ALTER TABLE tables
    ADD CONSTRAINT chk_tables_tournament_blind_progression_range
    CHECK (tournament_blind_progression_percent BETWEEN 10 AND 300);

ALTER TABLE tables
    DROP CONSTRAINT IF EXISTS chk_tables_tournament_security_deposit_non_negative;

ALTER TABLE tables
    ADD CONSTRAINT chk_tables_tournament_security_deposit_non_negative
    CHECK (tournament_security_deposit >= 0);

ALTER TABLE tournament_registrations
    DROP CONSTRAINT IF EXISTS chk_tournament_registrations_security_deposit_non_negative;

ALTER TABLE tournament_registrations
    ADD CONSTRAINT chk_tournament_registrations_security_deposit_non_negative
    CHECK (paid_security_deposit >= 0);

CREATE INDEX IF NOT EXISTS idx_tables_tournament_confirmation_deadline
    ON tables(tournament_confirmation_deadline);

CREATE INDEX IF NOT EXISTS idx_tournament_registrations_confirmed_at
    ON tournament_registrations(confirmed_at);

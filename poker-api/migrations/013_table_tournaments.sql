-- Migration 013: Table-scoped tournament scheduling, registrations, and brackets

ALTER TABLE tables
    ADD COLUMN IF NOT EXISTS tournament_start_time TIMESTAMPTZ;

ALTER TABLE tables
    ADD COLUMN IF NOT EXISTS tournament_starting_stack INTEGER NOT NULL DEFAULT 1000;

ALTER TABLE tables
    ADD COLUMN IF NOT EXISTS tournament_state VARCHAR(30);

ALTER TABLE tables
    ADD COLUMN IF NOT EXISTS tournament_payout JSONB;

ALTER TABLE tables
    ADD COLUMN IF NOT EXISTS tournament_prize_pool INTEGER NOT NULL DEFAULT 0;

ALTER TABLE tables
    ADD COLUMN IF NOT EXISTS tournament_bracket JSONB;

ALTER TABLE tables
    ADD COLUMN IF NOT EXISTS tournament_started_at TIMESTAMPTZ;

ALTER TABLE tables
    ADD COLUMN IF NOT EXISTS tournament_completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tables_tournament_start_time ON tables(tournament_start_time);
CREATE INDEX IF NOT EXISTS idx_tables_tournament_state ON tables(tournament_state);

CREATE TABLE IF NOT EXISTS tournament_registrations (
    id SERIAL PRIMARY KEY,
    table_id INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'registered',
    paid_entry_fee INTEGER NOT NULL DEFAULT 0,
    starting_stack INTEGER NOT NULL DEFAULT 1000,
    seed INTEGER,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    CONSTRAINT uq_tournament_registration UNIQUE (table_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tournament_registrations_table_id ON tournament_registrations(table_id);
CREATE INDEX IF NOT EXISTS idx_tournament_registrations_user_id ON tournament_registrations(user_id);
CREATE INDEX IF NOT EXISTS idx_tournament_registrations_status ON tournament_registrations(table_id, status);

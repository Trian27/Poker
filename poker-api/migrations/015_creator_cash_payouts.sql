-- Migration 015: Creator cash royalty ledger and payout requests

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS creator_cash_pending_cents INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS creator_cash_paid_cents INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS creator_payout_email VARCHAR(255);

CREATE TABLE IF NOT EXISTS creator_payout_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL,
    payout_email VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    processor_note VARCHAR(2000),
    payout_reference VARCHAR(255),
    processed_by_user_id INTEGER REFERENCES users(id),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_creator_payout_requests_user_id ON creator_payout_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_creator_payout_requests_status ON creator_payout_requests(status);
CREATE INDEX IF NOT EXISTS idx_creator_payout_requests_requested_at ON creator_payout_requests(requested_at DESC);

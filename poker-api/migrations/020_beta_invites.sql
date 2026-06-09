CREATE TABLE IF NOT EXISTS beta_invites (
    id SERIAL PRIMARY KEY,
    email VARCHAR(100) NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    notes VARCHAR(500),
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    redeemed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ NULL,
    used_at TIMESTAMPTZ NULL,
    revoked_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS ix_beta_invites_email
    ON beta_invites (email);

CREATE INDEX IF NOT EXISTS ix_beta_invites_created_at
    ON beta_invites (created_at DESC);

CREATE INDEX IF NOT EXISTS ix_beta_invites_expires_at
    ON beta_invites (expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_beta_invites_pending_email
    ON beta_invites (LOWER(email))
    WHERE used_at IS NULL AND revoked_at IS NULL;

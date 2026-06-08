CREATE TABLE IF NOT EXISTS beta_invites (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    notes TEXT NULL,
    created_by_user_id INTEGER NOT NULL REFERENCES users(id),
    redeemed_by_user_id INTEGER NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ NULL,
    used_at TIMESTAMPTZ NULL,
    revoked_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_beta_invites_token_hash
    ON beta_invites (token_hash);

CREATE INDEX IF NOT EXISTS idx_beta_invites_email
    ON beta_invites (email);

CREATE INDEX IF NOT EXISTS idx_beta_invites_created_at
    ON beta_invites (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_beta_invites_expires_at
    ON beta_invites (expires_at);

CREATE INDEX IF NOT EXISTS idx_beta_invites_created_by_user_id
    ON beta_invites (created_by_user_id);

CREATE INDEX IF NOT EXISTS idx_beta_invites_redeemed_by_user_id
    ON beta_invites (redeemed_by_user_id)
    WHERE redeemed_by_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_beta_invites_pending_email
    ON beta_invites (LOWER(email))
    WHERE redeemed_by_user_id IS NULL AND used_at IS NULL AND revoked_at IS NULL;

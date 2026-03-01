-- Migration 010: Customization, marketplace, direct messages, tournaments, feedback

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS gold_coins INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS skins (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(120) UNIQUE NOT NULL,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(500),
    category VARCHAR(30) NOT NULL,
    price_gold_coins INTEGER NOT NULL DEFAULT 0,
    design_spec JSONB NOT NULL,
    preview_url VARCHAR(500),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_user_id INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_skins (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skin_id INTEGER NOT NULL REFERENCES skins(id) ON DELETE CASCADE,
    is_equipped BOOLEAN NOT NULL DEFAULT FALSE,
    acquired_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, skin_id)
);

CREATE TABLE IF NOT EXISTS skin_submissions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    category VARCHAR(30) NOT NULL,
    design_spec JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    review_notes VARCHAR(1000),
    reviewed_by_user_id INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS direct_messages (
    id SERIAL PRIMARY KEY,
    sender_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content VARCHAR(2000) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    read_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS coin_purchase_intents (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL DEFAULT 'stripe',
    package_key VARCHAR(50) NOT NULL,
    gold_coins INTEGER NOT NULL,
    usd_cents INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    provider_reference VARCHAR(255),
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tournaments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(1000),
    gold_prize_pool INTEGER NOT NULL,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'announced',
    created_by_user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tournament_payouts (
    id SERIAL PRIMARY KEY,
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rank INTEGER,
    gold_awarded INTEGER NOT NULL,
    awarded_at TIMESTAMPTZ DEFAULT NOW(),
    awarded_by_user_id INTEGER NOT NULL REFERENCES users(id),
    UNIQUE (tournament_id, user_id)
);

CREATE TABLE IF NOT EXISTS feedback_reports (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    feedback_type VARCHAR(20) NOT NULL,
    title VARCHAR(200) NOT NULL,
    description VARCHAR(5000) NOT NULL,
    chief_complaint VARCHAR(100) NOT NULL DEFAULT 'other',
    status VARCHAR(30) NOT NULL DEFAULT 'open',
    context JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skins_category ON skins(category);
CREATE INDEX IF NOT EXISTS idx_user_skins_user ON user_skins(user_id);
CREATE INDEX IF NOT EXISTS idx_skin_submissions_status ON skin_submissions(status);
CREATE INDEX IF NOT EXISTS idx_direct_messages_participants ON direct_messages(sender_user_id, recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_direct_messages_recipient_unread ON direct_messages(recipient_user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_coin_purchase_intents_user ON coin_purchase_intents(user_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);
CREATE INDEX IF NOT EXISTS idx_tournament_payouts_tournament ON tournament_payouts(tournament_id);
CREATE INDEX IF NOT EXISTS idx_feedback_reports_created ON feedback_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_reports_complaint ON feedback_reports(chief_complaint);

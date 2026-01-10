-- Migration 006: League and community admin roles
-- Adds local admin tables for leagues and communities

CREATE TABLE IF NOT EXISTS league_admins (
    id SERIAL PRIMARY KEY,
    league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_by_user_id INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (league_id, user_id)
);

CREATE TABLE IF NOT EXISTS community_admins (
    id SERIAL PRIMARY KEY,
    community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_by_user_id INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (community_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_league_admins_league ON league_admins(league_id);
CREATE INDEX IF NOT EXISTS idx_league_admins_user ON league_admins(user_id);
CREATE INDEX IF NOT EXISTS idx_community_admins_community ON community_admins(community_id);
CREATE INDEX IF NOT EXISTS idx_community_admins_user ON community_admins(user_id);

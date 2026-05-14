-- Migration 018: Run-scoped test partition and fixture lifecycle registry

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_test_user BOOLEAN;
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS test_run_tag VARCHAR(128);

UPDATE users
SET is_test_user = FALSE
WHERE is_test_user IS NULL;

ALTER TABLE users
    ALTER COLUMN is_test_user SET DEFAULT FALSE;
ALTER TABLE users
    ALTER COLUMN is_test_user SET NOT NULL;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS chk_users_test_partition_consistency;
ALTER TABLE users
    ADD CONSTRAINT chk_users_test_partition_consistency
    CHECK (
        (is_test_user = TRUE AND test_run_tag IS NOT NULL)
        OR
        (is_test_user = FALSE AND test_run_tag IS NULL)
    );

ALTER TABLE leagues
    ADD COLUMN IF NOT EXISTS is_test_only BOOLEAN;
ALTER TABLE leagues
    ADD COLUMN IF NOT EXISTS test_run_tag VARCHAR(128);

UPDATE leagues
SET is_test_only = FALSE
WHERE is_test_only IS NULL;

ALTER TABLE leagues
    ALTER COLUMN is_test_only SET DEFAULT FALSE;
ALTER TABLE leagues
    ALTER COLUMN is_test_only SET NOT NULL;

ALTER TABLE leagues
    DROP CONSTRAINT IF EXISTS chk_leagues_test_partition_consistency;
ALTER TABLE leagues
    ADD CONSTRAINT chk_leagues_test_partition_consistency
    CHECK (
        (is_test_only = TRUE AND test_run_tag IS NOT NULL)
        OR
        (is_test_only = FALSE AND test_run_tag IS NULL)
    );

ALTER TABLE communities
    ADD COLUMN IF NOT EXISTS is_test_only BOOLEAN;
ALTER TABLE communities
    ADD COLUMN IF NOT EXISTS test_run_tag VARCHAR(128);

UPDATE communities
SET is_test_only = FALSE
WHERE is_test_only IS NULL;

ALTER TABLE communities
    ALTER COLUMN is_test_only SET DEFAULT FALSE;
ALTER TABLE communities
    ALTER COLUMN is_test_only SET NOT NULL;

ALTER TABLE communities
    DROP CONSTRAINT IF EXISTS chk_communities_test_partition_consistency;
ALTER TABLE communities
    ADD CONSTRAINT chk_communities_test_partition_consistency
    CHECK (
        (is_test_only = TRUE AND test_run_tag IS NOT NULL)
        OR
        (is_test_only = FALSE AND test_run_tag IS NULL)
    );

ALTER TABLE tables
    ADD COLUMN IF NOT EXISTS is_test_only BOOLEAN;
ALTER TABLE tables
    ADD COLUMN IF NOT EXISTS test_run_tag VARCHAR(128);

UPDATE tables
SET is_test_only = FALSE
WHERE is_test_only IS NULL;

ALTER TABLE tables
    ALTER COLUMN is_test_only SET DEFAULT FALSE;
ALTER TABLE tables
    ALTER COLUMN is_test_only SET NOT NULL;

ALTER TABLE tables
    DROP CONSTRAINT IF EXISTS chk_tables_test_partition_consistency;
ALTER TABLE tables
    ADD CONSTRAINT chk_tables_test_partition_consistency
    CHECK (
        (is_test_only = TRUE AND test_run_tag IS NOT NULL)
        OR
        (is_test_only = FALSE AND test_run_tag IS NULL)
    );

ALTER TABLE hand_history
    ADD COLUMN IF NOT EXISTS is_test_only BOOLEAN;
ALTER TABLE hand_history
    ADD COLUMN IF NOT EXISTS test_run_tag VARCHAR(128);

UPDATE hand_history
SET is_test_only = FALSE
WHERE is_test_only IS NULL;

ALTER TABLE hand_history
    ALTER COLUMN is_test_only SET DEFAULT FALSE;
ALTER TABLE hand_history
    ALTER COLUMN is_test_only SET NOT NULL;

ALTER TABLE hand_history
    DROP CONSTRAINT IF EXISTS chk_hand_history_test_partition_consistency;
ALTER TABLE hand_history
    ADD CONSTRAINT chk_hand_history_test_partition_consistency
    CHECK (
        (is_test_only = TRUE AND test_run_tag IS NOT NULL)
        OR
        (is_test_only = FALSE AND test_run_tag IS NULL)
    );

ALTER TABLE table_sessions
    ADD COLUMN IF NOT EXISTS is_test_only BOOLEAN;
ALTER TABLE table_sessions
    ADD COLUMN IF NOT EXISTS test_run_tag VARCHAR(128);

UPDATE table_sessions
SET is_test_only = FALSE
WHERE is_test_only IS NULL;

ALTER TABLE table_sessions
    ALTER COLUMN is_test_only SET DEFAULT FALSE;
ALTER TABLE table_sessions
    ALTER COLUMN is_test_only SET NOT NULL;

ALTER TABLE table_sessions
    DROP CONSTRAINT IF EXISTS chk_table_sessions_test_partition_consistency;
ALTER TABLE table_sessions
    ADD CONSTRAINT chk_table_sessions_test_partition_consistency
    CHECK (
        (is_test_only = TRUE AND test_run_tag IS NOT NULL)
        OR
        (is_test_only = FALSE AND test_run_tag IS NULL)
    );

CREATE TABLE IF NOT EXISTS test_fixture_runs (
    run_tag VARCHAR(128) PRIMARY KEY,
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
    player_count INTEGER NOT NULL,
    queued_player_count INTEGER NOT NULL,
    league_id INTEGER NULL REFERENCES leagues(id) ON DELETE SET NULL,
    community_id INTEGER NULL REFERENCES communities(id) ON DELETE SET NULL,
    table_id INTEGER NULL REFERENCES tables(id) ON DELETE SET NULL,
    game_id VARCHAR(255) NULL,
    last_create_error TEXT NULL,
    last_cleanup_error TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_test_run
    ON users(test_run_tag)
    WHERE is_test_user = TRUE;

CREATE INDEX IF NOT EXISTS idx_leagues_test_run
    ON leagues(test_run_tag)
    WHERE is_test_only = TRUE;

CREATE INDEX IF NOT EXISTS idx_communities_test_run
    ON communities(test_run_tag)
    WHERE is_test_only = TRUE;

CREATE INDEX IF NOT EXISTS idx_communities_league_partition
    ON communities(league_id, is_test_only, test_run_tag);

CREATE INDEX IF NOT EXISTS idx_tables_test_run
    ON tables(test_run_tag)
    WHERE is_test_only = TRUE;

CREATE INDEX IF NOT EXISTS idx_tables_community_partition
    ON tables(community_id, is_test_only, test_run_tag);

CREATE INDEX IF NOT EXISTS idx_hand_history_test_run
    ON hand_history(test_run_tag, played_at)
    WHERE is_test_only = TRUE;

CREATE INDEX IF NOT EXISTS idx_table_sessions_test_run
    ON table_sessions(test_run_tag, user_id, joined_at)
    WHERE is_test_only = TRUE;

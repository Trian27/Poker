CREATE TABLE IF NOT EXISTS table_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    table_id INTEGER NULL REFERENCES tables(id) ON DELETE SET NULL,
    community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    table_name VARCHAR(100) NOT NULL,
    buy_in_amount INTEGER NOT NULL DEFAULT 0,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS ix_table_sessions_user_id ON table_sessions(user_id);
CREATE INDEX IF NOT EXISTS ix_table_sessions_table_id ON table_sessions(table_id);
CREATE INDEX IF NOT EXISTS ix_table_sessions_joined_at ON table_sessions(joined_at DESC);
CREATE INDEX IF NOT EXISTS ix_table_sessions_active ON table_sessions(user_id, table_id) WHERE left_at IS NULL;

CREATE TABLE IF NOT EXISTS session_hands (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES table_sessions(id) ON DELETE CASCADE,
    hand_id UUID NOT NULL REFERENCES hand_history(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_session_hand UNIQUE(session_id, hand_id)
);

CREATE INDEX IF NOT EXISTS ix_session_hands_session_id ON session_hands(session_id);
CREATE INDEX IF NOT EXISTS ix_session_hands_hand_id ON session_hands(hand_id);

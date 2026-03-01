-- Migration 016: Persistent cross-table player notes

CREATE TABLE IF NOT EXISTS player_notes (
    id SERIAL PRIMARY KEY,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notes VARCHAR(2000) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_player_note_owner_target UNIQUE (owner_user_id, target_user_id),
    CONSTRAINT ck_player_note_not_self CHECK (owner_user_id <> target_user_id)
);

CREATE INDEX IF NOT EXISTS idx_player_notes_owner_user_id ON player_notes(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_player_notes_target_user_id ON player_notes(target_user_id);

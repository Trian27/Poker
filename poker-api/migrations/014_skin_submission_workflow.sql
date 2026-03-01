-- Migration 014: Skin submission workflow, pricing preferences, and creator/admin decision loop

ALTER TABLE skin_submissions
    ADD COLUMN IF NOT EXISTS desired_price_gold_coins INTEGER NOT NULL DEFAULT 100;

ALTER TABLE skin_submissions
    ADD COLUMN IF NOT EXISTS reference_image_url VARCHAR(1000);

ALTER TABLE skin_submissions
    ADD COLUMN IF NOT EXISTS submitter_notes VARCHAR(2000);

ALTER TABLE skin_submissions
    ADD COLUMN IF NOT EXISTS workflow_state VARCHAR(50) NOT NULL DEFAULT 'pending_admin_review';

ALTER TABLE skin_submissions
    ADD COLUMN IF NOT EXISTS admin_proposed_design_spec JSONB;

ALTER TABLE skin_submissions
    ADD COLUMN IF NOT EXISTS admin_rendered_image_url VARCHAR(1000);

ALTER TABLE skin_submissions
    ADD COLUMN IF NOT EXISTS admin_proposed_price_gold_coins INTEGER;

ALTER TABLE skin_submissions
    ADD COLUMN IF NOT EXISTS admin_comment VARCHAR(2000);

ALTER TABLE skin_submissions
    ADD COLUMN IF NOT EXISTS creator_decision VARCHAR(20);

ALTER TABLE skin_submissions
    ADD COLUMN IF NOT EXISTS creator_comment VARCHAR(2000);

ALTER TABLE skin_submissions
    ADD COLUMN IF NOT EXISTS creator_responded_at TIMESTAMPTZ;

ALTER TABLE skin_submissions
    ADD COLUMN IF NOT EXISTS finalized_skin_id INTEGER REFERENCES skins(id);

CREATE INDEX IF NOT EXISTS idx_skin_submissions_workflow_state ON skin_submissions(workflow_state);
CREATE INDEX IF NOT EXISTS idx_skin_submissions_user_id ON skin_submissions(user_id);

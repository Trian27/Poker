ALTER TABLE email_verifications
ADD COLUMN IF NOT EXISTS purpose VARCHAR(50) NOT NULL DEFAULT 'registration';

ALTER TABLE email_verifications
ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE email_verifications
ADD COLUMN IF NOT EXISTS metadata JSONB;

CREATE INDEX IF NOT EXISTS idx_email_verifications_purpose ON email_verifications(purpose);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user_id ON email_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verifications_email_purpose_verified
    ON email_verifications(email, purpose, verified);

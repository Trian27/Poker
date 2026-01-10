-- Migration: Add join requests, inbox messages, and email verification
-- Description: Adds tables for community join requests, user inbox messages, and pending email verifications

-- ============================================================================
-- Join Requests Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS join_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    message VARCHAR(250),  -- Optional description from user (max 250 chars)
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, approved, denied
    custom_starting_balance NUMERIC(15, 2),  -- NULL means use community default
    reviewed_by_user_id INTEGER REFERENCES users(id),  -- Commissioner who reviewed
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- One pending request per user per community
    CONSTRAINT unique_pending_request UNIQUE (user_id, community_id, status)
);

CREATE INDEX IF NOT EXISTS idx_join_requests_user ON join_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_join_requests_community ON join_requests(community_id);
CREATE INDEX IF NOT EXISTS idx_join_requests_status ON join_requests(status);

-- ============================================================================
-- Inbox Messages Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS inbox_messages (
    id SERIAL PRIMARY KEY,
    recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- NULL for system messages
    message_type VARCHAR(50) NOT NULL,  -- join_request, join_approved, join_denied, system, etc.
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB,  -- Additional data for interactive messages (e.g., request_id, community_id)
    is_read BOOLEAN DEFAULT FALSE,
    is_actionable BOOLEAN DEFAULT FALSE,  -- Whether this message has actions (approve/deny buttons)
    action_taken VARCHAR(50),  -- What action was taken (if any)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    read_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_inbox_messages_recipient ON inbox_messages(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_inbox_messages_unread ON inbox_messages(recipient_user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_inbox_messages_actionable ON inbox_messages(recipient_user_id, is_actionable) WHERE is_actionable = TRUE;

-- ============================================================================
-- Email Verification Table (for production mode)
-- ============================================================================
CREATE TABLE IF NOT EXISTS email_verifications (
    id SERIAL PRIMARY KEY,
    email VARCHAR(100) NOT NULL,
    username VARCHAR(50) NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    verification_code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    verified BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_email_verifications_email ON email_verifications(email);
CREATE INDEX IF NOT EXISTS idx_email_verifications_code ON email_verifications(verification_code);

-- ============================================================================
-- Add commissioner_id to communities (league owner is default commissioner)
-- ============================================================================
ALTER TABLE communities 
ADD COLUMN IF NOT EXISTS commissioner_id INTEGER REFERENCES users(id);

-- Set commissioner to league owner for existing communities
UPDATE communities c
SET commissioner_id = (
    SELECT l.owner_id 
    FROM leagues l 
    WHERE l.id = c.league_id
)
WHERE commissioner_id IS NULL;

-- ============================================================================
-- Add email_verified flag to users
-- ============================================================================
ALTER TABLE users
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;

-- Mark existing users as verified (grandfathered in)
UPDATE users SET email_verified = TRUE WHERE email_verified IS NULL OR email_verified = FALSE;

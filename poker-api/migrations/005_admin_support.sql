-- Migration 005: Add admin support
-- Adds is_admin flag to users

-- Add is_admin column to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Add comment for documentation
COMMENT ON COLUMN users.is_admin IS 'Whether this user has admin privileges (can create leagues)';

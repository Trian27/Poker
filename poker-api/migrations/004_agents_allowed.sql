-- Migration 004: Add agents_allowed field to tables
-- This allows table creators to specify whether autonomous agents (bots) can join

-- Add agents_allowed column to tables
ALTER TABLE tables ADD COLUMN IF NOT EXISTS agents_allowed BOOLEAN NOT NULL DEFAULT TRUE;

-- Add comment for documentation
COMMENT ON COLUMN tables.agents_allowed IS 'Whether autonomous poker agents (bots) are allowed to join this table';

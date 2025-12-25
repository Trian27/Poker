-- Migration: Add table queue system and action timeouts
-- Description: Adds queue management and action timeout features to tables

-- Add queue and timeout columns to tables
ALTER TABLE tables 
ADD COLUMN IF NOT EXISTS max_queue_size INTEGER NOT NULL DEFAULT 10;

ALTER TABLE tables 
ADD COLUMN IF NOT EXISTS action_timeout_seconds INTEGER NOT NULL DEFAULT 30;

-- Create table_queue table
CREATE TABLE IF NOT EXISTS table_queue (
    id SERIAL PRIMARY KEY,
    table_id INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    position INTEGER NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(table_id, user_id)
);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_table_queue_table_id ON table_queue(table_id);
CREATE INDEX IF NOT EXISTS idx_table_queue_position ON table_queue(table_id, position);
CREATE INDEX IF NOT EXISTS idx_tables_queue_size ON tables(max_queue_size);

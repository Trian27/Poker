-- Migration: Add permanent tables support
-- Description: Adds is_permanent and created_by_user_id columns to tables table

-- Add is_permanent column (defaults to False for existing tables)
ALTER TABLE tables 
ADD COLUMN IF NOT EXISTS is_permanent BOOLEAN NOT NULL DEFAULT FALSE;

-- Add created_by_user_id column
ALTER TABLE tables 
ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER;

-- Add foreign key constraint for created_by_user_id
ALTER TABLE tables 
ADD CONSTRAINT fk_tables_created_by_user 
FOREIGN KEY (created_by_user_id) REFERENCES users(id);

-- Update existing tables to set created_by_user_id to the league owner
-- (This is a best-effort for existing data - assumes first league owner)
UPDATE tables t
SET created_by_user_id = (
    SELECT l.owner_id 
    FROM communities c
    JOIN leagues l ON c.league_id = l.id
    WHERE c.id = t.community_id
    LIMIT 1
)
WHERE created_by_user_id IS NULL;

-- Make created_by_user_id NOT NULL after setting default values
ALTER TABLE tables 
ALTER COLUMN created_by_user_id SET NOT NULL;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_tables_is_permanent ON tables(is_permanent);
CREATE INDEX IF NOT EXISTS idx_tables_created_by ON tables(created_by_user_id);

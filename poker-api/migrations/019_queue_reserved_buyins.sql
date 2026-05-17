ALTER TABLE table_queue
ADD COLUMN IF NOT EXISTS reserved_buy_in_amount INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'uq_table_queue_table_user'
    ) THEN
        ALTER TABLE table_queue
        ADD CONSTRAINT uq_table_queue_table_user UNIQUE (table_id, user_id);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'uq_table_queue_table_position'
    ) THEN
        ALTER TABLE table_queue
        ADD CONSTRAINT uq_table_queue_table_position
        UNIQUE (table_id, position)
        DEFERRABLE INITIALLY DEFERRED;
    END IF;
END
$$;

-- Migration 009: Cap table seats at 8

ALTER TABLE tables
    ALTER COLUMN max_seats SET DEFAULT 8;

UPDATE tables
SET max_seats = 8
WHERE max_seats > 8;

UPDATE tables
SET max_seats = 2
WHERE max_seats < 2;

DELETE FROM table_seats ts
USING tables t
WHERE ts.table_id = t.id
  AND ts.seat_number > t.max_seats;

ALTER TABLE tables
    DROP CONSTRAINT IF EXISTS chk_tables_max_seats_range;

ALTER TABLE tables
    ADD CONSTRAINT chk_tables_max_seats_range
    CHECK (max_seats BETWEEN 2 AND 8);

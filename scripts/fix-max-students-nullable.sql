-- Migration to make max_students column nullable
-- This removes the NOT NULL constraint so we can omit this field from inserts

ALTER TABLE classwaves.sessions.classroom_sessions 
ALTER COLUMN max_students DROP NOT NULL;

-- Verify the change
DESCRIBE classwaves.sessions.classroom_sessions;

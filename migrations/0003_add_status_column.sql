-- Add status column to track analysis progress
ALTER TABLE analyses ADD COLUMN status TEXT DEFAULT 'completed';

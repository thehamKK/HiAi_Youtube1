-- Add source column to analyses table
ALTER TABLE analyses ADD COLUMN source TEXT DEFAULT 'single';

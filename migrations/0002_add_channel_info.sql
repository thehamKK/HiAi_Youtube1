-- Add channel information to analyses table
ALTER TABLE analyses ADD COLUMN channel_id TEXT;
ALTER TABLE analyses ADD COLUMN channel_name TEXT;

CREATE INDEX IF NOT EXISTS idx_analyses_channel_id ON analyses(channel_id);

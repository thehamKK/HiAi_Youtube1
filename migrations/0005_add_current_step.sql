-- Add current_step column to batch_videos table
ALTER TABLE batch_videos ADD COLUMN current_step TEXT DEFAULT 'pending';

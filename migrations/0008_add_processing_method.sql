-- Add processing_method column to batch_jobs table
ALTER TABLE batch_jobs ADD COLUMN IF NOT EXISTS processing_method TEXT DEFAULT 'cloudflare';

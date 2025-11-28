-- Add video metadata columns
ALTER TABLE analyses ADD COLUMN title TEXT;
ALTER TABLE analyses ADD COLUMN upload_date TEXT;

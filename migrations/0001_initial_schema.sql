-- Initial schema for YouTube video analysis
CREATE TABLE IF NOT EXISTS analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT UNIQUE NOT NULL,
  url TEXT NOT NULL,
  transcript TEXT,
  summary TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analyses_video_id ON analyses(video_id);
CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses(created_at);

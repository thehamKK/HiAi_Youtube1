-- Create channels table
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT UNIQUE NOT NULL,
  channel_name TEXT NOT NULL,
  channel_url TEXT,
  video_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_channels_channel_id ON channels(channel_id);

-- Create batch_jobs table
CREATE TABLE IF NOT EXISTS batch_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  total_videos INTEGER DEFAULT 0,
  completed INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channel_id) REFERENCES channels(channel_id)
);

CREATE INDEX IF NOT EXISTS idx_batch_jobs_channel_id ON batch_jobs(channel_id);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_status ON batch_jobs(status);

-- Create batch_videos table with timestamps
CREATE TABLE IF NOT EXISTS batch_videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  video_id TEXT NOT NULL,
  video_title TEXT,
  video_url TEXT,
  analysis_id INTEGER,
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  upload_date TEXT,
  started_at DATETIME,
  finished_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES batch_jobs(id),
  FOREIGN KEY (analysis_id) REFERENCES analyses(id)
);

CREATE INDEX IF NOT EXISTS idx_batch_videos_batch_id ON batch_videos(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_videos_video_id ON batch_videos(video_id);
CREATE INDEX IF NOT EXISTS idx_batch_videos_status ON batch_videos(status);

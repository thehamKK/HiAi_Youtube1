-- 다운로드/내보내기 히스토리 테이블
CREATE TABLE IF NOT EXISTS export_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  export_type TEXT NOT NULL, -- 'all', 'batch', 'single'
  file_format TEXT NOT NULL, -- 'txt', 'zip', 'json'
  total_analyses INTEGER NOT NULL,
  file_size_bytes INTEGER,
  exported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_export_history_exported_at ON export_history(exported_at);
CREATE INDEX IF NOT EXISTS idx_export_history_export_type ON export_history(export_type);

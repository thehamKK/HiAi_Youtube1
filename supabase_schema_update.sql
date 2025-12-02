-- Supabase 스키마 업데이트
-- D1과의 호환성을 위해 추가 컬럼 생성

-- 1. analyses 테이블에 source 컬럼 추가 (single/batch 구분)
ALTER TABLE analyses 
ADD COLUMN IF NOT EXISTS source TEXT CHECK (source IN ('single', 'batch'));

-- 2. analyses 테이블에 upload_date 컬럼 추가
ALTER TABLE analyses 
ADD COLUMN IF NOT EXISTS upload_date TIMESTAMPTZ;

-- 3. batch_jobs 테이블 컬럼 수정 (processed_videos → completed_videos, failed_videos 추가)
ALTER TABLE batch_jobs 
ADD COLUMN IF NOT EXISTS completed_videos INTEGER DEFAULT 0;

ALTER TABLE batch_jobs 
ADD COLUMN IF NOT EXISTS failed_videos INTEGER DEFAULT 0;

ALTER TABLE batch_jobs 
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- 4. batch_videos 테이블에 추가 컬럼
ALTER TABLE batch_videos 
ADD COLUMN IF NOT EXISTS video_title TEXT;

ALTER TABLE batch_videos 
ADD COLUMN IF NOT EXISTS video_url TEXT;

ALTER TABLE batch_videos 
ADD COLUMN IF NOT EXISTS analysis_id INTEGER REFERENCES analyses(id);

ALTER TABLE batch_videos 
ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE batch_videos 
ADD COLUMN IF NOT EXISTS upload_date TIMESTAMPTZ;

ALTER TABLE batch_videos 
ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

ALTER TABLE batch_videos 
ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

ALTER TABLE batch_videos 
ADD COLUMN IF NOT EXISTS current_step TEXT DEFAULT 'pending';

-- 5. export_history 테이블 생성 (download_history와 다름)
CREATE TABLE IF NOT EXISTS export_history (
  id BIGSERIAL PRIMARY KEY,
  export_type TEXT NOT NULL,
  format TEXT NOT NULL,
  file_size INTEGER,
  analysis_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_analyses_source ON analyses(source);
CREATE INDEX IF NOT EXISTS idx_analyses_upload_date ON analyses(upload_date);
CREATE INDEX IF NOT EXISTS idx_batch_videos_video_id ON batch_videos(video_id);
CREATE INDEX IF NOT EXISTS idx_batch_videos_analysis_id ON batch_videos(analysis_id);

-- 7. processed_videos를 계산하는 함수 (기존 컬럼이 있다면 제거)
-- processed_videos = completed_videos + failed_videos 관계 유지

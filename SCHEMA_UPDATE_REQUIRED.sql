-- 🔧 Supabase 스키마 업데이트 (필수)
-- 실행 방법: https://app.supabase.com/project/hvmdwkugpvqigpfdfrvz/sql/new
-- 아래 SQL을 복사해서 SQL Editor에 붙여넣고 실행하세요

-- 1. analyses 테이블에 source 컬럼 추가 ⭐ 중요
ALTER TABLE analyses 
ADD COLUMN IF NOT EXISTS source TEXT CHECK (source IN ('single', 'batch'));

-- 2. analyses 테이블에 channel_name 추가
ALTER TABLE analyses 
ADD COLUMN IF NOT EXISTS channel_name TEXT;

-- 3. batch_jobs 테이블 컬럼 추가
ALTER TABLE batch_jobs 
ADD COLUMN IF NOT EXISTS completed_videos INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS failed_videos INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- 4. batch_videos 테이블에 추가 컬럼
ALTER TABLE batch_videos 
ADD COLUMN IF NOT EXISTS video_title TEXT,
ADD COLUMN IF NOT EXISTS video_url TEXT,
ADD COLUMN IF NOT EXISTS analysis_id BIGINT REFERENCES analyses(id),
ADD COLUMN IF NOT EXISTS error_message TEXT,
ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

-- 5. 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_analyses_source ON analyses(source);
CREATE INDEX IF NOT EXISTS idx_batch_videos_video_id ON batch_videos(video_id);
CREATE INDEX IF NOT EXISTS idx_batch_videos_analysis_id ON batch_videos(analysis_id);

-- ✅ 완료! 이제 API 변환을 진행할 수 있습니다.

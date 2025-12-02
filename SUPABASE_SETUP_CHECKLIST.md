# ✅ Supabase 설정 체크리스트

## 📊 현재 상태

### ✅ 완료된 항목
- [x] Supabase 프로젝트 생성 완료
- [x] Project URL 확인: `https://hvmdwkugpvqigpfdfrvz.supabase.co`
- [x] Anon Key 확인 완료

### ⏳ 진행 중
- [ ] **Service Role Key 필요!** (백엔드용 키)
- [ ] 데이터베이스 스키마 생성
- [ ] 로컬 환경 변수 설정
- [ ] Supabase 클라이언트 패키지 설치

---

## 🔑 Step 1: Service Role Key 가져오기 (필수!)

### 왜 필요한가요?
- **Anon Key**: 프론트엔드용 (제한된 권한)
- **Service Role Key**: 백엔드용 (모든 권한)

현재 받은 키는 `anon` 키입니다. 백엔드에서는 `service_role` 키가 필요합니다!

### 어떻게 찾나요?

1. **https://app.supabase.com/project/hvmdwkugpvqigpfdfrvz** 접속
2. 왼쪽 메뉴 **Settings → API** 클릭
3. 아래로 스크롤하여 **"service_role"** 섹션 찾기
4. 🔓 아이콘 클릭하여 키 표시
5. 전체 키 복사

**Service Role Key 형식:**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2bWR3a3VncHZxaWdwZmRmcnZ6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDY1MTk3MiwiZXhwIjoyMDgwMjI3OTcyfQ.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 🗄️ Step 2: 데이터베이스 스키마 생성 (3분)

### 실행 방법

1. **https://app.supabase.com/project/hvmdwkugpvqigpfdfrvz/sql/new** 접속
2. 아래 SQL 전체 복사
3. SQL Editor에 붙여넣기
4. **RUN** 버튼 클릭

### SQL 스크립트

```sql
-- 1. analyses 테이블 (YouTube 비디오 분석 결과)
CREATE TABLE IF NOT EXISTS analyses (
  id BIGSERIAL PRIMARY KEY,
  video_id TEXT NOT NULL,
  channel_id TEXT,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  
  -- 분석 결과
  summary TEXT,
  transcript TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'transcript_only')),
  
  -- 메타데이터
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- 유니크 제약
  UNIQUE(video_id)
);

-- 2. batch_jobs 테이블 (채널 배치 작업)
CREATE TABLE IF NOT EXISTS batch_jobs (
  id BIGSERIAL PRIMARY KEY,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  total_videos INTEGER DEFAULT 0,
  processed_videos INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. batch_videos 테이블 (배치 작업의 비디오 목록)
CREATE TABLE IF NOT EXISTS batch_videos (
  id BIGSERIAL PRIMARY KEY,
  batch_id BIGINT NOT NULL REFERENCES batch_jobs(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'transcript_only')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- 복합 유니크
  UNIQUE(batch_id, video_id)
);

-- 4. download_history 테이블 (다운로드 기록)
CREATE TABLE IF NOT EXISTS download_history (
  id BIGSERIAL PRIMARY KEY,
  download_type TEXT NOT NULL CHECK (download_type IN ('full', 'selected')),
  video_ids TEXT[] NOT NULL,
  downloaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스 생성 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_analyses_channel_id ON analyses(channel_id);
CREATE INDEX IF NOT EXISTS idx_analyses_status ON analyses(status);
CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batch_videos_batch_id ON batch_videos(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_videos_status ON batch_videos(status);

-- updated_at 자동 업데이트 함수
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger 설정
CREATE TRIGGER update_analyses_updated_at BEFORE UPDATE ON analyses
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_batch_jobs_updated_at BEFORE UPDATE ON batch_jobs
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_batch_videos_updated_at BEFORE UPDATE ON batch_videos
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### 예상 결과
✅ "Success. No rows returned" 메시지

---

## 📦 Step 3: Supabase 클라이언트 설치 (즉시 실행 가능!)

```bash
cd /home/user/webapp
npm install @supabase/supabase-js
```

---

## 🔧 Step 4: 환경 변수 설정 (Service Role Key 받은 후)

### .dev.vars 파일에 추가

```bash
cd /home/user/webapp
cat >> .dev.vars << 'EOF'

# Supabase Configuration
SUPABASE_URL=https://hvmdwkugpvqigpfdfrvz.supabase.co
SUPABASE_SERVICE_KEY=YOUR_SERVICE_ROLE_KEY_HERE
EOF
```

⚠️ `YOUR_SERVICE_ROLE_KEY_HERE`를 실제 Service Role Key로 교체!

---

## 📊 진행 상황 요약

### ✅ 확인된 정보
```
Project URL: https://hvmdwkugpvqigpfdfrvz.supabase.co
Anon Key: eyJhbGc...RDBе (받음)
Region: 미확인 (Seoul 추천)
```

### ⏳ 대기 중
```
Service Role Key: 필요! (백엔드용)
```

### 📋 다음 단계
1. **Service Role Key 가져오기** (Settings → API)
2. **SQL 스크립트 실행** (4개 테이블 생성)
3. **npm install @supabase/supabase-js** (즉시 가능!)
4. **.dev.vars 업데이트** (Service Role Key 추가)
5. **API 코드 마이그레이션** (2-3시간)

---

## 🚀 빠른 시작 명령어

```bash
# 1. Supabase 클라이언트 설치 (지금 바로!)
cd /home/user/webapp && npm install @supabase/supabase-js

# 2. Service Role Key 받은 후 환경 변수 업데이트
# (수동으로 .dev.vars 파일 편집)

# 3. 연결 테스트
curl -X GET \
  'https://hvmdwkugpvqigpfdfrvz.supabase.co/rest/v1/analyses?select=*&limit=1' \
  -H "apikey: YOUR_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY"
```

---

## 💡 자주 묻는 질문

### Q: Anon Key와 Service Role Key의 차이점은?

**A: 권한 수준이 다릅니다!**

| 항목 | Anon Key | Service Role Key |
|------|----------|------------------|
| **용도** | 프론트엔드 | 백엔드 |
| **권한** | 제한됨 (RLS 적용) | 전체 권한 |
| **노출** | ✅ 공개 가능 | ❌ 절대 노출 금지! |
| **사용처** | 브라우저 JS | 서버 (Cloudflare Workers) |

### Q: Service Role Key를 어디서 찾나요?

**A: Supabase Dashboard → Settings → API**

1. https://app.supabase.com/project/hvmdwkugpvqigpfdfrvz
2. Settings → API
3. "service_role" 섹션
4. 🔓 클릭하여 키 표시

### Q: SQL 스크립트는 어디서 실행하나요?

**A: Supabase SQL Editor**

1. https://app.supabase.com/project/hvmdwkugpvqigpfdfrvz/sql/new
2. SQL 복사 & 붙여넣기
3. RUN 버튼 클릭

---

## ✅ 체크리스트

- [ ] Service Role Key 가져오기
- [ ] SQL 스크립트 실행 (4개 테이블)
- [ ] npm install @supabase/supabase-js
- [ ] .dev.vars 업데이트
- [ ] 연결 테스트 (curl)
- [ ] API 코드 마이그레이션 시작

---

## 📞 다음 단계

**Service Role Key를 받으시면 즉시 알려주세요!**
그러면 바로 다음 단계를 진행하겠습니다:
1. 환경 변수 자동 설정
2. Supabase 연결 테스트
3. API 코드 마이그레이션 시작

**준비되셨나요?** 🚀

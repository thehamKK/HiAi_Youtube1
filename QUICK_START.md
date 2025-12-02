# 🚀 Supabase 계정 있는 분을 위한 빠른 시작 가이드

## ✅ 전제 조건
- Supabase 계정 보유 확인 ✅
- 현재 백엔드 동작 중 (PM2 + D1) ✅

---

## 🎯 15분 마이그레이션 로드맵

### Phase 1-1: Supabase 프로젝트 생성 (5분)

1. **https://app.supabase.com** 로그인
2. **"New Project"** 클릭
   ```
   Name: hidb-production
   Database Password: [강력한 비밀번호 생성 - 저장해두세요!]
   Region: Northeast Asia (Seoul) - 한국 서버 선택
   Plan: Free ($0) - 무료로 시작
   ```
3. 프로젝트 생성 완료까지 **1-2분 대기**

### Phase 1-2: API 키 복사 (2분)

1. 생성된 프로젝트 클릭
2. 왼쪽 메뉴 **Settings → API** 클릭
3. 아래 정보 복사:

```plaintext
✅ Project URL (Supabase URL)
예시: https://abcdefghijklmnop.supabase.co

✅ Service Role Key (Supabase Service Key)
예시: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNzM1NzE1MDAwLCJleHAiOjIwNTEyOTEwMDB9.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

⚠️ **중요**: `Service Role Key`는 절대 노출하지 마세요! (GitHub, 프론트엔드 코드 등)

### Phase 1-3: 데이터베이스 스키마 생성 (3분)

1. 왼쪽 메뉴 **SQL Editor** 클릭
2. 아래 SQL 전체 복사하여 붙여넣기
3. **RUN** 버튼 클릭

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
  
  -- 인덱스를 위한 제약조건
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
  
  -- 복합 인덱스
  UNIQUE(batch_id, video_id)
);

-- 4. download_history 테이블 (다운로드 기록)
CREATE TABLE IF NOT EXISTS download_history (
  id BIGSERIAL PRIMARY KEY,
  download_type TEXT NOT NULL CHECK (download_type IN ('full', 'selected')),
  video_ids TEXT[] NOT NULL,
  downloaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스 생성 (쿼리 성능 최적화)
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

-- Trigger 설정 (updated_at 자동 갱신)
CREATE TRIGGER update_analyses_updated_at BEFORE UPDATE ON analyses
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_batch_jobs_updated_at BEFORE UPDATE ON batch_jobs
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_batch_videos_updated_at BEFORE UPDATE ON batch_videos
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

✅ 성공 메시지 확인: "Success. No rows returned"

### Phase 1-4: 로컬 환경 변수 설정 (2분)

```bash
# .dev.vars 파일에 추가 (기존 내용 유지하고 아래만 추가)
cd /home/user/webapp
cat >> .dev.vars << 'EOF'

# Supabase Configuration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
EOF
```

⚠️ **위의 URL과 KEY를 실제 값으로 교체하세요!**

### Phase 1-5: Supabase 클라이언트 패키지 설치 (3분)

```bash
cd /home/user/webapp
npm install @supabase/supabase-js
```

---

## 🎯 다음 단계 (Phase 2)

✅ **Phase 1 완료!** 이제 백엔드 코드 수정이 필요합니다.

### Phase 2: API 코드 마이그레이션 (2-3시간 예상)

1. **`API_MIGRATION_EXAMPLES.md`** 읽기 (5분)
   - D1 → Supabase 변환 패턴 이해
   
2. **src/index.tsx** 수정 (2-3시간)
   - 모든 `c.env.DB` → Supabase 쿼리로 변환
   - 약 15-20개 API 엔드포인트 수정 필요

3. **로컬 테스트** (30분)
   ```bash
   npm run build
   pm2 restart hidb
   curl http://localhost:3000/api/history
   ```

4. **Cloudflare Pages 배포** (15분)
   ```bash
   # Cloudflare Secrets 설정
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_SERVICE_KEY
   npx wrangler secret put YOUTUBE_API_KEY
   npx wrangler secret put GEMINI_API_KEY
   
   # 배포
   npm run build
   npx wrangler pages deploy dist --project-name hidb
   ```

---

## 📊 마이그레이션 전후 비교

### Before (현재 상태)
```
백엔드: PM2 + Hono (Node.js) on Sandbox
DB: D1 (SQLite, 로컬 파일)
처리 시간: 5-6일
병렬 처리: 1개 워커 (메모리 987MB 제한)
비용: $0 (샌드박스)
```

### After (마이그레이션 후)
```
백엔드: Cloudflare Workers + Hono (Edge Runtime)
DB: Supabase (PostgreSQL, 클라우드)
처리 시간: 2-3시간 (50배 빠름!)
병렬 처리: 무제한 워커 (128MB × N)
비용: $0-6/월 (무료로 시작 가능)
```

---

## 🤔 자주 묻는 질문 (FAQ)

### Q1: 백엔드가 Supabase인가요? Cloudflare인가요?

**A: 백엔드는 Cloudflare Workers입니다!**

```plaintext
✅ Cloudflare Workers = 백엔드 (API 처리, 비즈니스 로직)
✅ Supabase = 데이터베이스 (데이터 저장만)
✅ Cloudflare Pages = 프론트엔드 (HTML/JS 호스팅)
```

**구조:**
```
[ 프론트엔드: Cloudflare Pages ]
          ↓
[ 백엔드: Cloudflare Workers + Hono ]  ← 여기가 백엔드!
          ↓
[ DB: Supabase PostgreSQL ]            ← DB만!
```

### Q2: 기존 D1 데이터를 옮겨야 하나요?

**A: 선택사항입니다!**

- **새로 시작**: 데이터 이전 없이 Supabase에서 새로 시작 (추천)
- **데이터 보존**: `convert_to_postgres.sh` 스크립트로 D1 → Supabase 마이그레이션

### Q3: 비용이 발생하나요?

**A: 무료로 시작할 수 있습니다!**

```
무료 Tier:
- Supabase Free: 500MB DB, 월 5만 Row 읽기
- Cloudflare Workers: 10만 요청/일 무료
- Cloudflare Pages: 무제한 호스팅

→ 총 비용: $0/월 (테스트/소규모)

유료 Tier (대규모 서비스):
- Supabase Pro: $25/월
- Cloudflare Workers Standard: $5/월
→ 총 비용: $30/월
```

### Q4: 얼마나 빨라지나요?

**A: 50배 빠릅니다!**

```
현재 (샌드박스):
- 2,376개 영상 처리 시간: 5-6일
- 워커: 1개 (메모리 987MB 제한)
- 처리량: 10-20개/시간

마이그레이션 후:
- 2,376개 영상 처리 시간: 2-3시간
- 워커: 무제한 (자동 스케일링)
- 처리량: 800-1,200개/시간
```

---

## 🚨 주의사항

### 1. Service Role Key 보안
- ✅ `.dev.vars` 파일에 저장 (로컬 개발)
- ✅ `wrangler secret` 명령어로 Cloudflare에 저장 (프로덕션)
- ❌ GitHub에 절대 커밋하지 말 것!
- ❌ 프론트엔드 코드에 노출 금지!

### 2. API 코드 수정 필수
- D1 SQL 쿼리 → Supabase Query Builder로 변환 필요
- 약 15-20개 엔드포인트 수정 예상
- `API_MIGRATION_EXAMPLES.md` 참고 필수!

### 3. 로컬 테스트 후 배포
- 반드시 로컬에서 먼저 테스트
- Supabase 연결 확인
- API 응답 검증 후 Cloudflare Pages 배포

---

## 📞 도움이 필요하신가요?

### 제공된 문서 읽기
1. **MIGRATION_GUIDE.md** - 상세 단계별 가이드
2. **API_MIGRATION_EXAMPLES.md** - 실전 API 변환 예시 (필독!)
3. **PRODUCTION_ARCHITECTURE.md** - 전체 시스템 아키텍처

### 명령어 치트시트
```bash
# Supabase 연결 테스트
curl -X GET \
  'https://your-project.supabase.co/rest/v1/analyses?select=*&limit=10' \
  -H "apikey: YOUR_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY"

# 로컬 개발 서버 시작
npm run build
pm2 restart hidb

# Cloudflare 배포
wrangler pages deploy dist --project-name hidb

# PM2 로그 확인
pm2 logs hidb --nostream
```

---

## ✅ 체크리스트

- [ ] Supabase 프로젝트 생성 완료
- [ ] API URL/KEY 복사 완료
- [ ] SQL 스키마 실행 완료 (4개 테이블)
- [ ] .dev.vars 파일에 환경 변수 추가 완료
- [ ] `npm install @supabase/supabase-js` 실행 완료
- [ ] `API_MIGRATION_EXAMPLES.md` 읽음
- [ ] API 코드 수정 시작 (Phase 2)

---

## 🎉 준비 완료!

**Supabase 계정이 있으니 15분이면 Phase 1 완료 가능합니다!**

지금 바로 https://app.supabase.com 에서 프로젝트를 만들어보세요!

**Phase 1 완료 후 알려주시면, Phase 2 (API 코드 마이그레이션)을 함께 진행하겠습니다!** 🚀

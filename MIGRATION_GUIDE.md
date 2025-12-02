# 🚀 Cloudflare + Supabase 마이그레이션 가이드

## Phase 1: 기본 구조 (1주)

---

## ✅ Step 1: Supabase 계정 생성 및 프로젝트 설정

### 1.1 Supabase 계정 생성

1. **https://supabase.com** 접속
2. **"Start your project"** 클릭
3. **GitHub 계정으로 로그인** (추천) 또는 이메일 가입
4. 무료 플랜 선택 (Free Plan)
   - 500MB 데이터베이스
   - 1GB 파일 저장소
   - 50,000 Monthly Active Users
   - **비용: $0**

### 1.2 새 프로젝트 생성

1. Dashboard에서 **"New Project"** 클릭
2. 프로젝트 정보 입력:
   ```
   Organization: [본인 조직 선택]
   Name: hidb-production
   Database Password: [강력한 비밀번호 생성] ⚠️ 반드시 저장!
   Region: Northeast Asia (Seoul) - 한국에 가장 가까운 리전
   Pricing Plan: Free
   ```
3. **"Create new project"** 클릭
4. 프로젝트 생성 완료 대기 (약 2분)

### 1.3 API 정보 확인

프로젝트 생성 완료 후:

1. 좌측 메뉴에서 **"Settings"** → **"API"** 클릭
2. 다음 정보 복사 및 저장:

```bash
# Project URL
SUPABASE_URL="https://xxxxxxxxxxxxx.supabase.co"

# Project API keys
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." # public key
SUPABASE_SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." # secret key (서버용)
```

⚠️ **주의**: `SUPABASE_SERVICE_KEY`는 절대 프론트엔드에 노출하면 안 됩니다!

---

## ✅ Step 2: 데이터베이스 스키마 생성

### 2.1 Supabase SQL Editor 접속

1. 좌측 메뉴에서 **"SQL Editor"** 클릭
2. **"New query"** 클릭

### 2.2 테이블 생성 SQL 실행

아래 SQL을 복사하여 실행:

```sql
-- 1. analyses 테이블
CREATE TABLE analyses (
  id BIGSERIAL PRIMARY KEY,
  video_id TEXT UNIQUE NOT NULL,
  url TEXT NOT NULL,
  transcript TEXT,
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  channel_id TEXT,
  channel_name TEXT,
  title TEXT,
  upload_date TEXT,
  status TEXT DEFAULT 'completed',
  source TEXT DEFAULT 'single'
);

-- 2. batch_jobs 테이블
CREATE TABLE batch_jobs (
  id BIGSERIAL PRIMARY KEY,
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  total_videos INTEGER DEFAULT 0,
  completed_videos INTEGER DEFAULT 0,
  failed_videos INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- 3. batch_videos 테이블
CREATE TABLE batch_videos (
  id BIGSERIAL PRIMARY KEY,
  batch_id BIGINT NOT NULL REFERENCES batch_jobs(id),
  video_id TEXT NOT NULL,
  video_title TEXT,
  video_url TEXT,
  analysis_id BIGINT REFERENCES analyses(id),
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  upload_date TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  current_step TEXT DEFAULT 'pending'
);

-- 4. export_history 테이블
CREATE TABLE export_history (
  id BIGSERIAL PRIMARY KEY,
  export_type TEXT NOT NULL,
  format TEXT NOT NULL,
  file_size BIGINT,
  analysis_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스 생성 (성능 최적화)
CREATE INDEX idx_analyses_video_id ON analyses(video_id);
CREATE INDEX idx_analyses_status ON analyses(status);
CREATE INDEX idx_analyses_created_at ON analyses(created_at);
CREATE INDEX idx_batch_videos_batch_id ON batch_videos(batch_id);
CREATE INDEX idx_batch_videos_status ON batch_videos(status);
CREATE INDEX idx_batch_videos_video_id ON batch_videos(video_id);
CREATE INDEX idx_batch_jobs_status ON batch_jobs(status);

-- Row Level Security (RLS) 비활성화 (서버에서만 접근)
ALTER TABLE analyses DISABLE ROW LEVEL SECURITY;
ALTER TABLE batch_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE batch_videos DISABLE ROW LEVEL SECURITY;
ALTER TABLE export_history DISABLE ROW LEVEL SECURITY;
```

### 2.3 실행 확인

1. **"Run"** 버튼 클릭 (또는 `Ctrl+Enter`)
2. 성공 메시지 확인: "Success. No rows returned"
3. 좌측 메뉴 **"Table Editor"**에서 테이블 생성 확인

---

## ✅ Step 3: 기존 D1 데이터 마이그레이션

### 3.1 D1 데이터 Export

```bash
# 샌드박스 환경에서 실행
cd /home/user/webapp

# 데이터 export
npx wrangler d1 export hidb-production --local --output=backup.sql
```

### 3.2 PostgreSQL 형식으로 변환

D1 (SQLite) → Supabase (PostgreSQL) 변환이 필요합니다.

아래 스크립트를 `convert_to_postgres.sh`로 저장:

```bash
#!/bin/bash
# D1 SQLite → PostgreSQL 변환 스크립트

INPUT_FILE="backup.sql"
OUTPUT_FILE="backup_postgres.sql"

echo "🔄 D1 (SQLite) → PostgreSQL 변환 중..."

# SQLite 문법을 PostgreSQL로 변환
cat "$INPUT_FILE" | \
  # AUTOINCREMENT → SERIAL
  sed 's/INTEGER PRIMARY KEY AUTOINCREMENT/BIGSERIAL PRIMARY KEY/g' | \
  # DATETIME → TIMESTAMPTZ
  sed 's/DATETIME DEFAULT CURRENT_TIMESTAMP/TIMESTAMPTZ DEFAULT NOW()/g' | \
  # DATETIME → TIMESTAMPTZ (컬럼 정의)
  sed 's/DATETIME/TIMESTAMPTZ/g' | \
  # SQLite의 '' → NULL
  sed "s/''/NULL/g" > "$OUTPUT_FILE"

echo "✅ 변환 완료: $OUTPUT_FILE"
echo ""
echo "📋 다음 단계:"
echo "1. Supabase SQL Editor에서 $OUTPUT_FILE 내용 복사"
echo "2. 'Run' 버튼 클릭하여 실행"
```

### 3.3 Supabase에 Import

```bash
# 변환 스크립트 실행
chmod +x convert_to_postgres.sh
./convert_to_postgres.sh

# backup_postgres.sql 파일 내용을 Supabase SQL Editor에 복사하여 실행
cat backup_postgres.sql
```

⚠️ **주의**: 파일이 크면 나눠서 실행하세요 (Supabase SQL Editor 제한)

---

## ✅ Step 4: 환경 변수 설정

### 4.1 로컬 개발 환경 (.dev.vars)

`/home/user/webapp/.dev.vars` 파일 수정:

```bash
# 기존 변수
YOUTUBE_API_KEY=your_youtube_api_key
GEMINI_API_KEY=your_gemini_api_key

# 새로 추가
SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 4.2 Cloudflare Secrets (프로덕션)

```bash
# Wrangler로 Secrets 설정
wrangler secret put SUPABASE_URL
# 입력: https://xxxxxxxxxxxxx.supabase.co

wrangler secret put SUPABASE_SERVICE_KEY
# 입력: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

wrangler secret put YOUTUBE_API_KEY
# 입력: your_youtube_api_key

wrangler secret put GEMINI_API_KEY
# 입력: your_gemini_api_key
```

---

## ✅ Step 5: Supabase 클라이언트 설정

### 5.1 패키지 설치

```bash
cd /home/user/webapp
npm install @supabase/supabase-js
```

### 5.2 Supabase 클라이언트 유틸리티 생성

`src/lib/supabase.ts` 파일 생성:

```typescript
import { createClient } from '@supabase/supabase-js';

export type Database = {
  public: {
    Tables: {
      analyses: {
        Row: {
          id: number;
          video_id: string;
          url: string;
          transcript: string | null;
          summary: string | null;
          created_at: string;
          channel_id: string | null;
          channel_name: string | null;
          title: string | null;
          upload_date: string | null;
          status: string;
          source: string;
        };
        Insert: Omit<Database['public']['Tables']['analyses']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['analyses']['Insert']>;
      };
      batch_jobs: {
        Row: {
          id: number;
          channel_id: string;
          channel_name: string | null;
          total_videos: number;
          completed_videos: number;
          failed_videos: number;
          status: string;
          created_at: string;
          completed_at: string | null;
        };
        Insert: Omit<Database['public']['Tables']['batch_jobs']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['batch_jobs']['Insert']>;
      };
      batch_videos: {
        Row: {
          id: number;
          batch_id: number;
          video_id: string;
          video_title: string | null;
          video_url: string | null;
          analysis_id: number | null;
          status: string;
          error_message: string | null;
          upload_date: string | null;
          started_at: string | null;
          finished_at: string | null;
          created_at: string;
          current_step: string;
        };
        Insert: Omit<Database['public']['Tables']['batch_videos']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['batch_videos']['Insert']>;
      };
    };
  };
};

export function createSupabaseClient(supabaseUrl: string, supabaseKey: string) {
  return createClient<Database>(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
```

---

## ✅ Step 6: API 코드 수정 (예시)

### 기존 코드 (D1)
```typescript
// src/index.tsx
app.get('/api/history', async (c) => {
  const { DB } = c.env;
  
  const result = await DB.prepare(`
    SELECT * FROM analyses ORDER BY created_at DESC LIMIT 200
  `).all();
  
  return c.json({ analyses: result.results });
});
```

### 수정 코드 (Supabase)
```typescript
// src/index.tsx
import { createSupabaseClient } from './lib/supabase';

app.get('/api/history', async (c) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = c.env;
  const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  
  const { data, error } = await supabase
    .from('analyses')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  
  if (error) {
    return c.json({ error: error.message }, 500);
  }
  
  return c.json({ analyses: data });
});
```

---

## 📋 Phase 1 체크리스트

- [ ] ✅ Supabase 계정 생성 및 프로젝트 생성
- [ ] ✅ API URL 및 Keys 저장
- [ ] ✅ 데이터베이스 스키마 생성 (SQL 실행)
- [ ] ✅ D1 데이터 Export 및 변환
- [ ] ✅ Supabase에 데이터 Import
- [ ] ✅ 환경 변수 설정 (.dev.vars + Cloudflare Secrets)
- [ ] ✅ @supabase/supabase-js 패키지 설치
- [ ] ✅ Supabase 클라이언트 유틸리티 생성
- [ ] ✅ API 엔드포인트를 Supabase 연결로 수정
- [ ] ✅ 로컬 테스트 (`npm run dev`)
- [ ] ✅ Cloudflare Pages에 배포

---

## 🚀 다음 단계

Phase 1 완료 후:
- **Phase 2**: Cloudflare Queues 설정 (작업 큐)
- **Phase 3**: Worker Pool 병렬 처리
- **Phase 4**: 최적화 및 모니터링

---

## 💡 도움말

### Supabase 관련 링크
- Dashboard: https://app.supabase.com
- 문서: https://supabase.com/docs
- JavaScript 클라이언트: https://supabase.com/docs/reference/javascript

### 문제 해결
- **연결 실패**: SUPABASE_URL과 SUPABASE_SERVICE_KEY 확인
- **권한 에러**: RLS 비활성화 확인 (Step 2.2)
- **데이터 타입 에러**: PostgreSQL 형식 변환 확인 (Step 3.2)

---

**Phase 1을 시작할 준비가 되셨나요?** 🚀

위 가이드대로 Supabase 계정을 생성하고, 준비가 되면 알려주세요!
그럼 다음 단계인 **API 코드 수정**을 함께 진행하겠습니다.

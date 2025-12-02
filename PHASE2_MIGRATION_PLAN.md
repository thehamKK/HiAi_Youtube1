# 📋 Phase 2: API 코드 마이그레이션 계획

## 🎯 목표
- D1 (SQLite) → Supabase (PostgreSQL) 전환
- 31개 DB 쿼리 변환
- 17개 API 엔드포인트 수정

---

## 📊 마이그레이션 전략

### 옵션 A: 단계적 마이그레이션 (추천) ⭐
**장점:** 안전, 테스트 가능, 롤백 쉬움  
**예상 시간:** 2-3시간

1. ✅ Supabase 유틸리티 생성 완료
2. 🔄 주요 API 5개 우선 변환
3. 🧪 로컬 테스트
4. 🔄 나머지 API 변환
5. 🧪 전체 테스트
6. 🚀 배포

### 옵션 B: 전체 자동 변환 (위험)
**장점:** 빠름 (30분)  
**단점:** 오류 가능성 높음, 디버깅 어려움

---

## 🎯 우선 순위 API (5개)

### 1. GET /api/history (최우선)
**현재 상태:** D1 SQL 쿼리 3개  
**변환 난이도:** ⭐⭐⭐ (중)  
**사용 빈도:** 매우 높음

**변환 작업:**
```typescript
// Before (D1)
const statsResult = await env.DB.prepare(`
  SELECT COUNT(*) as total FROM analyses
`).first()

// After (Supabase)
const supabase = createSupabaseClient(env)
const { count, error } = await supabase
  .from('analyses')
  .select('*', { count: 'exact', head: true })
```

---

### 2. POST /api/analyze/transcript
**현재 상태:** D1 INSERT 쿼리  
**변환 난이도:** ⭐⭐ (쉬움)  
**사용 빈도:** 높음

**변환 작업:**
```typescript
// Before (D1)
await env.DB.prepare(`
  INSERT INTO analyses (video_id, title, url, transcript, status)
  VALUES (?, ?, ?, ?, ?)
`).bind(videoId, title, url, transcript, 'transcript_only').run()

// After (Supabase)
const { data, error } = await supabase
  .from('analyses')
  .insert({
    video_id: videoId,
    title,
    url,
    transcript,
    status: 'transcript_only'
  })
```

---

### 3. POST /api/analyze/report
**현재 상태:** D1 UPDATE 쿼리  
**변환 난이도:** ⭐⭐ (쉬움)  
**사용 빈도:** 높음

---

### 4. POST /api/channel/analyze
**현재 상태:** D1 INSERT + 트랜잭션  
**변환 난이도:** ⭐⭐⭐⭐ (어려움)  
**사용 빈도:** 중간

---

### 5. GET /api/analysis/:id
**현재 상태:** D1 SELECT  
**변환 난이도:** ⭐ (매우 쉬움)  
**사용 빈도:** 중간

---

## 🔧 변환 패턴

### Pattern 1: SELECT (조회)
```typescript
// D1
const result = await env.DB.prepare(
  'SELECT * FROM analyses WHERE id = ?'
).bind(id).first()

// Supabase
const { data, error } = await supabase
  .from('analyses')
  .select('*')
  .eq('id', id)
  .single()
```

### Pattern 2: INSERT (생성)
```typescript
// D1
await env.DB.prepare(
  'INSERT INTO analyses (video_id, title) VALUES (?, ?)'
).bind(videoId, title).run()

// Supabase
const { data, error } = await supabase
  .from('analyses')
  .insert({ video_id: videoId, title })
```

### Pattern 3: UPDATE (수정)
```typescript
// D1
await env.DB.prepare(
  'UPDATE analyses SET status = ? WHERE id = ?'
).bind('completed', id).run()

// Supabase
const { data, error } = await supabase
  .from('analyses')
  .update({ status: 'completed' })
  .eq('id', id)
```

### Pattern 4: COUNT (집계)
```typescript
// D1
const result = await env.DB.prepare(
  'SELECT COUNT(*) as count FROM analyses'
).first()

// Supabase
const { count, error } = await supabase
  .from('analyses')
  .select('*', { count: 'exact', head: true })
```

### Pattern 5: JOIN (조인)
```typescript
// D1
const result = await env.DB.prepare(`
  SELECT a.*, b.batch_id
  FROM analyses a
  LEFT JOIN batch_videos b ON a.video_id = b.video_id
`).all()

// Supabase
const { data, error } = await supabase
  .from('analyses')
  .select(`
    *,
    batch_videos (batch_id)
  `)
```

---

## 📝 실전 가이드

### Step 1: index.tsx 수정 시작

1. **Import 추가** (파일 상단)
```typescript
import { createSupabaseClient, type Bindings } from './lib/supabase'
```

2. **Bindings 타입 변경**
```typescript
// Before
type Bindings = {
  DB: D1Database
  YOUTUBE_API_KEY: string
  GEMINI_API_KEY: string
}

// After - lib/supabase.ts의 Bindings 사용
// (기존 타입 정의 삭제하고 import된 타입 사용)
```

3. **API 엔드포인트 내부 변환**
```typescript
app.get('/api/history', async (c) => {
  const { env } = c
  
  // Supabase 클라이언트 생성
  const supabase = createSupabaseClient(env)
  
  // D1 쿼리 → Supabase 쿼리로 변환
  // ...
})
```

---

## ✅ 변환 체크리스트

### 파일 수정
- [ ] `src/index.tsx` - Import 추가
- [ ] `src/index.tsx` - Bindings 타입 변경
- [ ] `src/index.tsx` - API 1: GET /api/history
- [ ] `src/index.tsx` - API 2: POST /api/analyze/transcript
- [ ] `src/index.tsx` - API 3: POST /api/analyze/report
- [ ] `src/index.tsx` - API 4: GET /api/analysis/:id
- [ ] `src/index.tsx` - API 5: POST /api/channel/analyze
- [ ] `src/index.tsx` - 나머지 12개 API

### 테스트
- [ ] 로컬 빌드 성공 (`npm run build`)
- [ ] 로컬 서버 시작 (`pm2 restart hidb`)
- [ ] API 1 테스트 (`curl http://localhost:3000/api/history`)
- [ ] API 2-5 테스트
- [ ] 전체 API 테스트

### 배포
- [ ] Cloudflare Secrets 설정
- [ ] Cloudflare Pages 배포
- [ ] 프로덕션 테스트

---

## 🚀 시작하기

### 방법 1: 자동 변환 스크립트 사용 (빠르지만 위험)
```bash
# 백업 자동 생성됨
chmod +x migrate_to_supabase.sh
./migrate_to_supabase.sh
```

### 방법 2: 수동 변환 (안전) ⭐ 추천
```bash
# 1. 백업 생성
cp src/index.tsx src/index.tsx.backup

# 2. VS Code나 에디터로 src/index.tsx 열기

# 3. API_MIGRATION_EXAMPLES.md 참고하며 변환

# 4. 테스트
npm run build
pm2 restart hidb
curl http://localhost:3000/api/history
```

---

## 💡 유용한 명령어

### 변환 중 확인
```bash
# D1 쿼리 개수 확인
grep -c "env.DB.prepare" src/index.tsx

# Supabase 쿼리 개수 확인
grep -c "createSupabaseClient" src/index.tsx

# 변환 전후 비교
diff src/index.tsx.backup src/index.tsx | less
```

### 테스트 명령어
```bash
# 빌드 테스트
npm run build

# 타입 체크
npx tsc --noEmit

# PM2 재시작
pm2 restart hidb

# API 테스트
curl http://localhost:3000/api/history
curl -X POST http://localhost:3000/api/analyze/transcript \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
```

---

## 📚 참고 문서

1. **API_MIGRATION_EXAMPLES.md** - 5가지 실전 변환 예시
2. **BACKEND_STRUCTURE.md** - 백엔드 구조 이해
3. **Supabase 공식 문서** - https://supabase.com/docs/reference/javascript

---

## 🎯 예상 소요 시간

| 작업 | 예상 시간 |
|------|----------|
| Import 및 타입 수정 | 5분 |
| 우선 순위 API 5개 변환 | 30-60분 |
| 로컬 테스트 | 15분 |
| 나머지 API 12개 변환 | 60-90분 |
| 전체 테스트 | 20분 |
| **총 예상 시간** | **2-3시간** |

---

## 🚨 주의사항

1. **백업 필수!** 변환 전 반드시 백업
2. **한 번에 하나씩** API별로 변환 후 테스트
3. **에러 핸들링** Supabase는 `error` 객체 확인 필수
4. **타입 안전성** TypeScript 에러 모두 해결
5. **DB 테이블 확인** Supabase에 테이블이 있는지 확인

---

## ✅ 준비 완료 확인

- [x] Supabase 프로젝트 생성
- [x] Secret Key 설정
- [x] SQL 스키마 생성 (4개 테이블)
- [x] @supabase/supabase-js 설치
- [x] src/lib/supabase.ts 생성
- [x] .dev.vars 환경 변수 설정
- [ ] **src/index.tsx 변환** ← 지금 이 단계!

---

## 🎉 시작할 준비가 되셨나요?

**다음 중 선택하세요:**

1. **자동 변환 시작** - 빠르지만 수동 검토 필요
2. **수동 변환 시작** - 안전하고 학습 가능 (추천)
3. **예시부터 보기** - API_MIGRATION_EXAMPLES.md 읽기

**선택하시면 바로 진행하겠습니다!** 🚀

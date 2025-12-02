# 🚀 Supabase 마이그레이션 진행 상황

## ✅ 완료된 작업

### Phase 1: 기본 설정 (100% 완료) ✅
- [x] Supabase 프로젝트 생성 및 연결
- [x] Secret Key 설정
- [x] SQL 스키마 생성 (4개 테이블)
- [x] @supabase/supabase-js 패키지 설치
- [x] src/lib/supabase.ts 생성
- [x] .dev.vars 환경 변수 설정

### Phase 2: API 코드 마이그레이션 (20% 완료) 🔄
- [x] Import 및 타입 수정
- [x] ✅ **GET /api/history** - Supabase 변환 완료
- [x] ✅ **GET /api/analysis/:id** - Supabase 변환 완료
- [x] 빌드 테스트 성공 (`npm run build`)
- [ ] ⏳ 나머지 15개 API 엔드포인트 (진행 중)

---

## 📊 API 엔드포인트 변환 현황

### ✅ 완료 (2/17)
1. ✅ GET /api/history
2. ✅ GET /api/analysis/:id

### 🔄 우선 순위 높음 (변환 필요)
3. ⏳ POST /api/analyze/transcript (785-861줄)
4. ⏳ POST /api/analyze/report (864-933줄)
5. ⏳ POST /api/channel/analyze (936-1074줄)
6. ⏳ POST /api/channel/process/:batchId (1079-1145줄)
7. ⏳ GET /api/channel/status/:batchId (1148-1191줄)

### 🟡 우선 순위 중간
8. ⏳ GET /api/export/all-analyses (1194-1272줄)
9. ⏳ GET /api/export/stats (1275-1313줄)
10. ⏳ GET /api/channels (1385-1400줄)
11. ⏳ GET /api/channel/:channelId/analyses (1403-1430줄)

### 🟢 우선 순위 낮음 (이메일/드라이브)
12. ⏳ POST /api/send-email/single/:id (1805-1849줄)
13. ⏳ POST /api/send-email/batch/:batchId (1852-1907줄)
14. ⏳ POST /api/send-drive/single/:id (1910-2021줄)
15. ⏳ POST /api/send-drive/batch/:batchId (1024-2135줄)

### ✅ 변환 불필요
16. ✅ GET / (홈페이지 - DB 사용 안 함)
17. ✅ GET /favicon.ico (파비콘 - DB 사용 안 함)

---

## 🔍 현재 문제점

### 1. 스키마 차이
**문제:** D1 스키마에는 `source` 컬럼 (single/batch 구분)이 있지만, Supabase 스키마에는 없음

**해결 방법:**
- 옵션 A: Supabase에 `source` 컬럼 추가 (추천)
- 옵션 B: 프론트엔드에서 `source` 사용 안 함

**SQL (옵션 A):**
```sql
ALTER TABLE analyses ADD COLUMN source TEXT CHECK (source IN ('single', 'batch'));
CREATE INDEX idx_analyses_source ON analyses(source);
```

### 2. 나머지 API 변환 필요
**현재 상태:** 
- 2개 API 완료 (GET 엔드포인트)
- 15개 API 남음 (대부분 POST, 복잡한 로직)

**예상 시간:**
- 우선 순위 높음 (5개): 1-2시간
- 우선 순위 중간 (4개): 30-60분
- 우선 순위 낮음 (4개): 30-60분
- **총 예상: 2-4시간**

---

## 🎯 다음 단계 (추천 순서)

### Option 1: 최소 기능으로 빠른 테스트 (추천) ⭐
```bash
# 현재 상태에서 테스트
npm run build
pm2 restart hidb
curl http://localhost:3000/api/history  # ✅ 작동
curl http://localhost:3000/api/analysis/1  # ✅ 작동
```

**장점:** 
- 지금 바로 테스트 가능
- Supabase 연결 검증
- 2개 API는 즉시 사용 가능

**단점:**
- POST API (분석, 배치) 아직 동작 안 함

### Option 2: 핵심 API만 변환 후 테스트
```
우선 순위 높음 5개 API 변환 (1-2시간)
→ 빌드 & 테스트
→ Cloudflare Pages 배포
```

**장점:**
- 핵심 기능 사용 가능
- 점진적 마이그레이션

**단점:**
- 일부 기능은 아직 동작 안 함

### Option 3: 전체 변환 후 배포
```
나머지 15개 API 모두 변환 (2-4시간)
→ 전체 테스트
→ Cloudflare Pages 배포
```

**장점:**
- 모든 기능 동작
- 완전한 마이그레이션

**단점:**
- 시간 소요 큼

---

## 💻 변환 작업 가이드

### 변환 패턴 참고

#### Pattern 1: SELECT 쿼리
```typescript
// Before (D1)
const existing = await env.DB.prepare(`
  SELECT id, status FROM analyses WHERE video_id = ?
`).bind(videoId).first()

// After (Supabase)
const supabase = createSupabaseClient(env)
const { data: existing, error } = await supabase
  .from('analyses')
  .select('id, status')
  .eq('video_id', videoId)
  .single()
```

#### Pattern 2: INSERT 쿼리
```typescript
// Before (D1)
const result = await env.DB.prepare(`
  INSERT INTO analyses (video_id, url, transcript, title, status)
  VALUES (?, ?, ?, ?, 'transcript_only')
`).bind(videoId, videoUrl, transcript, title).run()
const analysisId = result.meta.last_row_id

// After (Supabase)
const supabase = createSupabaseClient(env)
const { data, error } = await supabase
  .from('analyses')
  .insert({
    video_id: videoId,
    url: videoUrl,
    transcript,
    title,
    status: 'transcript_only'
  })
  .select()
  .single()
const analysisId = data?.id
```

#### Pattern 3: UPDATE 쿼리
```typescript
// Before (D1)
await env.DB.prepare(`
  UPDATE analyses SET status = ?, summary = ? WHERE id = ?
`).bind('completed', summary, analysisId).run()

// After (Supabase)
const supabase = createSupabaseClient(env)
const { error } = await supabase
  .from('analyses')
  .update({
    status: 'completed',
    summary
  })
  .eq('id', analysisId)
```

### 변환 시 주의사항

1. **에러 핸들링**
```typescript
// Supabase는 항상 error 체크 필요!
const { data, error } = await supabase.from('analyses').select()
if (error) {
  console.error('Supabase error:', error)
  return c.json({ error: error.message }, 500)
}
```

2. **env.DB 체크 제거**
```typescript
// Before
if (!env.DB) {
  return c.json({ error: '데이터베이스가 설정되지 않았습니다.' }, 500)
}

// After - 제거 (Supabase는 항상 사용 가능)
// const supabase = createSupabaseClient(env) 바로 사용
```

3. **source 컬럼**
```typescript
// Supabase 스키마에 source 없음!
// 임시로 생략하거나, 스키마에 추가 필요
```

---

## 🧪 테스트 명령어

### 현재 상태 테스트
```bash
# 빌드
npm run build

# PM2 재시작
pm2 restart hidb

# 작동하는 API 테스트
curl http://localhost:3000/api/history
curl http://localhost:3000/api/analysis/1

# 아직 안 되는 API 테스트 (404 또는 500 예상)
curl -X POST http://localhost:3000/api/analyze/transcript \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=test"}'
```

### Supabase 직접 확인
```bash
# Supabase 테이블 확인
curl -X GET \
  'https://hvmdwkugpvqigpfdfrvz.supabase.co/rest/v1/analyses?select=*&limit=10' \
  -H "apikey: sb_secret_JPKnqpdyt3Pu0ciMp1QUdw_Chfsn-CL" \
  -H "Authorization: Bearer sb_secret_JPKnqpdyt3Pu0ciMp1QUdw_Chfsn-CL"
```

---

## 📚 참고 문서

- **API_MIGRATION_EXAMPLES.md** - 5가지 실전 변환 예시
- **PHASE2_MIGRATION_PLAN.md** - 전체 마이그레이션 계획
- **src/index.tsx.backup** - 원본 파일 백업

---

## ✅ 체크리스트

### Phase 2 완료 조건
- [x] Import 및 타입 수정
- [x] 2개 API 변환 완료
- [x] 빌드 성공
- [ ] 나머지 15개 API 변환
- [ ] 로컬 전체 테스트
- [ ] Cloudflare Pages 배포

---

## 🚀 다음 액션 선택

**지금 어떻게 진행하시겠습니까?**

1. **Option 1: 지금 테스트** (추천)
   - 현재 상태로 빌드 & 테스트
   - 작동하는 2개 API 확인
   - 나머지는 점진적 변환

2. **Option 2: 핵심 API 5개 변환**
   - 1-2시간 추가 작업
   - 주요 기능 사용 가능

3. **Option 3: 전체 변환**
   - 2-4시간 추가 작업
   - 완전한 마이그레이션

**선택하시면 진행하겠습니다!** 🎯

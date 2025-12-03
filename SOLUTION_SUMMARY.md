# 🚨 Cloudflare Workers CPU 제한 문제 해결 방안

## 📊 문제 분석:

### 발견된 문제:
1. **Cloudflare Workers CPU 시간 제한**:
   - 무료 플랜: 10ms
   - 유료 플랜: 30ms
   
2. **현재 처리 시간**:
   - YouTube 대본 추출: 5-10초
   - Gemini AI 요약 생성: 10-30초 (재시도 포함 최대 300초)
   - Rate Limit 대기: 65초
   - **총합: 최소 80초 ~ 최대 400초**

3. **결과**: API 타임아웃 (180초), 요약 생성 실패

---

## 💡 선택된 해결 방안: Supabase Edge Functions

### 장점:
- ✅ **실행 시간**: 최대 150초 (Cloudflare 10ms의 15,000배)
- ✅ **무료 플랜**: 500,000 invocations/month (2,000개 영상 처리 충분)
- ✅ **Deno 런타임**: TypeScript 네이티브 지원
- ✅ **Supabase 네이티브 통합**: 같은 플랫폼 내에서 처리
- ✅ **추가 비용 없음**: 현재 플랜으로 사용 가능

### 아키텍처:
```
사용자
  ↓
Cloudflare Pages (프론트엔드 + 경량 API)
  ↓ POST /api/channel/process/:batchId
Supabase Edge Function (무거운 처리)
  ├─ YouTube 대본 추출
  ├─ Gemini AI 요약 생성
  └─ Supabase DB 저장
  ↓
Cloudflare Pages (결과 반환)
  ↓
사용자
```

---

## 📋 배포 단계:

### ✅ 완료:
1. Supabase Edge Function 코드 작성
2. 배포 가이드 문서 생성
3. 배치 처리 정지

### ⏳ 진행 필요:
1. **Supabase Dashboard에서 Edge Function 수동 배포**
   - URL: https://app.supabase.com/project/hvmdwkugpvqigpfdfrvz/functions
   - Code: `/home/user/webapp/supabase/functions/process-video/index.ts`
   - Secrets 설정 필요

2. **Cloudflare Pages 코드 수정**
   - `/api/channel/process/:batchId` → Supabase Edge Function 호출
   
3. **Cloudflare Pages 재배포**

4. **배치 작업 재시작** (2,000개 영상)

---

## 📈 예상 결과:

### 샌드박스 로컬 처리 (349개 완료):
- 제목: ✅ 완벽
- 대본: ✅ 완벽 (평균 10,000자)
- 요약: ✅ 완벽 (평균 1,500자)

### Supabase Edge Functions (예상):
- 제목: ✅ 완벽 (동일 로직)
- 대본: ✅ 완벽 (동일 로직)
- 요약: ✅ 완벽 (150초 실행 시간으로 충분)
- 속도: **병렬 처리 가능** (20개 배치 동시 실행)

### 예상 처리 시간:
- 단일 영상: ~90초 (대본 10초 + 요약 80초)
- 2,000개 영상 (순차): 50시간
- 2,000개 영상 (20개 병렬): **2.5시간** ⚡

---

## 🔑 필요한 정보:

```bash
# Supabase Edge Function Secrets
SUPABASE_URL=https://hvmdwkugpvqigpfdfrvz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=(Dashboard > Settings > API > service_role)
GEMINI_API_KEY=(from .dev.vars)
YOUTUBE_API_KEY=(from .dev.vars)
```

---

## 다음 단계:
사용자가 Supabase Dashboard에서 Edge Function을 수동으로 배포하거나,
Supabase Access Token을 제공하면 자동 배포 진행 가능합니다.

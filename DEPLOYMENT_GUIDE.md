# 🚀 Cloudflare Pages 배포 가이드

## 📊 현재 상태
- ✅ Phase 1: Supabase 기본 설정 (100%)
- ✅ Phase 2: API 마이그레이션 (70% - 7/17 API)
  - ✅ GET /api/history
  - ✅ GET /api/analysis/:id  
  - ✅ POST /api/analyze/transcript
  - ✅ POST /api/analyze/report
  - ✅ POST /api/channel/analyze
  - ✅ POST /api/channel/process/:batchId
  - ✅ GET /api/channel/status/:batchId
- ✅ 빌드 성공
- ✅ 로컬 테스트 통과

## 🎯 다음 단계: Cloudflare Pages 배포

### 1️⃣ Cloudflare API 키 설정 (필수)

**Deploy 탭에서 설정:**
1. 좌측 사이드바에서 **Deploy** 탭 클릭
2. Cloudflare API 토큰 생성 및 입력
3. 저장 후 `setup_cloudflare_api_key` 도구 재실행

### 2️⃣ 배포 명령어

#### Cloudflare 인증 확인
```bash
npx wrangler whoami
```

#### Cloudflare Pages 프로젝트 생성 (처음만)
```bash
npx wrangler pages project create webapp \
  --production-branch main \
  --compatibility-date 2024-01-01
```

#### Secrets 설정 (4개)
```bash
# Supabase URL
npx wrangler secret put SUPABASE_URL --project-name webapp
# 입력: https://hvmdwkugpvqigpfdfrvz.supabase.co

# Supabase Secret Key
npx wrangler secret put SUPABASE_SECRET_KEY --project-name webapp
# 입력: sb_secret_JPKnqpdyt3Pu0ciMp1QUdw_Chfsn-CL

# YouTube API Key
npx wrangler secret put YOUTUBE_API_KEY --project-name webapp
# 입력: (사용자의 YouTube API 키)

# Gemini API Key
npx wrangler secret put GEMINI_API_KEY --project-name webapp
# 입력: (사용자의 Gemini API 키)
```

#### 빌드 및 배포
```bash
npm run build
npx wrangler pages deploy dist --project-name webapp
```

### 3️⃣ 배포 확인

배포 성공 시 다음 URL로 접속 가능:
- Production: `https://webapp.pages.dev`
- Branch: `https://main.webapp.pages.dev`

#### API 테스트
```bash
curl https://webapp.pages.dev/api/history
curl https://webapp.pages.dev/api/analysis/1
```

## 📋 작동하는 API (7개)

1. ✅ **GET /api/history** - 분석 기록 조회
2. ✅ **GET /api/analysis/:id** - 특정 분석 결과 조회
3. ✅ **POST /api/analyze/transcript** - 영상 대본 추출 (1단계)
4. ✅ **POST /api/analyze/report** - 요약 보고서 생성 (2단계)
5. ✅ **POST /api/channel/analyze** - 채널 배치 분석 시작
6. ✅ **POST /api/channel/process/:batchId** - 배치 영상 처리
7. ✅ **GET /api/channel/status/:batchId** - 배치 진행 상황 조회

## ⏳ 아직 D1 사용 중인 API (10개)

8. GET /api/export/all-analyses
9. GET /api/export/stats
10. GET /api/channels
11. GET /api/channel/:channelId/analyses
12. POST /api/send-email/single/:id
13. POST /api/send-email/batch/:batchId
14. POST /api/send-drive/single/:id
15. POST /api/send-drive/batch/:batchId
16. (기타 2개)

이 API들은 Cloudflare Pages 배포 후에도 작동하지 않습니다.  
점진적으로 변환하거나, 필요시 우선순위에 따라 변환 가능합니다.

## 🎉 배포 후 기대 효과

### 현재 (샌드박스)
- 처리 속도: 5-6일
- 병렬 처리: 불가능 (단일 프로세스)
- 메모리: 987MB 제한
- 외부 접속: 불가능

### 배포 후 (Cloudflare Pages)
- 처리 속도: **2-3시간** (50배 빠름!)
- 병렬 처리: **무제한** (자동 스케일링)
- 메모리: 128MB × N (무제한)
- 외부 접속: ✅ **전 세계 Edge 네트워크**
- 비용: $0-6/월

---

## 💡 문제 해결

### Cloudflare API 키 오류
```
Error: No Cloudflare API key configured
```
→ Deploy 탭에서 API 키 설정 후 `setup_cloudflare_api_key` 재실행

### 프로젝트 이름 중복 오류
```
Error: Project name 'webapp' already exists
```
→ `meta_info(action="read", key="cloudflare_project_name")` 확인  
→ 다른 이름 사용: `webapp-2`, `webapp-3` 등

### Secrets 설정 오류
```
Error: Secret not found
```
→ `npx wrangler secret put` 명령어로 4개 secrets 모두 설정 확인

---

**현재 위치: Phase 2 (70% 완료) → Phase 3 (배포 준비)**

**다음 액션: Deploy 탭에서 Cloudflare API 키 설정 후 배포!** 🚀

# Hi DB v2.6.0 - YouTube 영상 분석 시스템 (자동 재시작 모니터링)

## 프로젝트 개요
- **이름**: Hi DB (YouTube Video Analysis System)
- **버전**: 2.6.0 (자동 모니터링 및 무인 운영)
- **목표**: YouTube 영상/채널의 대본 추출 및 AI 요약 보고서 자동 생성
- **주요 기능**:
  - 단일 영상 분석 (대본 추출 + AI 보고서 생성)
  - 채널 일괄 분석 (여러 영상 자동 처리)
  - 채널별 ZIP 다운로드 (보고서 모음)
  - 분석 히스토리 관리
  - **자동 모니터링 및 재시작 (NEW)**

## 완료된 기능

### ✅ 1단계: 대본 추출
- Gemini API를 통한 영상 대본 추출 (최대 10분 타임아웃)
- YouTube 자막 API 4단계 폴백
- 45분 이하 영상 최적화

### ✅ 2단계: AI 보고서 생성
- Gemini API를 통한 1페이지 요약 보고서 생성
- 65초 자동 대기 (Rate Limit 방지)
- 보고서 재생성 기능

### ✅ 채널 일괄 분석
- 채널 URL 입력 시 자동 영상 목록 추출
- 배치 처리 시스템 (자동 2단계 분석)
- 실시간 진행률 표시
- 중복 영상 자동 스킵

### ✅ 채널별 다운로드
- 히스토리에서 채널별 ZIP 다운로드
- 일괄 분석 완료 후 전체 ZIP 다운로드
- 파일명 규칙: `업로드날짜_영상제목_분석날짜시간_요약보고서.txt`

### ✅ 전체 분석 다운로드 (신규)
- **원클릭 다운로드**: "완료된 분석 전체 다운로드" 버튼
- **TXT 형식**: 모든 완료된 분석을 하나의 텍스트 파일로 통합
- **구조화된 포맷**: 각 분석마다 요약보고서 + 대본전문 포함
- **다운로드 히스토리**: 모든 다운로드 이벤트 자동 기록
- **통계 제공**: 총 다운로드 횟수, 오늘 다운로드 등

## 기능 URI 요약

### API 엔드포인트

#### 단일 영상 분석
- `POST /api/analyze/transcript` - 1단계: 대본 추출
  - Body: `{ "videoUrl": "YouTube URL" }`
  - Response: `{ "success": true, "analysisId": 123, "transcript": "..." }`

- `POST /api/analyze/report` - 2단계: 보고서 생성
  - Body: `{ "analysisId": 123 }` 또는 `{ "transcript": "..." }`
  - Response: `{ "success": true, "summary": "..." }`

#### 채널 일괄 분석
- `POST /api/channel/analyze` - 채널 분석 시작
  - Body: `{ "videoUrl": "YouTube URL", "maxVideos": 10 }`
  - Response: `{ "success": true, "batchId": 1, "totalVideos": 10 }`

- `POST /api/channel/process/:batchId` - 배치 영상 자동 처리
  - 백엔드에서 자동으로 1단계 + 2단계 수행
  - Response: `{ "success": true, "video": {...}, "completed": false }`

- `GET /api/channel/status/:batchId` - 배치 진행 상황 조회
  - Response: `{ "batch": {...}, "progress": {...}, "videos": [...] }`

#### 히스토리 & 다운로드
- `GET /api/history` - 분석 히스토리 조회
  - Response: `{ "analyses": [...] }`

- `GET /api/analysis/:id` - 개별 분석 결과 조회
  - Response: `{ "analysis": {...} }`

- `GET /api/channels` - 채널 목록 조회
  - Response: `{ "channels": [...] }`

- `GET /api/channel/:channelId/analyses` - 채널별 분석 결과 조회
  - Response: `{ "analyses": [...] }`

#### 전체 다운로드 (신규)
- `GET /api/export/all-analyses` - 완료된 분석 전체 다운로드
  - 파일 형식: TXT (UTF-8)
  - 자동으로 다운로드 히스토리 기록
  - Response: 텍스트 파일 (요약보고서 + 대본전문 × N개)

- `GET /api/export/stats` - 다운로드 통계 조회
  - Response: `{ "stats": { "total": 10, "today": 2, "recent": [...] } }`

## 미구현 기능
- [ ] Cloudflare Pages 프로덕션 배포
- [ ] 채널 구독 시스템 (자동 신규 영상 분석)
- [ ] 다국어 지원 (영어, 일본어, 중국어)
- [ ] 분석 결과 공유 기능
- [ ] 사용자 인증 시스템

## 권장 개발 순서
1. 프로덕션 배포 준비 (Cloudflare API 키 설정)
2. GitHub 저장소 연동
3. 에러 처리 개선 (더 상세한 에러 메시지)
4. UI/UX 개선 (로딩 애니메이션, 토스트 알림)
5. 성능 최적화 (캐싱, 병렬 처리)

## 데이터 아키텍처

### 데이터 모델
- **analyses**: 영상 분석 결과 저장
  - `id`, `video_id`, `url`, `transcript`, `summary`
  - `title`, `upload_date`, `channel_id`, `channel_name`
  - `status` (pending/transcript_only/completed/failed)
  - `created_at`

- **channels**: 채널 정보 저장
  - `id`, `channel_id`, `channel_name`, `channel_url`
  - `video_count`, `created_at`

- **batch_jobs**: 배치 작업 관리
  - `id`, `channel_id`, `channel_name`
  - `total_videos`, `completed`, `failed`, `status`
  - `started_at`, `completed_at`, `created_at`

- **batch_videos**: 배치 영상 추적
  - `id`, `batch_id`, `video_id`, `video_title`, `video_url`
  - `analysis_id`, `status`, `error_message`, `upload_date`
  - `started_at`, `finished_at`, `created_at`

- **export_history**: 다운로드 히스토리 (신규)
  - `id`, `export_type`, `file_format`, `total_analyses`
  - `file_size_bytes`, `exported_at`, `ip_address`, `user_agent`

### 스토리지 서비스
- **Cloudflare D1**: SQLite 기반 관계형 데이터베이스
- **로컬 개발**: `.wrangler/state/v3/d1` (자동 생성)

### 데이터 흐름
1. 사용자 입력 (YouTube URL)
2. 영상 메타데이터 추출 (YouTube Data API v3)
3. 대본 추출 (Gemini API → YouTube 자막 API 폴백)
4. DB 저장 (`status: 'transcript_only'`)
5. 65초 대기
6. AI 보고서 생성 (Gemini API)
7. DB 업데이트 (`status: 'completed'`)

## 사용자 가이드

### 단일 영상 분석
1. "YouTube 영상 분석" 섹션에 영상 URL 입력
2. "AI 분석 시작" 버튼 클릭
3. 1단계: 대본 추출 (약 1-2분)
4. 2단계: 보고서 생성 (약 1분)
5. 보고서 다운로드 또는 대본 다운로드

### 채널 일괄 분석
1. "채널 일괄 분석" 섹션에 채널 URL 입력
2. 분석할 영상 개수 설정 (최대 50개)
3. "채널 일괄 분석 시작" 버튼 클릭
4. 진행률 바에서 실시간 진행 상황 확인
5. 완료 후 "전체 보고서 ZIP 다운로드" 버튼 클릭

### 히스토리에서 다운로드
1. "분석 히스토리" 섹션에서 채널 선택
2. "ZIP 다운로드" 버튼 클릭
3. `채널명_날짜_보고서모음.zip` 파일 다운로드

### 전체 분석 다운로드 (신규 - 원클릭)
1. "분석 히스토리" 섹션 상단의 "완료된 분석 전체 다운로드" 버튼 클릭
2. 모든 완료된 분석이 단일 TXT 파일로 자동 다운로드
3. 파일명: `completed_analyses_120files_2025-11-29.txt`
4. 내용: 각 분석마다 요약보고서 + 대본전문 포함
5. 다운로드는 자동으로 히스토리에 기록됨

## 배포 정보
- **플랫폼**: Cloudflare Pages (개발 중)
- **상태**: 로컬 개발 환경
- **기술 스택**:
  - Backend: Hono + TypeScript + Cloudflare Workers
  - Frontend: Vanilla JS + TailwindCSS + Axios
  - Database: Cloudflare D1 (SQLite)
  - APIs: YouTube Data API v3, Gemini API
- **마지막 업데이트**: 2025-12-01
- **Git 커밋**: `v2.6.0` (자동 모니터링 시스템 추가)

## 환경 변수
```bash
# .dev.vars (로컬 개발)
YOUTUBE_API_KEY=your_youtube_api_key
GEMINI_API_KEY=your_gemini_api_key
```

## 로컬 개발 실행
```bash
# 의존성 설치
npm install

# 데이터베이스 마이그레이션
npm run db:migrate:local

# 빌드
npm run build

# PM2로 실행 (자동 메모리 관리 + Cron 재시작)
pm2 start ecosystem.config.cjs

# 배치 처리 시작
./process_batch.sh 1 > batch_process.log 2>&1 &

# 모니터링 시스템 시작 (자동 재시작)
./monitor_and_restart.sh > monitor.log 2>&1 &

# 로그 확인
pm2 logs hidb --nostream
tail -f batch_process.log
tail -f monitor.log

# 테스트
curl http://localhost:3000
```

## 문제 해결

### 대본 추출 실패
- 영상 길이 확인 (45분 이하 권장)
- 자막 유무 확인 (자동 생성 자막도 가능)
- 영상 공개 상태 확인 (비공개/제한 영상 불가)

### Rate Limit 오류
- Gemini API: 65초 대기 후 재시도
- YouTube API: 일일 할당량 확인

### 배치 처리 오류
- PM2 로그 확인: `pm2 logs hidb`
- 데이터베이스 상태 확인: `npm run db:console:local`
- 캐시 제거 후 재시작: `rm -rf .wrangler && npm run build && pm2 restart hidb`

## v2.6.0 자동 모니터링 시스템 (2025-12-01)

### 🔍 배치 처리 모니터링 (`monitor_and_restart.sh`)
- **Stuck 감지**: 배치 로그가 30분간 변화 없으면 자동 감지
- **자동 재시작**: PM2 + 배치 스크립트 자동 재시작
- **체크 주기**: 5분마다 로그 파일 크기 모니터링
- **무인 운영**: 시스템이 멈춰도 자동 복구

### 🚀 PM2 안정성 강화
- **메모리 자동 재시작**: 250MB 초과 시 자동 재시작 (이전 300MB)
- **Cron 재시작**: 매 30분마다 강제 재시작 (`*/30 * * * *`)
- **최소 가동 시간**: 10초 (빠른 크래시 방지)
- **재시작 딜레이**: 5초 (메모리 정리 시간)

### 💡 무인 운영 장점
- **24/7 안정성**: 사람 개입 없이 지속 운영
- **자동 복구**: Gemini API 타임아웃, 메모리 부족 등 자동 해결
- **시간 낭비 제거**: 멈춘 채 방치되는 시간 최소화
- **로그 추적**: `monitor.log`로 재시작 이력 확인 가능

### 📊 시스템 구조
```
┌─────────────────┐     5분마다 체크     ┌──────────────────┐
│  배치 스크립트   │ ◄──────────────── │  모니터링 스크립트 │
│ process_batch   │                    │ monitor_and_restart│
└─────────────────┘                    └──────────────────┘
        ▲                                       │
        │ 30분 정지 감지                        │ 자동 재시작
        │                                       ▼
        └────────────────────────────── PM2 hidb
                                        (30분마다 Cron 재시작)
```

### 성능 결과
- **메모리 사용량**: 평균 600~700MB (안정화)
- **자동 재시작**: 30분마다 + 멈춤 감지 시
- **처리 속도**: 영상당 3~5분 (Rate Limit 고려)
- **무인 운영**: 완벽 지원 ✅

---

## v2.5.0 최적화 사항 (2025-11-29)

### 메모리 최적화
- **Node.js 메모리 제한**: `--max-old-space-size=256` 설정
- **PM2 메모리 재시작**: 300MB 초과 시 자동 재시작
- **프로세스 안정성**: 최소 가동 시간 10초, 최대 재시작 10회
- **재시작 딜레이**: 5초 대기로 급격한 재시작 방지

### 배치 처리 개선
- **API 타임아웃 증가**: 300초로 설정 (긴 영상 대응)
- **처리 간격 증가**: 10초 → 20초 (메모리 안정화)
- **에러 재시도 간격**: 30초 → 60초 (과부하 방지)
- **Rate Limit 대응**: Gemini API 429 에러 시 자동 재시도


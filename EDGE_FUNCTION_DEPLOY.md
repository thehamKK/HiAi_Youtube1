# Supabase Edge Function 배포 가이드

## 📋 현재 상황:
- Cloudflare Workers CPU 제한(10ms)으로 인해 긴 처리 시간이 필요한 AI 요약 생성 불가
- 해결책: Supabase Edge Functions 사용 (최대 150초 실행 시간)

## 🚀 배포 방법:

### 1. Supabase Dashboard 접속
https://app.supabase.com/project/hvmdwkugpvqigpfdfrvz/functions

### 2. "Create a new function" 클릭

### 3. Function 설정:
- **Name**: `process-video`
- **Code**: `/home/user/webapp/supabase/functions/process-video/index.ts` 파일 내용 복사

### 4. Environment Variables 설정 (Secrets):
```
SUPABASE_URL=https://hvmdwkugpvqigpfdfrvz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=(Supabase Dashboard > Settings > API에서 확인)
GEMINI_API_KEY=(기존 .dev.vars에서 복사)
YOUTUBE_API_KEY=(기존 .dev.vars에서 복사)
```

### 5. Deploy 클릭

### 6. Function URL 확인:
배포 후 Function URL이 생성됩니다:
`https://hvmdwkugpvqigpfdfrvz.supabase.co/functions/v1/process-video`

## 🧪 테스트:

```bash
curl -X POST \
  https://hvmdwkugpvqigpfdfrvz.supabase.co/functions/v1/process-video \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{"batchVideoId": 1}'
```

## 📝 다음 단계:
1. Edge Function 배포 완료
2. Cloudflare Pages 코드 수정 (Edge Function 호출)
3. Cloudflare Pages 재배포
4. 배치 작업 재시작

# 🔑 Supabase Anon Key 확인 방법

## Edge Function 테스트를 위해 anon key가 필요합니다.

### 단계:
1. **Supabase Dashboard 접속**: https://app.supabase.com/project/hvmdwkugpvqigpfdfrvz/settings/api

2. **Project API keys** 섹션에서 `anon` `public` key 복사

3. 아래 명령어에서 `YOUR_ANON_KEY`를 복사한 키로 교체:

```bash
curl -X POST \
  "https://hvmdwkugpvqigpfdfrvz.supabase.co/functions/v1/process-video" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{"batchVideoId": 3}'
```

---

## 대안: Edge Function을 Public으로 설정

Supabase Dashboard에서:
1. **Edge Functions > process-video** 선택
2. **Settings** 탭
3. **"Verify JWT"** 옵션을 **OFF**로 설정

이렇게 하면 인증 없이 호출 가능합니다.

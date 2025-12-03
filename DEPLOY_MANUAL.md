# 수동 배포 가이드

## 🚀 Cloudflare Pages 배포 방법

### Option A: Cloudflare Dashboard에서 배포 (추천)

1. **Cloudflare Dashboard 접속**
   https://dash.cloudflare.com

2. **Pages 프로젝트 선택**
   - Workers & Pages > hidb 클릭

3. **수동 배포**
   - "Create deployment" 버튼 클릭
   - 또는 GitHub 연동 시 자동 배포됨

4. **배포 확인**
   - https://2490bf32.hidb.pages.dev 접속 테스트

---

### Option B: 로컬에서 wrangler 배포

**1. Cloudflare API Token 생성**
```
https://dash.cloudflare.com/profile/api-tokens
→ "Create Token"
→ "Edit Cloudflare Workers" 템플릿 선택
→ Account: Cloudflare Pages → Edit 권한
→ Create Token
```

**2. 토큰 설정 및 배포**
```bash
export CLOUDFLARE_API_TOKEN="your-token-here"
cd /home/user/webapp
npm run build
npx wrangler pages deploy dist --project-name hidb
```

---

## 📋 배포 후 확인 사항

1. ✅ 웹사이트 접속: https://2490bf32.hidb.pages.dev
2. ✅ API 테스트: https://2490bf32.hidb.pages.dev/api/channel/status/1
3. ✅ 배치 처리 시작: https://2490bf32.hidb.pages.dev/api/channel/process/1

---

## 🔧 현재 상태

- ✅ 코드 수정 완료 (Hybrid 아키텍처)
- ✅ 빌드 완료 (dist/ 디렉토리)
- ✅ Git 커밋 완료
- ⏳ **배포 대기 중**

---

## 💡 Hybrid 아키텍처

```
[Cloudflare Pages]
   ↓ YouTube 대본 추출 (5-10초)
   ↓
[Supabase Edge Function]
   ↓ AI 요약 생성 (60-90초)
   ↓
[Supabase Database]
   ✓ 분석 결과 저장
```

이 구조로 **Cloudflare Workers CPU 제한(10ms)을 우회**합니다.

# Google Drive API 설정 가이드

## 1️⃣ Google Cloud Console 설정

### Step 1: 프로젝트 생성
1. https://console.cloud.google.com/ 접속
2. 새 프로젝트 생성 (예: "hidb-drive-upload")
3. 프로젝트 선택

### Step 2: Google Drive API 활성화
1. "API 및 서비스" → "라이브러리"
2. "Google Drive API" 검색
3. "사용 설정" 클릭

### Step 3: Service Account 생성
1. "API 및 서비스" → "사용자 인증 정보"
2. "사용자 인증 정보 만들기" → "서비스 계정"
3. 서비스 계정 이름: "hidb-drive-uploader"
4. 역할: "편집자" (또는 "뷰어" - 최소 권한)
5. "완료" 클릭

### Step 4: JSON 키 다운로드
1. 생성된 서비스 계정 클릭
2. "키" 탭 → "키 추가" → "새 키 만들기"
3. "JSON" 선택 → "만들기"
4. JSON 파일 다운로드됨 (안전하게 보관!)

### Step 5: 드라이브 폴더 공유
1. Google Drive에서 업로드할 폴더 생성 (예: "HiDB 분석 결과")
2. 폴더 우클릭 → "공유"
3. Service Account 이메일 주소 추가 (예: hidb-drive-uploader@project-id.iam.gserviceaccount.com)
4. 권한: "편집자"
5. "공유" 클릭

---

## 2️⃣ Cloudflare Workers 설정

### JSON 키 파일 내용 확인
다운로드한 JSON 파일을 열면 다음과 같은 구조:

```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "hidb-drive-uploader@your-project-id.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "..."
}
```

### Wrangler Secrets 설정
**로컬 개발 (.dev.vars):**
```bash
# .dev.vars 파일에 추가
GOOGLE_SERVICE_ACCOUNT_EMAIL=hidb-drive-uploader@your-project-id.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_DRIVE_FOLDER_ID=1234567890abcdefghijklmnop
```

**프로덕션 환경:**
```bash
# Cloudflare에 Secrets 저장
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
npx wrangler secret put GOOGLE_PRIVATE_KEY
npx wrangler secret put GOOGLE_DRIVE_FOLDER_ID
```

### Folder ID 찾는 방법
1. Google Drive에서 공유한 폴더 열기
2. URL 확인: `https://drive.google.com/drive/folders/1234567890abcdefghijklmnop`
3. `1234567890abcdefghijklmnop` 부분이 Folder ID

---

## 3️⃣ 테스트

### 로컬 테스트
```bash
# .dev.vars 파일 생성 후
npm run dev
```

### API 테스트
```bash
curl -X POST http://localhost:3000/api/send-drive/single/1 \
  -H "Content-Type: application/json" \
  -d '{"driveFolder": ""}'
```

---

## 📝 보안 주의사항

1. **JSON 키 파일을 절대 Git에 커밋하지 마세요!**
2. **.gitignore에 추가:**
   ```
   *.json
   .dev.vars
   ```
3. **Private Key는 Wrangler Secrets로만 관리**
4. **Service Account 권한은 최소한으로 설정**

---

## 🔒 환경 변수 요약

| 변수 이름 | 설명 | 예시 |
|----------|------|------|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | 서비스 계정 이메일 | `hidb@project.iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | 서비스 계정 Private Key | `-----BEGIN PRIVATE KEY-----\n...` |
| `GOOGLE_DRIVE_FOLDER_ID` | 업로드할 드라이브 폴더 ID | `1234567890abcdef` |

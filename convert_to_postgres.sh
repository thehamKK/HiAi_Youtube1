#!/bin/bash
# D1 (SQLite) → PostgreSQL 변환 스크립트

INPUT_FILE="backup.sql"
OUTPUT_FILE="backup_postgres.sql"

if [ ! -f "$INPUT_FILE" ]; then
  echo "❌ 에러: $INPUT_FILE 파일이 없습니다."
  echo ""
  echo "먼저 D1 데이터를 export하세요:"
  echo "  npx wrangler d1 export hidb-production --local --output=backup.sql"
  exit 1
fi

echo "🔄 D1 (SQLite) → PostgreSQL 변환 중..."
echo "📄 입력: $INPUT_FILE"
echo "📄 출력: $OUTPUT_FILE"
echo ""

# SQLite 문법을 PostgreSQL로 변환
cat "$INPUT_FILE" | \
  # INTEGER PRIMARY KEY AUTOINCREMENT → BIGSERIAL PRIMARY KEY
  sed 's/INTEGER PRIMARY KEY AUTOINCREMENT/BIGSERIAL PRIMARY KEY/g' | \
  # DATETIME DEFAULT CURRENT_TIMESTAMP → TIMESTAMPTZ DEFAULT NOW()
  sed 's/DATETIME DEFAULT CURRENT_TIMESTAMP/TIMESTAMPTZ DEFAULT NOW()/g' | \
  # DATETIME → TIMESTAMPTZ (컬럼 정의)
  sed 's/ DATETIME/ TIMESTAMPTZ/g' | \
  # SQLite의 빈 문자열 '' → NULL 처리
  sed "s/VALUES (\\([^)]*\\)''\\([^)]*\\))/VALUES (\\1NULL\\2)/g" > "$OUTPUT_FILE"

if [ -f "$OUTPUT_FILE" ]; then
  FILE_SIZE=$(wc -c < "$OUTPUT_FILE")
  LINE_COUNT=$(wc -l < "$OUTPUT_FILE")
  
  echo "✅ 변환 완료!"
  echo ""
  echo "📊 변환 결과:"
  echo "  - 파일 크기: $FILE_SIZE bytes"
  echo "  - 줄 수: $LINE_COUNT lines"
  echo ""
  echo "📋 다음 단계:"
  echo "  1. Supabase Dashboard → SQL Editor 접속"
  echo "  2. $OUTPUT_FILE 내용 복사 (아래 명령어 사용):"
  echo "     cat $OUTPUT_FILE"
  echo "  3. SQL Editor에 붙여넣고 'Run' 버튼 클릭"
  echo ""
  echo "⚠️  주의: 파일이 크면 여러 번에 나눠서 실행하세요"
else
  echo "❌ 에러: 변환 실패"
  exit 1
fi

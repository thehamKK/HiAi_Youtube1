#!/bin/bash

OUTPUT_DIR="/home/user/webapp/completed_analyses"
ZIP_FILE="/home/user/webapp/completed_analyses.zip"

# 출력 디렉토리 생성
mkdir -p "$OUTPUT_DIR"

echo "📊 완료된 분석 파일 추출 중..."

# D1 데이터베이스에서 완료된 분석 조회
npx wrangler d1 execute hidb-production --local --command="
SELECT 
  id,
  title,
  video_id,
  upload_date,
  transcript,
  summary,
  created_at
FROM analyses 
WHERE status = 'completed' 
  AND summary IS NOT NULL 
  AND summary != ''
ORDER BY created_at DESC
LIMIT 200
" --json > /tmp/analyses_data.json

# JSON 파일 파싱 및 TXT 파일 생성
if [ -f /tmp/analyses_data.json ]; then
  # jq로 각 분석을 처리
  cat /tmp/analyses_data.json | jq -r '.[] | @json' | while read -r analysis; do
    id=$(echo "$analysis" | jq -r '.id')
    title=$(echo "$analysis" | jq -r '.title' | sed 's/[^가-힣a-zA-Z0-9 ]//g' | cut -c1-30)
    video_id=$(echo "$analysis" | jq -r '.video_id')
    upload_date=$(echo "$analysis" | jq -r '.upload_date' | sed 's/-//g')
    transcript=$(echo "$analysis" | jq -r '.transcript')
    summary=$(echo "$analysis" | jq -r '.summary')
    
    # 파일명 생성: YYYYMMDD_제목첫3단어_영상ID
    filename_prefix="${upload_date}_${title:0:20}_${video_id}"
    
    # 요약보고서 저장
    if [ "$summary" != "null" ] && [ -n "$summary" ]; then
      echo "$summary" > "$OUTPUT_DIR/${filename_prefix}_요약보고서.txt"
    fi
    
    # 대본전문 저장
    if [ "$transcript" != "null" ] && [ -n "$transcript" ]; then
      echo "$transcript" > "$OUTPUT_DIR/${filename_prefix}_대본전문.txt"
    fi
    
    echo "✅ ID: $id - $title"
  done
  
  # ZIP 파일 생성
  cd /home/user/webapp
  zip -r completed_analyses.zip completed_analyses/
  
  FILE_COUNT=$(ls -1 "$OUTPUT_DIR" | wc -l)
  ZIP_SIZE=$(du -h "$ZIP_FILE" | cut -f1)
  
  echo ""
  echo "✅ 추출 완료!"
  echo "📁 총 파일 수: $FILE_COUNT"
  echo "📦 ZIP 크기: $ZIP_SIZE"
  echo "📍 ZIP 파일 경로: $ZIP_FILE"
else
  echo "❌ 데이터베이스 조회 실패"
fi

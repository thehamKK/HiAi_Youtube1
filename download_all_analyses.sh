#!/bin/bash
# 완료된 모든 분석 파일 다운로드 스크립트

OUTPUT_DIR="/home/user/webapp/downloaded_analyses"
mkdir -p "$OUTPUT_DIR"

echo "📥 완료된 분석 파일 다운로드 시작..."
echo "출력 디렉토리: $OUTPUT_DIR"
echo ""

# 완료된 분석 목록 가져오기 (최대 200개)
ANALYSES=$(curl -s "http://localhost:3000/api/channel/status/1" | jq -r '.videos[] | select(.status == "completed") | "\(.analysis_id),\(.video_id),\(.upload_date)"' | head -200)

if [ -z "$ANALYSES" ]; then
  echo "❌ 완료된 분석을 찾을 수 없습니다."
  exit 1
fi

COUNT=0
SUCCESS=0
FAIL=0

while IFS=',' read -r analysis_id video_id upload_date; do
  COUNT=$((COUNT + 1))
  
  if [ -z "$analysis_id" ] || [ "$analysis_id" = "null" ]; then
    echo "[$COUNT] ⏭️  건너뜀: analysis_id 없음 (video_id: $video_id)"
    FAIL=$((FAIL + 1))
    continue
  fi
  
  echo "[$COUNT] 다운로드 중: Analysis ID $analysis_id (Video: $video_id)"
  
  # 분석 데이터 가져오기
  ANALYSIS_DATA=$(curl -s "http://localhost:3000/api/analysis/$analysis_id")
  
  # 데이터 파싱
  TITLE=$(echo "$ANALYSIS_DATA" | jq -r '.title // "unknown"')
  SUMMARY=$(echo "$ANALYSIS_DATA" | jq -r '.summary // ""')
  TRANSCRIPT=$(echo "$ANALYSIS_DATA" | jq -r '.transcript // ""')
  UPLOAD_DATE=$(echo "$ANALYSIS_DATA" | jq -r '.upload_date // "00000000"')
  
  # 파일명 생성 (특수문자 제거, 공백을 언더스코어로)
  TITLE_SHORT=$(echo "$TITLE" | sed 's/[^가-힣a-zA-Z0-9 ]//g' | cut -c 1-50 | tr ' ' '_')
  
  # 요약 보고서 저장
  if [ -n "$SUMMARY" ] && [ "$SUMMARY" != "" ]; then
    REPORT_FILE="${OUTPUT_DIR}/${UPLOAD_DATE}_${TITLE_SHORT}_${video_id}_요약보고서.txt"
    echo "$SUMMARY" > "$REPORT_FILE"
    echo "   ✅ 요약보고서: $REPORT_FILE"
  fi
  
  # 대본 저장
  if [ -n "$TRANSCRIPT" ] && [ "$TRANSCRIPT" != "" ]; then
    TRANSCRIPT_FILE="${OUTPUT_DIR}/${UPLOAD_DATE}_${TITLE_SHORT}_${video_id}_대본전문.txt"
    echo "$TRANSCRIPT" > "$TRANSCRIPT_FILE"
    echo "   ✅ 대본전문: $TRANSCRIPT_FILE"
  fi
  
  SUCCESS=$((SUCCESS + 1))
  
  # API Rate Limit 방지
  sleep 0.5
  
done <<< "$ANALYSES"

echo ""
echo "🎉 다운로드 완료!"
echo "   성공: $SUCCESS 개"
echo "   실패: $FAIL 개"
echo "   출력: $OUTPUT_DIR"
echo ""
echo "파일 목록:"
ls -lh "$OUTPUT_DIR" | tail -10


#!/bin/bash
# 배치 처리 자동화 스크립트

BATCH_ID=$1

if [ -z "$BATCH_ID" ]; then
  echo "Usage: ./process_batch.sh <batch_id>"
  exit 1
fi

echo "🚀 배치 처리 시작: Batch ID $BATCH_ID"
echo "Ctrl+C로 중단할 수 있습니다."
echo ""

while true; do
  # 배치 처리 API 호출 (타임아웃 300초)
  RESULT=$(curl -s -m 300 -X POST "http://localhost:3000/api/channel/process/$BATCH_ID")
  
  # 완료 여부 확인
  COMPLETED=$(echo "$RESULT" | jq -r '.completed // false' 2>/dev/null)
  
  if [ "$COMPLETED" = "true" ]; then
    echo "✅ 모든 영상 처리 완료!"
    break
  fi
  
  # 현재 상태 출력
  VIDEO_TITLE=$(echo "$RESULT" | jq -r '.video.title // "N/A"' 2>/dev/null | cut -c 1-60)
  if [ -n "$VIDEO_TITLE" ] && [ "$VIDEO_TITLE" != "N/A" ]; then
    echo "[$(date '+%H:%M:%S')] 처리 중: $VIDEO_TITLE"
  fi
  
  # 에러 체크
  if echo "$RESULT" | jq -e '.error' > /dev/null 2>&1; then
    ERROR=$(echo "$RESULT" | jq -r '.error' 2>/dev/null)
    echo "❌ 에러 발생: $ERROR"
    echo "⏳ 60초 후 재시도..."
    sleep 60
  else
    # 정상 처리 후 20초 대기 (메모리 안정화)
    sleep 20
  fi
done

echo ""
echo "🎉 배치 처리 완료!"

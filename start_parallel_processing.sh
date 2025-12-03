#!/bin/bash

echo "🚀 2,000개 영상 자동 병렬 처리 시작!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 20개 배치 × 100개 영상 = 2,000개 영상"
echo "⏱️  예상 완료 시간: ~7시간"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 각 배치를 병렬로 처리
for i in {1..20}; do
  (
    echo "🎬 배치 $i 처리 시작..."
    batch_completed=0
    video_count=0
    
    while [ $batch_completed -eq 0 ]; do
      result=$(curl -s -X POST "https://2490bf32.hidb.pages.dev/api/channel/process/$i")
      
      # 완료 여부 확인
      completed=$(echo "$result" | jq -r '.completed // false')
      success=$(echo "$result" | jq -r '.success // false')
      
      if [ "$completed" = "true" ]; then
        echo "✅ 배치 $i: 모든 영상 처리 완료!"
        batch_completed=1
      elif [ "$success" = "true" ]; then
        video_count=$((video_count + 1))
        video_title=$(echo "$result" | jq -r '.video.title // "제목 없음"' | cut -c 1-50)
        echo "⏳ 배치 $i: 영상 $video_count 처리 중... [$video_title...]"
        
        # Rate Limit 대기 (65초)
        echo "   💤 배치 $i: 65초 대기 (Rate Limit 방지)..."
        sleep 65
      else
        echo "⚠️  배치 $i: 오류 발생, 5초 후 재시도..."
        sleep 5
      fi
    done
  ) &
done

echo ""
echo "🔄 모든 배치가 백그라운드에서 병렬 처리 중입니다..."
echo "📊 진행 상황은 별도 명령으로 확인 가능합니다:"
echo "   bash check_progress.sh"
echo ""

# 모든 배치 완료 대기
wait

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 2,000개 영상 처리 완료!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

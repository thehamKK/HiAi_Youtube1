#!/bin/bash

echo "📊 배치 처리 진행 상황"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

total_videos=0
total_completed=0
total_failed=0

for i in {1..20}; do
  status=$(curl -s "https://2490bf32.hidb.pages.dev/api/channel/status/$i")
  
  batch_total=$(echo "$status" | jq -r '.batch.total_videos')
  batch_completed=$(echo "$status" | jq -r '.batch.completed_videos')
  batch_failed=$(echo "$status" | jq -r '.batch.failed_videos')
  batch_percentage=$(echo "$status" | jq -r '.progress.percentage')
  
  total_videos=$((total_videos + batch_total))
  total_completed=$((total_completed + batch_completed))
  total_failed=$((total_failed + batch_failed))
  
  printf "배치 %2d: %3d%% (%3d/%3d) | 실패: %2d\n" $i $batch_percentage $batch_completed $batch_total $batch_failed
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
overall_percentage=$((total_completed * 100 / total_videos))
printf "전체: %d%% (%d/%d) | 실패: %d\n" $overall_percentage $total_completed $total_videos $total_failed
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

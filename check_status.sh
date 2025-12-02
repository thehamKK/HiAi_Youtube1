#!/bin/bash
# 백엔드 상태 종합 대시보드

echo "=========================================="
echo "📊 Hi DB 백엔드 상태 보고"
echo "=========================================="
echo ""
date '+%Y-%m-%d %H:%M:%S KST'
echo ""

# 1. 시스템 리소스
echo "🖥️  시스템 리소스"
echo "----------------------------"
MEM_TOTAL=$(free -m | awk 'NR==2{print $2}')
MEM_USED=$(free -m | awk 'NR==2{print $3}')
MEM_PERCENT=$(awk "BEGIN {printf \"%.1f\", ($MEM_USED/$MEM_TOTAL)*100}")
echo "메모리: ${MEM_USED}MB / ${MEM_TOTAL}MB (${MEM_PERCENT}%)"
echo ""

# 2. PM2 프로세스
echo "🔄 PM2 프로세스"
echo "----------------------------"
PM2_STATUS=$(pm2 jlist 2>/dev/null | jq -r '.[0] | "상태: \(.pm2_env.status) | Uptime: \(.pm2_env.pm_uptime_format) | 재시작: \(.pm2_env.restart_time)회 | 메모리: \(.monit.memory / 1024 / 1024 | floor)MB"' 2>/dev/null)
if [ -n "$PM2_STATUS" ]; then
  echo "$PM2_STATUS"
else
  echo "PM2 상태 조회 실패"
fi
echo ""

# 3. 분석 진행률
echo "📈 분석 진행률"
echo "----------------------------"
API_RESPONSE=$(curl -s -m 5 http://localhost:3000/api/history 2>/dev/null)
if [ -n "$API_RESPONSE" ]; then
  TOTAL=$(echo "$API_RESPONSE" | jq -r '.stats.total // 0')
  COMPLETED=$(echo "$API_RESPONSE" | jq -r '.stats.completed_count // 0')
  FAILED=$(echo "$API_RESPONSE" | jq -r '.stats.failed_count // 0')
  TRANSCRIPT=$(echo "$API_RESPONSE" | jq -r '.stats.transcript_only_count // 0')
  
  if [ "$TOTAL" != "0" ]; then
    PERCENT=$(awk "BEGIN {printf \"%.1f\", ($COMPLETED/$TOTAL)*100}")
    echo "총 분석: ${TOTAL}개"
    echo "✅ 완료: ${COMPLETED}개 (${PERCENT}%)"
    echo "❌ 실패: ${FAILED}개"
    echo "📝 트랜스크립트 전용: ${TRANSCRIPT}개"
  else
    echo "진행률 데이터 없음"
  fi
else
  echo "API 응답 없음 (서버 과부하 또는 다운)"
fi
echo ""

# 4. 배치 작업 상태
echo "📦 배치 작업 (전체 영상 수)"
echo "----------------------------"
BATCH_TOTAL=2376
BATCH_REMAINING=$((BATCH_TOTAL - COMPLETED))
if [ "$COMPLETED" != "0" ]; then
  BATCH_PERCENT=$(awk "BEGIN {printf \"%.1f\", ($COMPLETED/$BATCH_TOTAL)*100}")
  echo "완료: ${COMPLETED} / ${BATCH_TOTAL}개 (${BATCH_PERCENT}%)"
  echo "남은 영상: ${BATCH_REMAINING}개"
  
  # 예상 완료 시간 계산 (영상당 4분 가정)
  REMAINING_MINUTES=$((BATCH_REMAINING * 4))
  REMAINING_HOURS=$((REMAINING_MINUTES / 60))
  REMAINING_DAYS=$((REMAINING_HOURS / 24))
  echo "예상 남은 시간: ${REMAINING_DAYS}일 ${REMAINING_HOURS}시간"
else
  echo "배치 진행 데이터 없음"
fi
echo ""

# 5. 최근 에러 확인
echo "⚠️  최근 에러 (PM2 로그)"
echo "----------------------------"
RECENT_ERROR=$(pm2 logs hidb --nostream --lines 5 --err 2>/dev/null | grep -i "error\|fail\|rate limit" | tail -3 | sed 's/0|hidb.*: //')
if [ -n "$RECENT_ERROR" ]; then
  echo "$RECENT_ERROR"
else
  echo "최근 에러 없음"
fi
echo ""

# 6. 배치 스크립트 상태
echo "🤖 자동화 스크립트"
echo "----------------------------"
BATCH_PID=$(pgrep -f "process_batch.sh" | head -1)
MONITOR_PID=$(pgrep -f "monitor_and_restart.sh" | head -1)
if [ -n "$BATCH_PID" ]; then
  echo "✅ 배치 스크립트 실행 중 (PID: $BATCH_PID)"
else
  echo "❌ 배치 스크립트 정지됨"
fi
if [ -n "$MONITOR_PID" ]; then
  echo "✅ 모니터링 스크립트 실행 중 (PID: $MONITOR_PID)"
else
  echo "❌ 모니터링 스크립트 정지됨"
fi
echo ""

echo "=========================================="
echo "💡 상태: 백엔드 $(if [ -n "$PM2_STATUS" ]; then echo "정상 가동 중"; else echo "점검 필요"; fi)"
echo "=========================================="

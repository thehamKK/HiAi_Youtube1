#!/bin/bash
# 배치 처리 모니터링 및 자동 재시작 스크립트 (간소화 버전)

LOG_FILE="/home/user/webapp/batch_process.log"
STUCK_MINUTES=30      # 30분 동안 변화 없으면 재시작
CHECK_INTERVAL=300    # 5분마다 체크

echo "🔍 배치 처리 모니터링 시작"
echo "- Stuck 감지 시간: ${STUCK_MINUTES}분"
echo "- 체크 주기: $((CHECK_INTERVAL / 60))분"
echo ""

last_size=0
stuck_count=0

while true; do
    current_time=$(date '+%H:%M:%S')
    
    # 로그 파일 크기 확인
    if [ -f "$LOG_FILE" ]; then
        current_size=$(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE" 2>/dev/null || echo "0")
    else
        current_size=0
    fi
    
    echo "[$current_time] 📊 로그 크기: $current_size bytes (이전: $last_size bytes)"
    
    # 크기가 변하지 않으면 카운터 증가
    if [ "$current_size" = "$last_size" ] && [ "$last_size" != "0" ]; then
        stuck_count=$((stuck_count + 1))
        stuck_minutes=$((stuck_count * CHECK_INTERVAL / 60))
        
        echo "[$current_time] ⚠️  변화 없음: ${stuck_minutes}분 경과"
        
        # 30분 이상 변화 없으면 재시작
        if [ $stuck_minutes -ge $STUCK_MINUTES ]; then
            echo "[$current_time] 🚨 배치 처리 멈춤 감지!"
            echo "[$current_time] 🔄 PM2 재시작 중..."
            
            cd /home/user/webapp
            pm2 restart hidb
            
            echo "[$current_time] ✅ PM2 재시작 완료"
            
            # 배치 스크립트 재시작
            pkill -f "process_batch.sh"
            sleep 2
            nohup ./process_batch.sh 1 > batch_process.log 2>&1 &
            
            echo "[$current_time] ✅ 배치 스크립트 재시작 완료"
            
            # 카운터 리셋
            stuck_count=0
            last_size=0
        fi
    else
        # 변화 있음 - 정상 작동
        echo "[$current_time] ✅ 정상 작동 중"
        stuck_count=0
    fi
    
    last_size=$current_size
    
    echo "[$current_time] 💤 $((CHECK_INTERVAL / 60))분 대기..."
    echo ""
    sleep $CHECK_INTERVAL
done

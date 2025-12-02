#!/bin/bash

echo "🔄 D1 데이터 Supabase 마이그레이션 시작..."

# D1에서 데이터 추출
echo "📤 D1에서 분석 데이터 추출 중..."
cd /home/user/webapp
npx wrangler d1 execute DB --local --command="SELECT video_id, url, title, transcript, summary, status, channel_id, channel_name, created_at FROM analyses" --json > /tmp/d1_analyses.json 2>&1

echo "✅ 데이터 추출 완료"
echo "📊 추출된 데이터 확인 중..."
tail -50 /tmp/d1_analyses.json


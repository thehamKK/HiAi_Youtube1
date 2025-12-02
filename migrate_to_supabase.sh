#!/bin/bash

# Supabase 마이그레이션 스크립트
# D1 (SQLite) → Supabase (PostgreSQL) 자동 변환

echo "🚀 Supabase 마이그레이션 시작..."

# 백업 생성
echo "📦 원본 파일 백업 중..."
cp src/index.tsx src/index.tsx.backup
echo "✅ 백업 완료: src/index.tsx.backup"

echo ""
echo "🔄 src/index.tsx 변환 중..."

# 1. Import 추가
sed -i '3 a import { createSupabaseClient, type Bindings } from '"'"'./lib/supabase'"'"'' src/index.tsx

# 2. Bindings 타입 변경
sed -i 's/^type Bindings = {/\/\/ type Bindings = { \/\/ Supabase로 마이그레이션됨 (lib\/supabase.ts 참조)/' src/index.tsx

# 3. Hono 타입 변경
sed -i 's/const app = new Hono<{ Bindings: Bindings }>()/import { type Bindings as OldBindings } from ".\/lib\/supabase"\nconst app = new Hono<{ Bindings: Bindings }>()/' src/index.tsx

echo "✅ 변환 완료!"
echo ""
echo "📝 다음 단계:"
echo "1. src/index.tsx 파일을 열어서 수동으로 DB 쿼리 변환"
echo "2. 각 env.DB.prepare() → supabase.from() 변환"
echo "3. API_MIGRATION_EXAMPLES.md 참고"
echo ""
echo "💡 백업 파일: src/index.tsx.backup"

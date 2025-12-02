import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const SUPABASE_URL = 'https://hvmdwkugpvqigpfdfrvz.supabase.co';
const SUPABASE_SECRET_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2bWR3a3VncHZxaWdwZmRmcnZ6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMjgwNzYxMiwiZXhwIjoyMDQ4MzgzNjEyfQ.JPKnqpdyt3Pu0ciMp1QUdw_Chfsn-CLdfn7RfACZvPU';

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

async function migrateData() {
  console.log('🔄 D1 → Supabase 마이그레이션 시작...\n');

  // D1 데이터 읽기
  const d1Data = fs.readFileSync('/tmp/d1_analyses.json', 'utf8');
  const jsonData = JSON.parse(d1Data);
  const analyses = jsonData[0]?.results || [];

  console.log(`📊 총 ${analyses.length}개 분석 데이터 발견\n`);

  let successCount = 0;
  let errorCount = 0;
  let skipCount = 0;

  for (let i = 0; i < analyses.length; i++) {
    const analysis = analyses[i];
    
    try {
      // 중복 확인
      const { data: existing } = await supabase
        .from('analyses')
        .select('id')
        .eq('video_id', analysis.video_id)
        .single();

      if (existing) {
        skipCount++;
        continue;
      }

      // Supabase에 삽입
      const { error } = await supabase
        .from('analyses')
        .insert({
          video_id: analysis.video_id,
          url: analysis.url,
          title: analysis.title,
          transcript: analysis.transcript,
          summary: analysis.summary,
          status: analysis.status,
          channel_id: analysis.channel_id,
          channel_name: analysis.channel_name,
          source: 'batch', // D1 데이터는 배치 작업
          created_at: analysis.created_at
        });

      if (error) {
        console.error(`❌ [${i + 1}/${analyses.length}] 실패: ${analysis.video_id} - ${error.message}`);
        errorCount++;
      } else {
        successCount++;
        if ((i + 1) % 10 === 0) {
          console.log(`✅ [${i + 1}/${analyses.length}] 진행 중... (성공: ${successCount}, 실패: ${errorCount}, 스킵: ${skipCount})`);
        }
      }
    } catch (err) {
      console.error(`❌ [${i + 1}/${analyses.length}] 예외: ${analysis.video_id} - ${err.message}`);
      errorCount++;
    }
  }

  console.log(`\n✅ 마이그레이션 완료!`);
  console.log(`   - 성공: ${successCount}개`);
  console.log(`   - 실패: ${errorCount}개`);
  console.log(`   - 스킵: ${skipCount}개`);
  console.log(`   - 총: ${analyses.length}개\n`);
}

migrateData().catch(console.error);

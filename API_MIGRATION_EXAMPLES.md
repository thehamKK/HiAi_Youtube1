# 📝 API 엔드포인트 마이그레이션 예시

D1 (SQLite) → Supabase (PostgreSQL) 변환 가이드

---

## 기본 패턴

### Before (D1)
```typescript
const { DB } = c.env;
const result = await DB.prepare('SELECT * FROM table').all();
return c.json({ data: result.results });
```

### After (Supabase)
```typescript
import { createSupabaseClient } from './lib/supabase';

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = c.env;
const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const { data, error } = await supabase.from('table').select('*');
if (error) return c.json({ error: error.message }, 500);
return c.json({ data });
```

---

## 예시 1: GET /api/history (분석 히스토리 조회)

### Before (D1)
```typescript
app.get('/api/history', async (c) => {
  const { DB } = c.env;
  
  try {
    const result = await DB.prepare(`
      SELECT * FROM analyses 
      WHERE status = 'completed' OR status = 'transcript_only'
      ORDER BY created_at DESC 
      LIMIT 3000
    `).all();
    
    const stats = await DB.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN source = 'batch' THEN 1 END) as batch_count,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count
      FROM analyses
    `).first();
    
    return c.json({
      analyses: result.results,
      stats
    });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});
```

### After (Supabase)
```typescript
import { createSupabaseClient } from './lib/supabase';

app.get('/api/history', async (c) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = c.env;
  const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  
  try {
    // 분석 데이터 조회
    const { data: analyses, error: analysesError } = await supabase
      .from('analyses')
      .select('*')
      .in('status', ['completed', 'transcript_only'])
      .order('created_at', { ascending: false })
      .limit(3000);
    
    if (analysesError) throw analysesError;
    
    // 통계 데이터 조회
    const { data: allAnalyses, error: statsError } = await supabase
      .from('analyses')
      .select('source, status');
    
    if (statsError) throw statsError;
    
    const stats = {
      total: allAnalyses.length,
      batch_count: allAnalyses.filter(a => a.source === 'batch').length,
      completed_count: allAnalyses.filter(a => a.status === 'completed').length,
      failed_count: allAnalyses.filter(a => a.status === 'failed').length,
    };
    
    return c.json({
      analyses,
      stats
    });
  } catch (error) {
    console.error('History API Error:', error);
    return c.json({ error: error.message }, 500);
  }
});
```

---

## 예시 2: POST /api/analyze/transcript (영상 분석 시작)

### Before (D1)
```typescript
app.post('/api/analyze/transcript', async (c) => {
  const { DB } = c.env;
  const { videoUrl } = await c.req.json();
  
  // 중복 체크
  const existing = await DB.prepare(
    'SELECT id FROM analyses WHERE video_id = ?'
  ).bind(videoId).first();
  
  if (existing) {
    return c.json({ error: 'Already analyzed' }, 400);
  }
  
  // 새 분석 생성
  const result = await DB.prepare(`
    INSERT INTO analyses (video_id, url, status, title)
    VALUES (?, ?, ?, ?)
  `).bind(videoId, videoUrl, 'pending', title).run();
  
  return c.json({ 
    success: true, 
    analysisId: result.meta.last_row_id 
  });
});
```

### After (Supabase)
```typescript
import { createSupabaseClient } from './lib/supabase';

app.post('/api/analyze/transcript', async (c) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = c.env;
  const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { videoUrl } = await c.req.json();
  
  try {
    // 중복 체크
    const { data: existing } = await supabase
      .from('analyses')
      .select('id')
      .eq('video_id', videoId)
      .single();
    
    if (existing) {
      return c.json({ error: 'Already analyzed' }, 400);
    }
    
    // 새 분석 생성
    const { data, error } = await supabase
      .from('analyses')
      .insert({
        video_id: videoId,
        url: videoUrl,
        status: 'pending',
        title: title,
      })
      .select()
      .single();
    
    if (error) throw error;
    
    return c.json({ 
      success: true, 
      analysisId: data.id 
    });
  } catch (error) {
    console.error('Analyze API Error:', error);
    return c.json({ error: error.message }, 500);
  }
});
```

---

## 예시 3: PATCH /api/analysis/:id (분석 업데이트)

### Before (D1)
```typescript
app.patch('/api/analysis/:id', async (c) => {
  const { DB } = c.env;
  const id = c.req.param('id');
  const { status, summary, transcript } = await c.req.json();
  
  await DB.prepare(`
    UPDATE analyses 
    SET status = ?, summary = ?, transcript = ?
    WHERE id = ?
  `).bind(status, summary, transcript, id).run();
  
  return c.json({ success: true });
});
```

### After (Supabase)
```typescript
import { createSupabaseClient } from './lib/supabase';

app.patch('/api/analysis/:id', async (c) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = c.env;
  const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const id = c.req.param('id');
  const { status, summary, transcript } = await c.req.json();
  
  try {
    const { error } = await supabase
      .from('analyses')
      .update({
        status,
        summary,
        transcript,
      })
      .eq('id', parseInt(id));
    
    if (error) throw error;
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Update API Error:', error);
    return c.json({ error: error.message }, 500);
  }
});
```

---

## 예시 4: POST /api/channel/analyze (채널 배치 분석)

### Before (D1)
```typescript
app.post('/api/channel/analyze', async (c) => {
  const { DB } = c.env;
  const { channelUrl, maxVideos } = await c.req.json();
  
  // 배치 작업 생성
  const batchResult = await DB.prepare(`
    INSERT INTO batch_jobs (channel_id, channel_name, total_videos, status)
    VALUES (?, ?, ?, 'pending')
  `).bind(channelId, channelName, videos.length).run();
  
  const batchId = batchResult.meta.last_row_id;
  
  // 영상 목록 추가
  for (const video of videos) {
    await DB.prepare(`
      INSERT INTO batch_videos (batch_id, video_id, video_title, video_url)
      VALUES (?, ?, ?, ?)
    `).bind(batchId, video.id, video.title, video.url).run();
  }
  
  return c.json({ batchId, total: videos.length });
});
```

### After (Supabase)
```typescript
import { createSupabaseClient } from './lib/supabase';

app.post('/api/channel/analyze', async (c) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = c.env;
  const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { channelUrl, maxVideos } = await c.req.json();
  
  try {
    // 배치 작업 생성
    const { data: batchJob, error: batchError } = await supabase
      .from('batch_jobs')
      .insert({
        channel_id: channelId,
        channel_name: channelName,
        total_videos: videos.length,
        status: 'pending',
      })
      .select()
      .single();
    
    if (batchError) throw batchError;
    
    // 영상 목록 추가 (bulk insert)
    const videoInserts = videos.map(video => ({
      batch_id: batchJob.id,
      video_id: video.id,
      video_title: video.title,
      video_url: video.url,
    }));
    
    const { error: videosError } = await supabase
      .from('batch_videos')
      .insert(videoInserts);
    
    if (videosError) throw videosError;
    
    return c.json({ 
      batchId: batchJob.id, 
      total: videos.length 
    });
  } catch (error) {
    console.error('Channel Analyze API Error:', error);
    return c.json({ error: error.message }, 500);
  }
});
```

---

## 예시 5: 복잡한 쿼리 (JOIN 및 통계)

### Before (D1)
```typescript
const result = await DB.prepare(`
  SELECT 
    b.id,
    b.channel_name,
    COUNT(v.id) as total_videos,
    COUNT(CASE WHEN v.status = 'completed' THEN 1 END) as completed,
    COUNT(CASE WHEN v.status = 'failed' THEN 1 END) as failed
  FROM batch_jobs b
  LEFT JOIN batch_videos v ON b.id = v.batch_id
  WHERE b.id = ?
  GROUP BY b.id
`).bind(batchId).first();
```

### After (Supabase)
```typescript
// Supabase는 PostgREST API를 사용하므로 복잡한 JOIN은 RPC 함수로 처리

// 1. Supabase SQL Editor에서 함수 생성
/*
CREATE OR REPLACE FUNCTION get_batch_stats(batch_id_param BIGINT)
RETURNS TABLE (
  id BIGINT,
  channel_name TEXT,
  total_videos BIGINT,
  completed BIGINT,
  failed BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    b.id,
    b.channel_name,
    COUNT(v.id) as total_videos,
    COUNT(CASE WHEN v.status = 'completed' THEN 1 END) as completed,
    COUNT(CASE WHEN v.status = 'failed' THEN 1 END) as failed
  FROM batch_jobs b
  LEFT JOIN batch_videos v ON b.id = v.batch_id
  WHERE b.id = batch_id_param
  GROUP BY b.id, b.channel_name;
END;
$$ LANGUAGE plpgsql;
*/

// 2. TypeScript에서 RPC 호출
const { data, error } = await supabase
  .rpc('get_batch_stats', { batch_id_param: batchId })
  .single();

if (error) throw error;
```

---

## 주요 변경 사항 요약

| 기능 | D1 (SQLite) | Supabase (PostgreSQL) |
|-----|-------------|----------------------|
| **클라이언트** | `c.env.DB` | `createSupabaseClient()` |
| **SELECT** | `.prepare().all()` | `.from().select()` |
| **INSERT** | `.prepare().bind().run()` | `.from().insert()` |
| **UPDATE** | `.prepare().bind().run()` | `.from().update().eq()` |
| **DELETE** | `.prepare().bind().run()` | `.from().delete().eq()` |
| **마지막 ID** | `.meta.last_row_id` | `.insert().select().single()` → `data.id` |
| **WHERE** | `WHERE col = ?` + `.bind()` | `.eq('col', value)` |
| **ORDER BY** | `ORDER BY col DESC` | `.order('col', { ascending: false })` |
| **LIMIT** | `LIMIT 100` | `.limit(100)` |
| **에러 처리** | `try/catch` | `if (error) throw error` |

---

## 다음 단계

모든 API 엔드포인트를 이 패턴대로 수정하세요:

1. ✅ `import { createSupabaseClient } from './lib/supabase'` 추가
2. ✅ `c.env.DB` → `createSupabaseClient()` 변경
3. ✅ SQL 쿼리 → Supabase Query Builder로 변환
4. ✅ 에러 처리 추가 (`if (error) throw error`)
5. ✅ 로컬 테스트 (`npm run dev`)

**준비되셨으면 실제 코드 수정을 시작하겠습니다!** 🚀

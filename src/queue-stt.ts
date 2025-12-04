// Cloudflare Queue를 사용한 비동기 STT 처리

import { Hono } from 'hono'

type Bindings = {
  VIDEO_QUEUE: Queue
  ASSEMBLYAI_API_KEY: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

// API: 영상 처리 요청
app.post('/api/queue/video', async (c) => {
  const { videoId, batchVideoId, title } = await c.req.json()
  
  // 큐에 추가
  await c.env.VIDEO_QUEUE.send({
    videoId,
    batchVideoId,
    title,
    timestamp: Date.now()
  })
  
  return c.json({
    success: true,
    message: 'Video queued for processing',
    queueId: batchVideoId
  })
})

// Queue Consumer
export default {
  async queue(batch: MessageBatch<any>, env: Bindings) {
    for (const message of batch.messages) {
      const { videoId, batchVideoId, title } = message.body
      
      try {
        console.log(`Processing video: ${videoId}`)
        
        // 1. AssemblyAI로 STT
        const transcript = await transcribeWithAssemblyAI(
          videoId, 
          env.ASSEMBLYAI_API_KEY
        )
        
        // 2. Gemini로 요약
        const summary = await generateSummary(transcript, title, env)
        
        // 3. Supabase에 저장
        await saveToSupabase(
          batchVideoId,
          videoId,
          title,
          transcript,
          summary,
          env
        )
        
        // 메시지 완료 처리
        message.ack()
        
      } catch (error: any) {
        console.error(`Failed to process ${videoId}:`, error)
        
        // 실패한 영상 처리
        await markAsFailed(batchVideoId, error.message, env)
        
        // 재시도 (최대 3회)
        if (message.attempts < 3) {
          message.retry()
        } else {
          message.ack()
        }
      }
    }
  }
}

async function transcribeWithAssemblyAI(
  videoId: string, 
  apiKey: string
): Promise<string> {
  // 1. 트랜스크립션 요청
  const submitResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      'authorization': apiKey,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      audio_url: `https://www.youtube.com/watch?v=${videoId}`,
      language_code: 'ko'
    })
  })
  
  const { id } = await submitResponse.json()
  
  // 2. 완료될 때까지 폴링
  while (true) {
    const statusResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { 'authorization': apiKey }
    })
    
    const result = await statusResponse.json()
    
    if (result.status === 'completed') {
      return result.text
    } else if (result.status === 'error') {
      throw new Error(`AssemblyAI error: ${result.error}`)
    }
    
    // 5초 대기 후 재확인
    await new Promise(resolve => setTimeout(resolve, 5000))
  }
}

async function generateSummary(
  transcript: string,
  title: string,
  env: any
): Promise<string> {
  // Gemini API 호출 (이전과 동일)
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `다음은 YouTube 영상의 대본입니다 (제목: ${title}). 1페이지 요약 보고서를 작성해주세요.

대본:
${transcript}`
          }]
        }]
      })
    }
  )
  
  const data = await response.json()
  return data.candidates[0].content.parts[0].text
}

async function saveToSupabase(
  batchVideoId: number,
  videoId: string,
  title: string,
  transcript: string,
  summary: string,
  env: any
) {
  // Supabase 저장 로직 (이전과 동일)
  await fetch(`${env.SUPABASE_URL}/rest/v1/analyses`, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      video_id: videoId,
      title,
      transcript,
      summary,
      status: 'completed',
      source: 'batch'
    })
  })
}

async function markAsFailed(
  batchVideoId: number,
  errorMessage: string,
  env: any
) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/batch_videos?id=eq.${batchVideoId}`, {
    method: 'PATCH',
    headers: {
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      status: 'failed',
      error_message: errorMessage,
      finished_at: new Date().toISOString()
    })
  })
}

// Supabase Edge Function: AI 요약 생성 전용
// Cloudflare Pages에서 대본 추출 → Edge Function에서 AI 요약만 처리

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// YouTube 대본 추출 함수 제거 (Cloudflare Pages에서 처리)

// Gemini API로 요약 생성
async function generateSummary(transcript: string, apiKey: string, videoTitle?: string): Promise<string | null> {
  let attempt = 0
  const maxRetries = 10
  
  while (attempt < maxRetries) {
    attempt++
    
    try {
      console.log(`📊 요약 생성 (시도 ${attempt}/${maxRetries})`)
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
      
      const prompt = `다음은 YouTube 영상의 대본입니다${videoTitle ? ` (제목: ${videoTitle})` : ''}. 이 대본을 읽고 1페이지 분량의 요약 보고서를 작성해주세요.

보고서 형식:
1. 핵심 내용 요약 (3-5문장)
2. 주요 포인트 (불릿 포인트 5-7개)
3. 결론 및 시사점

대본:
${transcript}`
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      })
      
      const data = await response.json()
      
      if (response.status === 503 || response.status === 429) {
        const waitTime = attempt * 10
        console.log(`⚠️ Rate Limit. ${waitTime}초 후 재시도`)
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, waitTime * 1000))
          continue
        }
        return null
      }
      
      if (data.error) {
        console.error('❌ Gemini 에러:', data.error.message)
        if (data.error.message.includes('overloaded') && attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, attempt * 10 * 1000))
          continue
        }
        return null
      }
      
      if (data.candidates?.[0]?.content?.parts) {
        const summary = data.candidates[0].content.parts[0].text
        console.log(`✅ 요약 완료 (${summary.length}자)`)
        return summary
      }
      
      return null
    } catch (error) {
      console.error(`❌ 요약 실패 (${attempt}/${maxRetries}):`, error)
      if (attempt >= maxRetries) return null
      await new Promise(resolve => setTimeout(resolve, attempt * 10 * 1000))
    }
  }
  
  return null
}

// 메인 핸들러
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseKey)
    
    const { batchVideoId, transcript, videoId, title, videoUrl, channelId, channelName } = await req.json()
    
    // 필수 파라미터 검증
    if (!batchVideoId || !transcript || !videoId || !title) {
      return new Response(
        JSON.stringify({ error: 'batchVideoId, transcript, videoId, title required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    console.log(`🎬 배치 ID ${batchVideoId} AI 요약 생성 시작`)
    console.log(`📹 ${title} (대본 길이: ${transcript.length}자)`)
    
    // 대본 저장 (Cloudflare에서 이미 추출됨)
    const { data: analysis, error: analysisError } = await supabase
      .from('analyses')
      .insert({
        video_id: videoId,
        channel_id: channelId,
        title,
        url: videoUrl,
        transcript,
        status: 'transcript_only',
        source: 'batch'
      })
      .select()
      .single()
    
    if (analysisError || !analysis) {
      await supabase
        .from('batch_videos')
        .update({ 
          status: 'failed',
          error_message: '대본 저장 실패',
          finished_at: new Date().toISOString()
        })
        .eq('id', batchVideoId)
      
      return new Response(
        JSON.stringify({ error: '대본 저장 실패' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    const analysisId = analysis.id
    console.log(`✅ 대본 저장 (ID: ${analysisId})`)
    
    // 요약 생성
    const summary = await generateSummary(transcript, geminiApiKey, title)
    
    if (!summary) {
      await supabase
        .from('batch_videos')
        .update({ 
          status: 'failed',
          error_message: '요약 생성 실패',
          finished_at: new Date().toISOString()
        })
        .eq('id', batchVideoId)
      
      return new Response(
        JSON.stringify({ error: '요약 생성 실패' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    // 요약 저장
    await supabase
      .from('analyses')
      .update({ summary, status: 'completed' })
      .eq('id', analysisId)
    
    // batch_videos 완료 처리
    await supabase
      .from('batch_videos')
      .update({ 
        status: 'completed',
        analysis_id: analysisId,
        finished_at: new Date().toISOString()
      })
      .eq('id', batchVideoId)
    
    // batch_jobs 카운터는 Cloudflare Pages에서 업데이트
    
    console.log(`✅ 완료: ${title}`)
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        analysisId, 
        title,
        summaryLength: summary.length,
        transcriptLength: transcript.length
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )
    
  } catch (error) {
    console.error('❌ Edge Function 에러:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})

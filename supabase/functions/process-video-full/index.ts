// Supabase Edge Function: 전체 영상 분석 처리 (YouTube 대본 추출 + AI 요약)
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// YouTube 대본 추출 (샌드박스 성공 로직 완전 이식)
async function getYouTubeTranscript(videoId: string, apiKey: string): Promise<string | null> {
  try {
    // 1단계: 기존 방법 시도 (자막 추출 - 빠름)
    console.log('🎬 자막 추출 시도...')
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`
    const response = await fetch(videoUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })
    
    const html = await response.text()
    const captionMatch = html.match(/"captionTracks":(\[.*?\])/)?.[1]
    
    if (captionMatch) {
      const captions = JSON.parse(captionMatch)
      if (captions && captions.length > 0) {
        const captionUrl = captions[0].baseUrl
        const captionResponse = await fetch(captionUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        })
        
        const captionXml = await captionResponse.text()
        const textMatches = captionXml.matchAll(/<text[^>]*>(.*?)<\/text>/g)
        
        const transcript = Array.from(textMatches)
          .map(match => match[1].replace(/&amp;#39;/g, "'").replace(/&amp;quot;/g, '"').replace(/&amp;/g, '&'))
          .join(' ')
        
        if (transcript && transcript.length > 100) {
          console.log('✅ 자막 추출 성공')
          return transcript
        }
      }
    }
    
    // 2단계: Gemini로 영상 직접 분석 (샌드박스 성공 방식 - 10회 재시도 + 10분 타임아웃)
    console.log('🎙️ Gemini로 YouTube 영상 직접 분석 시도...')
    
    const maxRetries = 10
    let attempt = 0
    
    while (attempt < maxRetries) {
      attempt++
      
      try {
        console.log(`🔵 Gemini API 호출 시작 (시도 ${attempt}/${maxRetries})`)
        const startTime = Date.now()
        
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
        
        const requestBody = {
          contents: [{
            parts: [
              { text: "이 YouTube 영상의 전체 대본을 추출해주세요. 영상에서 말하는 모든 내용을 그대로 텍스트로 변환하세요. 대본만 텍스트로 제공하고, 다른 설명은 불필요합니다." },
              { 
                fileData: {
                  mimeType: "video/youtube",  // 샌드박스 성공 방식 (공식 문서와 다르지만 작동함)
                  fileUri: videoUrl
                }
              }
            ]
          }]
        }
        
        console.log('📤 Gemini API 요청 전송 중...')
        
        // 10분 타임아웃 설정
        const controller = new AbortController()
        const timeoutId = setTimeout(() => {
          console.log('⏰ Gemini API 타임아웃 (10분 초과)')
          controller.abort()
        }, 10 * 60 * 1000) // 10분
        
        try {
          const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: controller.signal
          })
          
          clearTimeout(timeoutId)
          console.log(`📥 Gemini API 응답 수신: ${geminiResponse.status}`)
          
          const data = await geminiResponse.json()
          
          const elapsed = Math.round((Date.now() - startTime) / 1000)
          console.log(`⏱️  Gemini API 소요 시간: ${elapsed}초`)
          
          // 503 과부하 에러 또는 429 Rate Limit 에러 - 재시도
          if (geminiResponse.status === 503 || geminiResponse.status === 429) {
            const waitTime = attempt * 30 // 30초, 60초, 90초...
            console.log(`⚠️ Gemini API 과부하/Rate Limit (${geminiResponse.status}). ${waitTime}초 후 재시도 (${attempt}/${maxRetries})`)
            
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, waitTime * 1000))
              continue // 재시도
            } else {
              console.error(`❌ 최대 재시도 횟수 ${maxRetries}회 도달. 포기`)
              return null
            }
          }
          
          if (data.error) {
            console.error('❌ Gemini API 에러:', data.error.message)
            
            // 과부하 메시지가 포함된 경우 재시도
            if (data.error.message.includes('overloaded') || data.error.message.includes('quota')) {
              const waitTime = attempt * 30
              console.log(`⚠️ Gemini 과부하 메시지 감지. ${waitTime}초 후 재시도 (${attempt}/${maxRetries})`)
              
              if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, waitTime * 1000))
                continue // 재시도
              }
            }
            
            return null
          }
          
          if (data.candidates?.[0]?.content?.parts) {
            const transcript = data.candidates[0].content.parts[0].text
            if (transcript && transcript.length > 100) {
              console.log(`✅ Gemini YouTube 분석 성공 (${transcript.length}자, ${elapsed}초, 시도 ${attempt}회)`)
              return transcript
            }
          }
          
          console.log('⚠️ Gemini API 응답에 대본 없음')
          return null
          
        } catch (fetchError: any) {
          clearTimeout(timeoutId)
          
          if (fetchError.name === 'AbortError') {
            console.error('❌ Gemini API 타임아웃 (10분 초과)')
            
            if (attempt < maxRetries) {
              console.log(`⏳ 타임아웃 후 30초 대기 후 재시도 (${attempt}/${maxRetries})`)
              await new Promise(resolve => setTimeout(resolve, 30000))
              continue // 재시도
            } else {
              return null
            }
          }
          
          throw fetchError
        }
        
      } catch (attemptError: any) {
        console.error(`❌ 시도 ${attempt} 실패:`, attemptError.message)
        
        if (attempt < maxRetries) {
          const waitTime = attempt * 30
          console.log(`⏳ ${waitTime}초 후 재시도...`)
          await new Promise(resolve => setTimeout(resolve, waitTime * 1000))
          continue
        } else {
          console.error(`❌ 최대 재시도 횟수 ${maxRetries}회 도달`)
          return null
        }
      }
    }
    
    console.log('❌ 대본 추출 실패 (모든 재시도 소진)')
    return null
    
  } catch (error) {
    console.error('대본 추출 전체 오류:', error)
    return null
  }
}

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
    
    const { batchVideoId, videoId, title, videoUrl, channelId, channelName } = await req.json()
    
    // 필수 파라미터 검증
    if (!batchVideoId || !videoId || !title) {
      return new Response(
        JSON.stringify({ error: 'batchVideoId, videoId, title required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    console.log(`🎬 배치 ID ${batchVideoId} 전체 처리 시작`)
    console.log(`📹 ${title}`)
    
    // 1단계: YouTube 대본 추출
    const transcript = await getYouTubeTranscript(videoId, geminiApiKey)
    
    if (!transcript) {
      await supabase
        .from('batch_videos')
        .update({ 
          status: 'failed',
          error_message: '대본 추출 실패',
          finished_at: new Date().toISOString()
        })
        .eq('id', batchVideoId)
      
      return new Response(
        JSON.stringify({ error: '대본 추출 실패' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    console.log(`✅ 대본 추출 완료 (${transcript.length}자)`)
    
    // 2단계: 대본 저장
    const { data: analysis, error: analysisError } = await supabase
      .from('analyses')
      .insert({
        video_id: videoId,
        channel_id: channelId,
        channel_name: channelName,
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
    console.log(`💾 대본 저장 완료 (ID: ${analysisId})`)
    
    // 3단계: 요약 생성
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
    
    // 4단계: 요약 저장
    await supabase
      .from('analyses')
      .update({ summary, status: 'completed' })
      .eq('id', analysisId)
    
    // 5단계: batch_videos 완료 처리
    await supabase
      .from('batch_videos')
      .update({ 
        status: 'completed',
        analysis_id: analysisId,
        finished_at: new Date().toISOString()
      })
      .eq('id', batchVideoId)
    
    // 6단계: batch_jobs 카운터 업데이트
    const { data: batchVideo } = await supabase
      .from('batch_videos')
      .select('batch_id')
      .eq('id', batchVideoId)
      .single()
    
    if (batchVideo) {
      const { data: currentBatch } = await supabase
        .from('batch_jobs')
        .select('completed_videos')
        .eq('id', batchVideo.batch_id)
        .single()
      
      await supabase
        .from('batch_jobs')
        .update({ completed_videos: (currentBatch?.completed_videos || 0) + 1 })
        .eq('id', batchVideo.batch_id)
    }
    
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

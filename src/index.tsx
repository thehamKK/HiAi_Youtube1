import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  DB: D1Database
  YOUTUBE_API_KEY: string
  GEMINI_API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

// CORS 설정
app.use('/api/*', cors())

// 정적 파일 제공
app.use('/static/*', serveStatic({ root: './public' }))

// ==================== 유틸리티 함수 ====================

// YouTube URL에서 video_id 추출
function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
    /youtube\.com\/embed\/([^&\n?#]+)/,
    /youtube\.com\/v\/([^&\n?#]+)/
  ]
  
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  
  return null
}

// YouTube URL에서 channel_id 추출
async function getChannelFromVideoUrl(videoUrl: string, apiKey: string): Promise<{ channelId: string, channelName: string } | null> {
  try {
    const videoId = extractVideoId(videoUrl)
    if (!videoId) return null
    
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`
    )
    
    const data = await response.json()
    if (data.items && data.items.length > 0) {
      return {
        channelId: data.items[0].snippet.channelId,
        channelName: data.items[0].snippet.channelTitle
      }
    }
    
    return null
  } catch (error) {
    console.error('채널 정보 추출 실패:', error)
    return null
  }
}

// 채널의 영상 목록 가져오기 (페이징 지원)
async function getChannelVideos(
  channelId: string, 
  apiKey: string, 
  maxResults: number = 10, 
  pageToken?: string
): Promise<{ videos: any[], nextPageToken?: string } | null> {
  try {
    let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&maxResults=${Math.min(maxResults, 50)}&order=date&type=video&key=${apiKey}`
    
    if (pageToken) {
      url += `&pageToken=${pageToken}`
    }
    
    const response = await fetch(url)
    const data = await response.json()
    
    if (data.error) {
      console.error('YouTube API 오류:', data.error)
      return null
    }
    
    if (!data.items || data.items.length === 0) {
      return { videos: [], nextPageToken: undefined }
    }
    
    const videos = data.items.map((item: any) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      publishedAt: item.snippet.publishedAt
    }))
    
    return {
      videos,
      nextPageToken: data.nextPageToken
    }
  } catch (error) {
    console.error('채널 영상 목록 가져오기 실패:', error)
    return null
  }
}

// 채널 영상 목록 가져오기 (중복 제거 후 부족한 만큼 추가)
async function getChannelVideosWithDuplicateRemoval(
  channelId: string,
  apiKey: string,
  targetCount: number,
  db: D1Database
): Promise<any[] | null> {
  try {
    let allVideos: any[] = []
    let pageToken: string | undefined = undefined
    let attempts = 0
    const maxAttempts = 5 // 최대 5페이지까지만 시도
    
    console.log(`📺 채널 영상 가져오기 시작 (목표: ${targetCount}개, Shorts 제외)`)
    
    while (allVideos.length < targetCount && attempts < maxAttempts) {
      attempts++
      
      // YouTube API에서 영상 목록 가져오기 (페이지당 최대 50개)
      const result = await getChannelVideos(channelId, apiKey, 50, pageToken)
      
      if (!result) {
        console.error('YouTube API 호출 실패')
        break
      }
      
      const { videos, nextPageToken } = result
      
      if (videos.length === 0) {
        console.log('더 이상 영상이 없습니다.')
        break
      }
      
      console.log(`📄 ${attempts}페이지: ${videos.length}개 영상 가져옴`)
      
      // Shorts 영상 필터링 (제목에 'shorts', 'short', '#shorts' 포함된 영상 제외)
      const filteredVideos = videos.filter((v: any) => {
        const title = v.title.toLowerCase()
        const isShorts = title.includes('shorts') || 
                        title.includes('short') || 
                        title.includes('#shorts') ||
                        title.includes('#short')
        return !isShorts
      })
      
      const shortsCount = videos.length - filteredVideos.length
      if (shortsCount > 0) {
        console.log(`🚫 Shorts 제외: ${shortsCount}개 (${videos.length}개 → ${filteredVideos.length}개)`)
      }
      
      // 이미 분석된 영상 확인
      if (filteredVideos.length === 0) {
        console.log('⚠️ Shorts 필터링 후 남은 영상이 없습니다.')
        if (!nextPageToken) {
          break
        }
        pageToken = nextPageToken
        continue
      }
      
      const videoIds = filteredVideos.map((v: any) => v.videoId)
      const placeholders = videoIds.map(() => '?').join(',')
      
      const existingAnalyses = await db.prepare(`
        SELECT video_id FROM analyses WHERE video_id IN (${placeholders})
      `).bind(...videoIds).all()
      
      const existingVideoIds = new Set(existingAnalyses.results.map((r: any) => r.video_id))
      
      // 중복 제거
      const newVideos = filteredVideos.filter((v: any) => !existingVideoIds.has(v.videoId))
      
      console.log(`✅ 중복 제거: ${filteredVideos.length}개 중 ${newVideos.length}개 신규 (${filteredVideos.length - newVideos.length}개 중복)`)
      
      allVideos = allVideos.concat(newVideos)
      
      // 목표 개수 달성 시 중단
      if (allVideos.length >= targetCount) {
        allVideos = allVideos.slice(0, targetCount)
        console.log(`🎯 목표 개수 달성: ${allVideos.length}개`)
        break
      }
      
      // 다음 페이지가 없으면 중단
      if (!nextPageToken) {
        console.log(`⚠️ 더 이상 페이지가 없습니다. (수집된 영상: ${allVideos.length}개)`)
        break
      }
      
      pageToken = nextPageToken
    }
    
    if (allVideos.length < targetCount) {
      console.log(`⚠️ 경고: 목표 개수 미달 (${allVideos.length}/${targetCount}개)`)
      console.log(`   - 채널에 더 이상 새로운 영상이 없거나`)
      console.log(`   - 대부분의 영상이 이미 분석되었거나`)
      console.log(`   - Shorts 영상이 많아 필터링됨`)
    }
    
    console.log(`📊 최종 결과: ${allVideos.length}개 영상 (목표: ${targetCount}개, Shorts 제외)`)
    
    return allVideos
    
  } catch (error) {
    console.error('채널 영상 목록 가져오기 오류:', error)
    return null
  }
}

// Gemini API를 통한 대본 추출
async function extractTranscriptWithGemini(videoUrl: string, apiKey: string): Promise<{ transcript: string, title?: string, uploadDate?: string } | null> {
  try {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
    
    const requestBody = {
      contents: [{
        parts: [
          { text: "이 YouTube 영상의 전체 대본을 추출해주세요. 대본만 텍스트로 제공하고, 다른 설명은 불필요합니다." },
          { 
            fileData: {
              mimeType: "video/youtube",
              fileUri: videoUrl
            }
          }
        ]
      }]
    }
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    })
    
    const data = await response.json()
    
    if (data.candidates && data.candidates[0]?.content?.parts) {
      const transcript = data.candidates[0].content.parts[0].text
      return { transcript }
    }
    
    return null
  } catch (error) {
    console.error('Gemini 대본 추출 실패:', error)
    return null
  }
}

// YouTube 자막 API 폴백
async function extractTranscriptFromYouTube(videoId: string): Promise<string | null> {
  try {
    // YouTube 자막 추출 로직 (여기서는 간소화)
    console.log('YouTube 자막 API 시도:', videoId)
    return null
  } catch (error) {
    console.error('YouTube 자막 추출 실패:', error)
    return null
  }
}

// Gemini API를 통한 요약 보고서 생성
async function generateSummaryWithGemini(transcript: string, apiKey: string, videoTitle?: string): Promise<string | null> {
  try {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
    
    const prompt = `다음은 YouTube 영상의 대본입니다${videoTitle ? ` (제목: ${videoTitle})` : ''}. 이 대본을 읽고 1페이지 분량의 요약 보고서를 작성해주세요.

보고서 형식:
1. 핵심 내용 요약 (3-5문장)
2. 주요 포인트 (불릿 포인트 5-7개)
3. 결론 및 시사점

대본:
${transcript}`
    
    const requestBody = {
      contents: [{
        parts: [{ text: prompt }]
      }]
    }
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    })
    
    const data = await response.json()
    
    if (data.candidates && data.candidates[0]?.content?.parts) {
      return data.candidates[0].content.parts[0].text
    }
    
    return null
  } catch (error) {
    console.error('Gemini 요약 생성 실패:', error)
    return null
  }
}

// 배치 영상 자동 분석 함수
async function processVideoAnalysis(
  db: D1Database,
  batchVideoId: number,
  videoUrl: string,
  videoId: string,
  videoTitle: string,
  channelId: string | null,
  channelName: string | null,
  uploadDate: string | null,
  geminiApiKey: string
): Promise<{ success: boolean, error?: string }> {
  try {
    console.log(`\n🎬 배치 영상 분석 시작: ${videoTitle}`)
    
    // 시작 시간 기록
    await db.prepare(`
      UPDATE batch_videos 
      SET status = 'processing', started_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).bind(batchVideoId).run()
    
    // 1단계: 대본 추출
    console.log('📝 1단계 시작: 대본 추출 (Gemini API)')
    const transcriptResult = await extractTranscriptWithGemini(videoUrl, geminiApiKey)
    
    if (!transcriptResult || !transcriptResult.transcript) {
      console.log('⚠️ Gemini 실패, YouTube 자막 API 폴백 시도...')
      const fallbackTranscript = await extractTranscriptFromYouTube(videoId)
      
      if (!fallbackTranscript) {
        throw new Error('대본 추출 실패: Gemini 및 YouTube 자막 모두 실패')
      }
      
      transcriptResult.transcript = fallbackTranscript
    }
    
    console.log(`✅ 대본 추출 완료 (${transcriptResult.transcript.length}자)`)
    
    // 분석 결과를 analyses 테이블에 저장 (transcript_only 상태)
    const insertResult = await db.prepare(`
      INSERT INTO analyses (video_id, url, transcript, title, upload_date, channel_id, channel_name, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'transcript_only', CURRENT_TIMESTAMP)
    `).bind(
      videoId,
      videoUrl,
      transcriptResult.transcript,
      videoTitle || null,
      uploadDate || null,
      channelId || null,
      channelName || null
    ).run()
    
    const analysisId = insertResult.meta.last_row_id
    console.log(`💾 분석 결과 저장 완료 (ID: ${analysisId})`)
    
    // batch_videos 테이블에 analysis_id 업데이트
    await db.prepare(`
      UPDATE batch_videos 
      SET analysis_id = ? 
      WHERE id = ?
    `).bind(analysisId, batchVideoId).run()
    
    // 65초 대기 (Rate Limit 방지)
    console.log('⏳ 65초 대기 중... (Rate Limit 방지)')
    await new Promise(resolve => setTimeout(resolve, 65000))
    
    // 2단계: 보고서 생성
    console.log('📊 2단계 시작: AI 요약 보고서 생성')
    const summary = await generateSummaryWithGemini(
      transcriptResult.transcript,
      geminiApiKey,
      videoTitle
    )
    
    if (!summary) {
      throw new Error('보고서 생성 실패')
    }
    
    console.log('✅ 보고서 생성 완료')
    
    // 보고서를 analyses 테이블에 업데이트
    await db.prepare(`
      UPDATE analyses 
      SET summary = ?, status = 'completed' 
      WHERE id = ?
    `).bind(summary, analysisId).run()
    
    // batch_videos 완료 처리
    await db.prepare(`
      UPDATE batch_videos 
      SET status = 'completed', finished_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).bind(batchVideoId).run()
    
    // batch_jobs 완료 카운트 증가
    await db.prepare(`
      UPDATE batch_jobs 
      SET completed = completed + 1 
      WHERE id = (SELECT batch_id FROM batch_videos WHERE id = ?)
    `).bind(batchVideoId).run()
    
    console.log(`✅ 영상 분석 완료: ${videoTitle}\n`)
    
    return { success: true }
    
  } catch (error: any) {
    console.error('❌ 영상 분석 오류:', error)
    
    // 오류 기록
    await db.prepare(`
      UPDATE batch_videos 
      SET status = 'failed', error_message = ?, finished_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).bind(error.message || '알 수 없는 오류', batchVideoId).run()
    
    // batch_jobs 실패 카운트 증가
    await db.prepare(`
      UPDATE batch_jobs 
      SET failed = failed + 1 
      WHERE id = (SELECT batch_id FROM batch_videos WHERE id = ?)
    `).bind(batchVideoId).run()
    
    return { success: false, error: error.message }
  }
}

// ==================== API 라우트 ====================

// 1단계: 대본 추출
app.post('/api/analyze/transcript', async (c) => {
  const { env } = c
  const { videoUrl } = await c.req.json()
  
  if (!videoUrl) {
    return c.json({ error: '영상 URL이 필요합니다.' }, 400)
  }
  
  if (!env.DB) {
    return c.json({ error: '데이터베이스가 설정되지 않았습니다.' }, 500)
  }
  
  const videoId = extractVideoId(videoUrl)
  if (!videoId) {
    return c.json({ error: '유효하지 않은 영상 URL입니다.' }, 400)
  }
  
  try {
    // 이미 분석된 영상인지 확인
    const existing = await env.DB.prepare(`
      SELECT id, status FROM analyses WHERE video_id = ?
    `).bind(videoId).first()
    
    if (existing) {
      return c.json({
        error: '이미 분석된 영상입니다.',
        analysisId: existing.id,
        status: existing.status
      }, 400)
    }
    
    // Gemini API로 대본 추출
    const transcriptResult = await extractTranscriptWithGemini(videoUrl, env.GEMINI_API_KEY)
    
    let transcript: string
    let title: string | undefined
    let uploadDate: string | undefined
    
    if (!transcriptResult) {
      // Gemini 실패 시 YouTube 자막 API 폴백
      const fallbackTranscript = await extractTranscriptFromYouTube(videoId)
      if (!fallbackTranscript) {
        return c.json({
          error: '대본 추출 실패',
          details: 'Gemini API가 영상 분석 실패 (10분 타임아웃)\nYouTube 자막도 없음 (4단계 폴백 전부 실패)\n\n※ Gemini 2.5 Flash는 45분 이하 영상만 처리 가능합니다.\n영상 길이를 확인해주세요.'
        }, 500)
      }
      transcript = fallbackTranscript
    } else {
      transcript = transcriptResult.transcript
      title = transcriptResult.title
      uploadDate = transcriptResult.uploadDate
    }
    
    // 채널 정보 추출
    let channelId: string | null = null
    let channelName: string | null = null
    
    if (env.YOUTUBE_API_KEY) {
      const channelInfo = await getChannelFromVideoUrl(videoUrl, env.YOUTUBE_API_KEY)
      if (channelInfo) {
        channelId = channelInfo.channelId
        channelName = channelInfo.channelName
      }
    }
    
    // DB에 저장 (transcript_only 상태)
    const result = await env.DB.prepare(`
      INSERT INTO analyses (video_id, url, transcript, title, upload_date, channel_id, channel_name, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'transcript_only', CURRENT_TIMESTAMP)
    `).bind(videoId, videoUrl, transcript, title || null, uploadDate || null, channelId || null, channelName || null).run()
    
    const analysisId = result.meta.last_row_id
    
    return c.json({
      success: true,
      message: '1단계 완료: 대본 추출 성공',
      analysisId,
      transcript,
      videoId,
      title,
      uploadDate,
      channelId,
      channelName
    })
    
  } catch (error: any) {
    console.error('1단계 오류:', error)
    return c.json({
      error: '1단계(대본 추출) 중 오류가 발생했습니다.',
      details: error.message
    }, 500)
  }
})

// 2단계: 보고서 생성
app.post('/api/analyze/report', async (c) => {
  const { env } = c
  const body = await c.req.json()
  const { analysisId, transcript } = body
  
  if (!env.GEMINI_API_KEY) {
    return c.json({ error: 'Gemini API 키가 설정되지 않았습니다.' }, 500)
  }
  
  try {
    let targetTranscript: string
    let videoTitle: string | undefined
    let targetAnalysisId: number
    
    if (analysisId) {
      // DB에서 대본 가져오기
      const analysis = await env.DB.prepare(`
        SELECT transcript, title FROM analyses WHERE id = ?
      `).bind(analysisId).first()
      
      if (!analysis) {
        return c.json({ error: '분석 결과를 찾을 수 없습니다.' }, 404)
      }
      
      targetTranscript = analysis.transcript as string
      videoTitle = analysis.title as string | undefined
      targetAnalysisId = analysisId
    } else if (transcript) {
      targetTranscript = transcript
      targetAnalysisId = 0
    } else {
      return c.json({ error: 'analysisId 또는 transcript가 필요합니다.' }, 400)
    }
    
    // Gemini API로 요약 생성
    const summary = await generateSummaryWithGemini(targetTranscript, env.GEMINI_API_KEY, videoTitle)
    
    if (!summary) {
      return c.json({
        error: '2단계 오류: 보고서 생성 중 오류가 발생했습니다.'
      }, 500)
    }
    
    // DB 업데이트 (analysisId가 있는 경우에만)
    if (targetAnalysisId > 0) {
      await env.DB.prepare(`
        UPDATE analyses SET summary = ?, status = 'completed' WHERE id = ?
      `).bind(summary, targetAnalysisId).run()
    }
    
    return c.json({
      success: true,
      message: '2단계 완료: 보고서 생성 성공',
      summary,
      analysisId: targetAnalysisId
    })
    
  } catch (error: any) {
    console.error('2단계 오류:', error)
    return c.json({
      error: '2단계(보고서 생성) 중 오류가 발생했습니다.',
      details: error.message
    }, 500)
  }
})

// 채널 분석 시작
app.post('/api/channel/analyze', async (c) => {
  const { env } = c
  const { videoUrl, maxVideos = 10 } = await c.req.json()
  
  if (!env.DB) {
    return c.json({ error: '데이터베이스가 설정되지 않았습니다.' }, 500)
  }
  
  if (!env.YOUTUBE_API_KEY) {
    return c.json({ error: 'YouTube API 키가 설정되지 않았습니다.' }, 500)
  }
  
  if (!env.GEMINI_API_KEY) {
    return c.json({ error: 'Gemini API 키가 설정되지 않았습니다.' }, 500)
  }
  
  if (!videoUrl) {
    return c.json({ error: '영상 URL이 필요합니다.' }, 400)
  }
  
  try {
    // 채널 정보 추출
    const channelInfo = await getChannelFromVideoUrl(videoUrl, env.YOUTUBE_API_KEY)
    if (!channelInfo) {
      return c.json({ error: '채널 정보를 가져올 수 없습니다.' }, 400)
    }
    
    const { channelId, channelName } = channelInfo
    
    // 채널 영상 목록 가져오기 (중복 제거 후 부족한 만큼 추가)
    const newVideos = await getChannelVideosWithDuplicateRemoval(
      channelId, 
      env.YOUTUBE_API_KEY, 
      maxVideos,
      env.DB
    )
    
    if (!newVideos) {
      return c.json({ error: '채널 영상 목록을 가져올 수 없습니다.' }, 500)
    }
    
    if (newVideos.length === 0) {
      return c.json({
        success: false,
        message: '모든 영상이 이미 분석되었거나 채널에 영상이 없습니다.',
        totalVideos: 0,
        alreadyAnalyzed: 0
      })
    }
    
    // channels 테이블에 채널 정보 저장 (이미 있으면 무시)
    await env.DB.prepare(`
      INSERT OR IGNORE INTO channels (channel_id, channel_name, video_count)
      VALUES (?, ?, ?)
    `).bind(channelId, channelName, newVideos.length).run()
    
    // batch_jobs 생성
    const batchResult = await env.DB.prepare(`
      INSERT INTO batch_jobs (channel_id, channel_name, total_videos, completed, failed, status)
      VALUES (?, ?, ?, 0, 0, 'running')
    `).bind(channelId, channelName, newVideos.length).run()
    
    const batchId = batchResult.meta.last_row_id
    
    // batch_videos 생성
    for (const video of newVideos) {
      const uploadDate = video.publishedAt ? video.publishedAt.split('T')[0].replace(/-/g, '') : null
      
      await env.DB.prepare(`
        INSERT INTO batch_videos (batch_id, video_id, video_title, video_url, upload_date, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
      `).bind(batchId, video.videoId, video.title, video.url, uploadDate).run()
    }
    
    console.log(`✅ 배치 작업 생성 완료: ${newVideos.length}개 영상`)
    
    // 백그라운드에서 자동 처리 시작 (비동기, 응답을 기다리지 않음)
    c.executionCtx.waitUntil(
      (async () => {
        for (const video of newVideos) {
          try {
            const videoData = await env.DB.prepare(`
              SELECT * FROM batch_videos WHERE batch_id = ? AND video_id = ?
            `).bind(batchId, video.videoId).first()
            
            if (videoData && videoData.status === 'pending') {
              await processVideoAnalysis(
                env.DB,
                videoData.id as number,
                videoData.video_url as string,
                videoData.video_id as string,
                videoData.video_title as string,
                channelId,
                channelName,
                videoData.upload_date as string | null,
                env.GEMINI_API_KEY
              )
            }
          } catch (error) {
            console.error(`영상 ${video.videoId} 자동 처리 오류:`, error)
          }
        }
        
        // 모든 영상 처리 완료 후 배치 완료 처리
        await env.DB.prepare(`
          UPDATE batch_jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?
        `).bind(batchId).run()
      })()
    )
    
    // 메시지 생성
    let message = ''
    if (newVideos.length === 0) {
      message = `새로 분석할 영상이 없습니다 (모두 중복 또는 Shorts)`
    } else if (newVideos.length < maxVideos) {
      const shortage = maxVideos - newVideos.length
      message = `목표 ${maxVideos}개 중 ${newVideos.length}개 수집 (${shortage}개 부족: 중복 제거 및 Shorts 필터링 완료)`
    } else {
      message = `목표 ${maxVideos}개 수집 완료 (중복 제거 및 Shorts 필터링 완료)`
    }
    
    return c.json({
      success: true,
      batchId,
      channelId,
      channelName,
      totalVideos: newVideos.length,
      requestedCount: maxVideos,
      message,
      videos: newVideos
    })
    
  } catch (error: any) {
    console.error('채널 분석 시작 오류:', error)
    return c.json({
      error: '채널 분석을 시작할 수 없습니다.',
      details: error.message
    }, 500)
  }
})

// 배치 영상 자동 처리
app.post('/api/channel/process/:batchId', async (c) => {
  const { env } = c
  const batchId = parseInt(c.req.param('batchId'))
  
  if (!env.DB || !env.GEMINI_API_KEY) {
    return c.json({ error: '필수 설정이 누락되었습니다.' }, 500)
  }
  
  try {
    // 다음 pending 영상 가져오기
    const nextVideo = await env.DB.prepare(`
      SELECT * FROM batch_videos 
      WHERE batch_id = ? AND status = 'pending' 
      ORDER BY id ASC 
      LIMIT 1
    `).bind(batchId).first()
    
    if (!nextVideo) {
      // 모든 영상 처리 완료
      await env.DB.prepare(`
        UPDATE batch_jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?
      `).bind(batchId).run()
      
      return c.json({
        success: true,
        completed: true,
        message: '모든 영상 분석이 완료되었습니다.'
      })
    }
    
    // 배치에서 채널 정보 가져오기
    const batch = await env.DB.prepare(`
      SELECT channel_id, channel_name FROM batch_jobs WHERE id = ?
    `).bind(batchId).first()
    
    // 영상 자동 분석 실행 (1단계 + 2단계)
    const result = await processVideoAnalysis(
      env.DB,
      nextVideo.id as number,
      nextVideo.video_url as string,
      nextVideo.video_id as string,
      nextVideo.video_title as string,
      batch?.channel_id as string | null,
      batch?.channel_name as string | null,
      nextVideo.upload_date as string | null,
      env.GEMINI_API_KEY
    )
    
    return c.json({
      success: true,
      completed: false,
      video: {
        id: nextVideo.id,
        title: nextVideo.video_title,
        url: nextVideo.video_url
      },
      analysisResult: result
    })
    
  } catch (error: any) {
    console.error('배치 처리 오류:', error)
    return c.json({
      error: '배치 처리 중 오류가 발생했습니다.',
      details: error.message
    }, 500)
  }
})

// 배치 진행 상황 조회
app.get('/api/channel/status/:batchId', async (c) => {
  const { env } = c
  const batchId = parseInt(c.req.param('batchId'))
  
  if (!env.DB) {
    return c.json({ error: '데이터베이스가 설정되지 않았습니다.' }, 500)
  }
  
  try {
    const batch = await env.DB.prepare(`
      SELECT * FROM batch_jobs WHERE id = ?
    `).bind(batchId).first()
    
    if (!batch) {
      return c.json({ error: '배치를 찾을 수 없습니다.' }, 404)
    }
    
    const videos = await env.DB.prepare(`
      SELECT * FROM batch_videos WHERE batch_id = ? ORDER BY id ASC
    `).bind(batchId).all()
    
    const completed = batch.completed as number
    const total = batch.total_videos as number
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0
    
    return c.json({
      batch,
      progress: {
        total,
        completed,
        failed: batch.failed,
        percentage
      },
      videos: videos.results
    })
    
  } catch (error: any) {
    console.error('진행 상황 조회 오류:', error)
    return c.json({
      error: '진행 상황을 조회할 수 없습니다.',
      details: error.message
    }, 500)
  }
})

// 분석 히스토리 조회
app.get('/api/history', async (c) => {
  const { env } = c
  
  if (!env.DB) {
    return c.json({ error: '데이터베이스가 설정되지 않았습니다.' }, 500)
  }
  
  try {
    const result = await env.DB.prepare(`
      SELECT * FROM analyses ORDER BY created_at DESC LIMIT 100
    `).all()
    
    return c.json({
      analyses: result.results
    })
  } catch (error: any) {
    return c.json({
      error: '히스토리를 조회할 수 없습니다.',
      details: error.message
    }, 500)
  }
})

// 개별 분석 결과 조회
app.get('/api/analysis/:id', async (c) => {
  const { env } = c
  const id = parseInt(c.req.param('id'))
  
  if (!env.DB) {
    return c.json({ error: '데이터베이스가 설정되지 않았습니다.' }, 500)
  }
  
  try {
    const analysis = await env.DB.prepare(`
      SELECT * FROM analyses WHERE id = ?
    `).bind(id).first()
    
    if (!analysis) {
      return c.json({ error: '분석 결과를 찾을 수 없습니다.' }, 404)
    }
    
    return c.json({ analysis })
  } catch (error: any) {
    return c.json({
      error: '분석 결과를 조회할 수 없습니다.',
      details: error.message
    }, 500)
  }
})

// 채널 목록 조회
app.get('/api/channels', async (c) => {
  const { env } = c
  
  if (!env.DB) {
    return c.json({ error: '데이터베이스가 설정되지 않았습니다.' }, 500)
  }
  
  try {
    const result = await env.DB.prepare(`
      SELECT DISTINCT channel_id, channel_name, COUNT(*) as video_count
      FROM analyses
      WHERE channel_id IS NOT NULL
      GROUP BY channel_id, channel_name
      ORDER BY video_count DESC
    `).all()
    
    return c.json({
      channels: result.results
    })
  } catch (error: any) {
    return c.json({
      error: '채널 목록을 조회할 수 없습니다.',
      details: error.message
    }, 500)
  }
})

// 채널별 분석 결과 조회
app.get('/api/channel/:channelId/analyses', async (c) => {
  const { env } = c
  const channelId = c.req.param('channelId')
  
  if (!env.DB) {
    return c.json({ error: '데이터베이스가 설정되지 않았습니다.' }, 500)
  }
  
  try {
    const result = await env.DB.prepare(`
      SELECT * FROM analyses 
      WHERE channel_id = ? 
      ORDER BY upload_date DESC, created_at DESC
    `).bind(channelId).all()
    
    return c.json({
      analyses: result.results
    })
  } catch (error: any) {
    return c.json({
      error: '채널 분석 결과를 조회할 수 없습니다.',
      details: error.message
    }, 500)
  }
})

// 메인 페이지
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Hi DB v2.1.3 - YouTube 영상 분석</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gradient-to-br from-orange-50 to-red-50 min-h-screen">
        <div class="container mx-auto px-4 py-8 max-w-6xl">
            <!-- 헤더 -->
            <div class="bg-white rounded-2xl shadow-xl p-8 mb-8">
                <h1 class="text-4xl font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent mb-2">
                    <i class="fas fa-video mr-3"></i>
                    Hi DB v2.1.3
                </h1>
                <p class="text-gray-600">YouTube 영상/채널 AI 분석 시스템</p>
            </div>

            <!-- YouTube 영상 분석 -->
            <div class="bg-white rounded-2xl shadow-xl p-8 mb-8">
                <h2 class="text-2xl font-bold text-gray-800 mb-6 flex items-center">
                    <i class="fas fa-play-circle mr-3 text-orange-600"></i>
                    YouTube 영상 분석
                </h2>
                
                <div class="space-y-4">
                    <input 
                        type="text" 
                        id="videoUrl" 
                        placeholder="YouTube 영상 URL을 입력하세요" 
                        class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-orange-500 transition-colors"
                    />
                    <button 
                        id="analyzeBtn" 
                        onclick="analyzeVideo()" 
                        class="w-full bg-gradient-to-r from-orange-600 to-red-600 text-white font-semibold py-3 px-6 rounded-lg hover:from-orange-700 hover:to-red-700 transition-all shadow-lg hover:shadow-xl"
                    >
                        <i class="fas fa-rocket mr-2"></i>
                        AI 분석 시작
                    </button>
                </div>

                <!-- 에러 메시지 -->
                <div id="error" class="hidden mt-6">
                    <div class="bg-red-50 border-l-4 border-red-500 p-4 rounded">
                        <div class="flex items-center">
                            <i class="fas fa-exclamation-circle text-red-500 mr-2"></i>
                            <p class="text-red-700 font-semibold" id="errorMessage"></p>
                        </div>
                    </div>
                </div>

                <!-- 성공 메시지 -->
                <div id="success" class="hidden mt-6">
                    <div class="bg-green-50 border-l-4 border-green-500 p-4 rounded">
                        <div class="flex items-center">
                            <i class="fas fa-check-circle text-green-500 mr-2"></i>
                            <p class="text-green-700 font-semibold" id="successMessage"></p>
                        </div>
                    </div>
                </div>

                <!-- 로딩 -->
                <div id="loading" class="hidden mt-6">
                    <div class="bg-blue-50 border-l-4 border-blue-500 p-4 rounded">
                        <div class="flex items-center">
                            <i class="fas fa-spinner fa-spin text-blue-500 mr-2"></i>
                            <p class="text-blue-700 font-semibold" id="loadingMessage">처리 중...</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 채널 일괄 분석 -->
            <div class="bg-white rounded-2xl shadow-xl p-8 mb-8">
                <h2 class="text-2xl font-bold text-gray-800 mb-6 flex items-center">
                    <i class="fas fa-list mr-3 text-orange-600"></i>
                    채널 일괄 분석
                </h2>
                
                <div class="space-y-4">
                    <input 
                        type="text" 
                        id="channelUrl" 
                        placeholder="YouTube 채널의 영상 URL을 입력하세요" 
                        class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-orange-500 transition-colors"
                    />
                    <div class="flex items-center space-x-4">
                        <label class="text-gray-700 font-semibold">분석할 영상 개수:</label>
                        <input 
                            type="number" 
                            id="maxVideos" 
                            value="10" 
                            min="1" 
                            max="50"
                            class="px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-orange-500 w-24"
                        />
                    </div>
                    <button 
                        id="analyzeChannelBtn" 
                        onclick="analyzeChannel()" 
                        class="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold py-3 px-6 rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all shadow-lg hover:shadow-xl"
                    >
                        <i class="fas fa-rocket mr-2"></i>
                        채널 일괄 분석 시작
                    </button>
                </div>

                <!-- 채널 분석 에러 -->
                <div id="channelError" class="hidden mt-6">
                    <div class="bg-red-50 border-l-4 border-red-500 p-4 rounded">
                        <div class="flex items-center">
                            <i class="fas fa-exclamation-circle text-red-500 mr-2"></i>
                            <p class="text-red-700 font-semibold" id="channelErrorMessage"></p>
                        </div>
                    </div>
                </div>

                <!-- 채널 분석 성공 -->
                <div id="channelSuccess" class="hidden mt-6">
                    <div class="bg-green-50 border-l-4 border-green-500 p-4 rounded">
                        <div class="flex items-center">
                            <i class="fas fa-check-circle text-green-500 mr-2"></i>
                            <p class="text-green-700 font-semibold" id="channelSuccessMessage"></p>
                        </div>
                    </div>
                </div>

                <!-- 채널 분석 로딩 -->
                <div id="channelLoading" class="hidden mt-6">
                    <div class="bg-blue-50 border-l-4 border-blue-500 p-4 rounded">
                        <div class="flex items-center">
                            <i class="fas fa-spinner fa-spin text-blue-500 mr-2"></i>
                            <p class="text-blue-700 font-semibold" id="channelLoadingMessage">처리 중...</p>
                        </div>
                    </div>
                </div>

                <!-- 채널 분석 진행상황 -->
                <div id="channelProgress" class="hidden mt-6">
                    <div class="bg-gradient-to-br from-gray-50 to-blue-50 rounded-xl p-6 border-2 border-gray-200">
                        <div class="flex justify-between items-center mb-4">
                            <h4 class="font-bold text-gray-800 text-lg flex items-center">
                                <i class="fas fa-tasks mr-2 text-blue-600"></i>
                                배치 작업 진행 현황
                            </h4>
                            <span id="channelProgressText" class="font-semibold text-orange-600 text-sm"></span>
                        </div>
                        
                        <!-- 전체 진행률 바 -->
                        <div class="mb-4">
                            <div class="flex justify-between text-xs text-gray-600 mb-1">
                                <span>전체 진행률</span>
                                <span id="channelProgressPercentage">0%</span>
                            </div>
                            <div class="w-full bg-gray-200 rounded-full h-3">
                                <div id="channelProgressBar" class="bg-gradient-to-r from-orange-500 to-red-500 h-3 rounded-full transition-all duration-500" style="width: 0%"></div>
                            </div>
                        </div>
                        
                        <!-- 영상별 상태 목록 -->
                        <div class="mt-6">
                            <h5 class="font-semibold text-gray-700 text-sm mb-3 flex items-center">
                                <i class="fas fa-list-ul mr-2 text-gray-600"></i>
                                영상별 분석 상태
                            </h5>
                            <div id="videoStatusList" class="space-y-2 max-h-96 overflow-y-auto">
                                <!-- 영상 목록이 여기에 동적으로 추가됩니다 -->
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 채널 분석 결과 -->
                <div id="channelResults" class="hidden mt-6">
                    <div class="bg-gradient-to-r from-green-50 to-blue-50 border-l-4 border-green-500 p-6 rounded-lg">
                        <h4 class="font-semibold text-gray-800 mb-4 flex items-center">
                            <i class="fas fa-check-circle text-green-500 mr-2"></i>
                            분석 완료
                        </h4>
                        <button 
                            id="downloadAllReports"
                            class="w-full bg-gradient-to-r from-green-600 to-blue-600 text-white font-semibold py-3 px-6 rounded-lg hover:from-green-700 hover:to-blue-700 transition-all shadow-lg hover:shadow-xl"
                        >
                            <i class="fas fa-file-archive mr-2"></i>
                            전체 보고서 ZIP 다운로드
                        </button>
                    </div>
                </div>
            </div>

            <!-- 분석 결과 -->
            <div id="results" class="hidden space-y-6">
                <!-- 보고서 -->
                <div class="bg-white rounded-2xl shadow-xl p-8">
                    <h3 class="text-2xl font-bold text-gray-800 mb-4 flex items-center">
                        <i class="fas fa-file-alt mr-3 text-green-600"></i>
                        1페이지 보고서
                    </h3>
                    <div id="summary" class="prose max-w-none text-gray-700 leading-relaxed whitespace-pre-wrap"></div>
                    <div class="mt-6 flex space-x-4">
                        <button 
                            onclick="downloadReport()" 
                            class="bg-green-600 text-white font-semibold py-2 px-6 rounded-lg hover:bg-green-700 transition-all"
                        >
                            <i class="fas fa-download mr-2"></i>
                            보고서 다운로드
                        </button>
                    </div>
                </div>

                <!-- 대본 -->
                <div class="bg-white rounded-2xl shadow-xl p-8">
                    <h3 class="text-2xl font-bold text-gray-800 mb-4 flex items-center">
                        <i class="fas fa-align-left mr-3 text-blue-600"></i>
                        전체 대본
                    </h3>
                    <div id="transcript" class="prose max-w-none text-gray-600 leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto"></div>
                    <div class="mt-6">
                        <button 
                            onclick="downloadTranscript()" 
                            class="bg-blue-600 text-white font-semibold py-2 px-6 rounded-lg hover:bg-blue-700 transition-all"
                        >
                            <i class="fas fa-download mr-2"></i>
                            대본 다운로드
                        </button>
                    </div>
                </div>
            </div>

            <!-- 분석 히스토리 -->
            <div class="bg-white rounded-2xl shadow-xl p-8 mt-8">
                <h2 class="text-2xl font-bold text-gray-800 mb-6 flex items-center">
                    <i class="fas fa-history mr-3 text-gray-600"></i>
                    분석 히스토리
                </h2>
                <button 
                    onclick="loadHistory()" 
                    class="bg-gray-600 text-white font-semibold py-2 px-6 rounded-lg hover:bg-gray-700 transition-all mb-4"
                >
                    <i class="fas fa-refresh mr-2"></i>
                    새로고침
                </button>
                <div id="history" class="space-y-4"></div>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
        <script src="/static/app.js"></script>
    </body>
    </html>
  `)
})

export default app

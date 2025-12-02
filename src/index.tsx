import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'
import { createSupabaseClient, type Bindings } from './lib/supabase'

// Bindings 타입은 lib/supabase.ts에서 import
// Supabase 마이그레이션으로 DB (D1)는 선택적, SUPABASE_URL과 SUPABASE_SECRET_KEY 추가됨

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

// ==================== Google Drive 업로드 ====================

// JWT 생성 (Google Service Account 인증용)
async function createJWT(serviceAccountEmail: string, privateKey: string): Promise<string> {
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  }
  
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: serviceAccountEmail,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }
  
  const base64Header = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const base64Payload = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const unsignedToken = `${base64Header}.${base64Payload}`
  
  // Private Key를 PEM에서 추출
  // Step 1: 따옴표 제거
  let cleanKey = privateKey.replace(/^["']|["']$/g, '').trim()
  
  // Step 2: BEGIN/END 구문 제거
  cleanKey = cleanKey
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .trim()
  
  // Step 3: 모든 형태의 개행/공백 제거
  cleanKey = cleanKey.replace(/\\n/g, '\n').replace(/\\r/g, '\r')
  cleanKey = cleanKey.replace(/\n/g, '').replace(/\r/g, '').replace(/\s/g, '').replace(/\t/g, '')
  
  // Step 4: 기존 패딩 제거 후 다시 추가 (올바른 패딩 계산)
  cleanKey = cleanKey.replace(/=+$/, '')
  const remainder = cleanKey.length % 4
  if (remainder > 0) {
    cleanKey += '='.repeat(4 - remainder)
  }
  
  const pemKey = cleanKey
  
  // Base64 디코딩 (네이티브 atob 사용)
  let binaryKey: Uint8Array
  try {
    const binaryString = atob(pemKey)
    binaryKey = Uint8Array.from(binaryString, c => c.charCodeAt(0))
  } catch (e) {
    throw new Error('Private Key Base64 디코딩 실패')
  }
  
  // PKCS#8 형식에서 실제 키 추출
  const key = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  )
  
  // 서명 생성
  const encoder = new TextEncoder()
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(unsignedToken)
  )
  
  // Base64 URL 인코딩 (네이티브 btoa 사용)
  const base64Signature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  
  return `${unsignedToken}.${base64Signature}`
}

// Access Token 발급
async function getAccessToken(serviceAccountEmail: string, privateKey: string): Promise<string | null> {
  try {
    const jwt = await createJWT(serviceAccountEmail, privateKey)
    
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    })
    
    if (!response.ok) {
      return null
    }
    
    const data = await response.json()
    
    if (data.access_token) {
      return data.access_token
    }
    
    return null
  } catch (error) {
    console.error('Access Token 발급 오류:', error)
    return null
  }
}

// Google Drive에 파일 업로드
async function uploadToGoogleDrive(
  accessToken: string,
  fileName: string,
  content: string,
  mimeType: string,
  folderId?: string
): Promise<{ id: string, webViewLink: string } | null> {
  try {
    const metadata = {
      name: fileName,
      mimeType: mimeType,
      ...(folderId && { parents: [folderId] })
    }
    
    const boundary = '-------314159265358979323846'
    const delimiter = `\r\n--${boundary}\r\n`
    const closeDelimiter = `\r\n--${boundary}--`
    
    const multipartRequestBody =
      delimiter +
      'Content-Type: application/json\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      `Content-Type: ${mimeType}\r\n\r\n` +
      content +
      closeDelimiter
    
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: multipartRequestBody
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error('Drive 업로드 실패:', response.status, errorText)
      return null
    }
    
    const data = await response.json()
    return {
      id: data.id,
      webViewLink: data.webViewLink
    }
  } catch (error) {
    console.error('Drive 업로드 오류:', error)
    return null
  }
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
    // 먼저 채널의 업로드 재생목록 ID 가져오기 (UU + channelId[2:])
    const uploadsPlaylistId = 'UU' + channelId.substring(2)
    
    let url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=${Math.min(maxResults, 50)}&key=${apiKey}`
    
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
      videoId: item.snippet.resourceId.videoId,
      title: item.snippet.title,
      url: `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`,
      publishedAt: item.snippet.publishedAt
    }))
    
    // 디버깅: nextPageToken 상태 로깅
    if (data.nextPageToken) {
      console.log(`🔄 다음 페이지 토큰 있음 (pageInfo: total=${data.pageInfo?.totalResults || 'unknown'})`)
    } else {
      console.log(`⛔ 다음 페이지 토큰 없음 (items: ${videos.length}개)`)
    }
    
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
    let pageCount = 0
    const maxPages = Math.ceil(targetCount / 50) + 10 // 목표 개수 + 여유분 (Shorts/중복 고려)
    
    console.log(`📺 채널 영상 가져오기 시작 (목표: ${targetCount}개, 최대 ${maxPages}페이지, Shorts 제외)`)
    
    while (allVideos.length < targetCount && pageCount < maxPages) {
      pageCount++
      
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
      
      console.log(`📄 ${pageCount}페이지: ${videos.length}개 영상 가져옴 (누적: ${allVideos.length}개)`)
      
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
      if (pageCount >= maxPages) {
        console.log(`   - 최대 페이지 제한 도달 (${maxPages}페이지)`)
      } else {
        console.log(`   - 채널에 더 이상 새로운 영상이 없거나`)
        console.log(`   - 대부분의 영상이 이미 분석되었거나`)
        console.log(`   - Shorts 영상이 많아 필터링됨`)
      }
    }
    
    console.log(`📊 최종 결과: ${allVideos.length}개 영상 (목표: ${targetCount}개, ${pageCount}페이지 검색, Shorts 제외)`)
    
    return allVideos
    
  } catch (error) {
    console.error('채널 영상 목록 가져오기 오류:', error)
    return null
  }
}

// Gemini API를 통한 대본 추출 (재시도 로직 포함)
async function extractTranscriptWithGemini(videoUrl: string, apiKey: string, maxRetries: number = 10): Promise<{ transcript: string, title?: string, uploadDate?: string } | null> {
  let attempt = 0
  
  while (attempt < maxRetries) {
    attempt++
    
    try {
      console.log(`🔵 Gemini API 호출 시작 (시도 ${attempt}/${maxRetries}): ${videoUrl}`)
      const startTime = Date.now()
      
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
      
      console.log('📤 Gemini API 요청 전송 중...')
      
      // 10분 타임아웃 설정
      const controller = new AbortController()
      const timeoutId = setTimeout(() => {
        console.log('⏰ Gemini API 타임아웃 (10분 초과)')
        controller.abort()
      }, 10 * 60 * 1000) // 10분
      
      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        })
        
        clearTimeout(timeoutId)
        console.log(`📥 Gemini API 응답 수신: ${response.status}`)
        
        const data = await response.json()
        
        const elapsed = Math.round((Date.now() - startTime) / 1000)
        console.log(`⏱️  Gemini API 소요 시간: ${elapsed}초`)
        
        // 503 과부하 에러 또는 429 Rate Limit 에러 - 재시도
        if (response.status === 503 || response.status === 429) {
          const waitTime = attempt * 30 // 30초, 60초, 90초...
          console.log(`⚠️ Gemini API 과부하/Rate Limit (${response.status}). ${waitTime}초 후 재시도 (${attempt}/${maxRetries})`)
          
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
        
        if (data.candidates && data.candidates[0]?.content?.parts) {
          const transcript = data.candidates[0].content.parts[0].text
          console.log(`✅ 대본 추출 성공: ${transcript.length}자 (${elapsed}초, 시도 ${attempt}회)`)
          return { transcript }
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
            throw new Error('Gemini API 타임아웃: 10분 이내에 응답받지 못했습니다.')
          }
        }
        
        console.error('❌ Gemini API fetch 오류:', fetchError.message)
        throw fetchError
      }
    } catch (error) {
      console.error(`❌ Gemini 대본 추출 실패 (시도 ${attempt}/${maxRetries}):`, error)
      
      if (attempt >= maxRetries) {
        return null
      }
      
      // 일반 에러도 재시도
      const waitTime = attempt * 30
      console.log(`⏳ ${waitTime}초 후 재시도...`)
      await new Promise(resolve => setTimeout(resolve, waitTime * 1000))
    }
  }
  
  console.error(`❌ 최대 재시도 횟수 ${maxRetries}회 도달. 완전 포기`)
  return null
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

// Gemini API를 통한 요약 보고서 생성 (재시도 로직 포함)
async function generateSummaryWithGemini(transcript: string, apiKey: string, videoTitle?: string, maxRetries: number = 10): Promise<string | null> {
  let attempt = 0
  
  while (attempt < maxRetries) {
    attempt++
    
    try {
      console.log(`📊 Gemini 요약 생성 시작 (시도 ${attempt}/${maxRetries})`)
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
      
      // 503 과부하 에러 또는 429 Rate Limit 에러 - 재시도
      if (response.status === 503 || response.status === 429) {
        const waitTime = attempt * 30
        console.log(`⚠️ Gemini API 과부하/Rate Limit (${response.status}). ${waitTime}초 후 재시도 (${attempt}/${maxRetries})`)
        
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, waitTime * 1000))
          continue // 재시도
        } else {
          console.error(`❌ 최대 재시도 횟수 ${maxRetries}회 도달. 포기`)
          return null
        }
      }
      
      if (data.error) {
        console.error('❌ Gemini 요약 생성 에러:', data.error.message)
        
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
      
      if (data.candidates && data.candidates[0]?.content?.parts) {
        const summary = data.candidates[0].content.parts[0].text
        console.log(`✅ 요약 생성 성공 (${summary.length}자, 시도 ${attempt}회)`)
        return summary
      }
      
      console.log('⚠️ Gemini API 응답에 요약 없음')
      return null
    } catch (error) {
      console.error(`❌ Gemini 요약 생성 실패 (시도 ${attempt}/${maxRetries}):`, error)
      
      if (attempt >= maxRetries) {
        return null
      }
      
      // 일반 에러도 재시도
      const waitTime = attempt * 30
      console.log(`⏳ ${waitTime}초 후 재시도...`)
      await new Promise(resolve => setTimeout(resolve, waitTime * 1000))
    }
  }
  
  console.error(`❌ 최대 재시도 횟수 ${maxRetries}회 도달. 완전 포기`)
  return null
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
      SET status = 'processing', started_at = CURRENT_TIMESTAMP, current_step = '대본 추출 중...'
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
    
    // 분석 결과를 analyses 테이블에 저장 (transcript_only 상태, source='batch')
    const insertResult = await db.prepare(`
      INSERT INTO analyses (video_id, url, transcript, title, upload_date, channel_id, channel_name, status, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'transcript_only', 'batch', CURRENT_TIMESTAMP)
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
    await db.prepare(`
      UPDATE batch_videos 
      SET current_step = 'Rate Limit 방지 대기 중... (65초)'
      WHERE id = ?
    `).bind(batchVideoId).run()
    
    await new Promise(resolve => setTimeout(resolve, 65000))
    
    // 2단계: 보고서 생성
    console.log('📊 2단계 시작: AI 요약 보고서 생성')
    await db.prepare(`
      UPDATE batch_videos 
      SET current_step = 'AI 보고서 생성 중...'
      WHERE id = ?
    `).bind(batchVideoId).run()
    
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
      SET status = 'completed', finished_at = CURRENT_TIMESTAMP, current_step = '완료'
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
    const supabase = createSupabaseClient(env)
    
    // 이미 분석된 영상인지 확인
    const { data: existing } = await supabase
      .from('analyses')
      .select('id, status')
      .eq('video_id', videoId)
      .single()
    
    if (existing) {
      return c.json({
        error: '이미 분석된 영상입니다.',
        analysisId: existing.id,
        status: existing.status
      }, 400)
    }
    
    // YouTube 자막을 먼저 시도 (빠르고 안정적)
    console.log('📝 1단계: 대본 추출 시작 (YouTube 자막 우선)')
    let transcript: string | null = await extractTranscriptFromYouTube(videoId)
    let title: string | undefined
    let uploadDate: string | undefined
    
    if (transcript) {
      console.log(`✅ YouTube 자막으로 대본 추출 성공: ${transcript.length}자`)
    } else {
      // YouTube 자막이 없으면 Gemini API 사용
      console.log('⚠️ YouTube 자막 없음, Gemini API 시도...')
      const transcriptResult = await extractTranscriptWithGemini(videoUrl, env.GEMINI_API_KEY)
      
      if (!transcriptResult) {
        return c.json({
          error: '대본 추출 실패',
          details: 'YouTube 자막 없음\nGemini API도 실패 (과부하 또는 타임아웃)\n\n해결 방법:\n1. 자막이 있는 영상을 선택하거나\n2. 잠시 후 다시 시도해주세요 (Gemini API 과부하)\n3. 짧은 영상(10분 이하)을 먼저 시도해보세요'
        }, 500)
      }
      transcript = transcriptResult.transcript
      title = transcriptResult.title
      uploadDate = transcriptResult.uploadDate
      console.log(`✅ Gemini API로 대본 추출 성공: ${transcript.length}자`)
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
    
    // Supabase에 저장 (transcript_only 상태, source='single')
    const { data: newAnalysis, error: insertError } = await supabase
      .from('analyses')
      .insert({
        video_id: videoId,
        url: videoUrl,
        transcript,
        title: title || null,
        channel_id: channelId || null,
        channel_name: channelName || null,
        status: 'transcript_only',
        source: 'single'
      })
      .select()
      .single()
    
    if (insertError) throw insertError
    
    const analysisId = newAnalysis.id
    
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
    const supabase = createSupabaseClient(env)
    let targetTranscript: string
    let videoTitle: string | undefined
    let targetAnalysisId: number
    
    if (analysisId) {
      // Supabase에서 대본 가져오기
      const { data: analysis, error } = await supabase
        .from('analyses')
        .select('transcript, title')
        .eq('id', analysisId)
        .single()
      
      if (error || !analysis) {
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
    
    // Supabase 업데이트 (analysisId가 있는 경우에만)
    if (targetAnalysisId > 0) {
      const { error: updateError } = await supabase
        .from('analyses')
        .update({ summary, status: 'completed' })
        .eq('id', targetAnalysisId)
      
      if (updateError) throw updateError
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
    const supabase = createSupabaseClient(env)
    
    // 채널 정보 추출
    const channelInfo = await getChannelFromVideoUrl(videoUrl, env.YOUTUBE_API_KEY)
    if (!channelInfo) {
      return c.json({ error: '채널 정보를 가져올 수 없습니다.' }, 400)
    }
    
    const { channelId, channelName } = channelInfo
    
    // 채널 영상 목록 가져오기 (중복 제거 - Supabase 사용)
    const newVideos = await getChannelVideosWithDuplicateRemovalSupabase(
      channelId, 
      env.YOUTUBE_API_KEY, 
      maxVideos,
      supabase
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
    
    // batch_jobs 생성
    const { data: batchJob, error: batchError } = await supabase
      .from('batch_jobs')
      .insert({
        channel_id: channelId,
        channel_name: channelName,
        total_videos: newVideos.length,
        completed_videos: 0,
        failed_videos: 0,
        status: 'processing'
      })
      .select()
      .single()
    
    if (batchError) throw batchError
    
    const batchId = batchJob.id
    
    // batch_videos 생성 (bulk insert)
    const batchVideos = newVideos.map(video => ({
      batch_id: batchId,
      video_id: video.videoId,
      title: video.title,
      url: video.url,
      status: 'pending'
    }))
    
    const { error: videosError } = await supabase
      .from('batch_videos')
      .insert(batchVideos)
    
    if (videosError) throw videosError
    
    console.log(`✅ 배치 작업 생성 완료: ${newVideos.length}개 영상`)
    console.log(`📋 첫 번째 영상 데이터:`, JSON.stringify(newVideos[0]))
    
    // 백그라운드에서 자동 처리 시작 (비동기, 응답을 기다리지 않음)
    // TODO: Supabase 버전으로 변환 필요 - 현재는 수동 처리 API 사용
    // c.executionCtx.waitUntil(...)
    
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
    const supabase = createSupabaseClient(env)
    
    // 다음 pending 영상 가져오기
    const { data: nextVideo, error: nextError } = await supabase
      .from('batch_videos')
      .select('*')
      .eq('batch_id', batchId)
      .eq('status', 'pending')
      .order('id', { ascending: true })
      .limit(1)
      .single()
    
    if (nextError || !nextVideo) {
      // 모든 영상 처리 완료
      const { error: updateError } = await supabase
        .from('batch_jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', batchId)
      
      if (updateError) throw updateError
      
      return c.json({
        success: true,
        completed: true,
        message: '모든 영상 분석이 완료되었습니다.'
      })
    }
    
    // 배치에서 채널 정보 가져오기
    const { data: batch } = await supabase
      .from('batch_jobs')
      .select('channel_id, channel_name')
      .eq('id', batchId)
      .single()
    
    // 영상 자동 분석 실행 (1단계 + 2단계)
    const result = await processVideoAnalysisSupabase(
      supabase,
      nextVideo.id as number,
      nextVideo.url as string,
      nextVideo.video_id as string,
      nextVideo.title as string,
      batch?.channel_id as string | null,
      batch?.channel_name as string | null,
      null,
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
    const supabase = createSupabaseClient(env)
    
    const { data: batch, error: batchError } = await supabase
      .from('batch_jobs')
      .select('*')
      .eq('id', batchId)
      .single()
    
    if (batchError || !batch) {
      return c.json({ error: '배치를 찾을 수 없습니다.' }, 404)
    }
    
    const { data: videos, error: videosError } = await supabase
      .from('batch_videos')
      .select('*')
      .eq('batch_id', batchId)
      .order('id', { ascending: true })
    
    if (videosError) throw videosError
    
    const completed = batch.completed_videos as number
    const failed = batch.failed_videos as number
    const total = batch.total_videos as number
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0
    
    return c.json({
      batch,
      progress: {
        total,
        completed,
        failed,
        percentage
      },
      videos
    })
    
  } catch (error: any) {
    console.error('진행 상황 조회 오류:', error)
    return c.json({
      error: '진행 상황을 조회할 수 없습니다.',
      details: error.message
    }, 500)
  }
})

// 완료된 분석 파일 일괄 다운로드 (텍스트 형식)
app.get('/api/export/all-analyses', async (c) => {
  const { env } = c
  
  if (!env.DB) {
    return c.json({ error: '데이터베이스가 설정되지 않았습니다.' }, 500)
  }
  
  try {
    const result = await env.DB.prepare(`
      SELECT 
        id,
        title,
        video_id,
        upload_date,
        transcript,
        summary,
        created_at
      FROM analyses 
      WHERE status = 'completed' 
        AND summary IS NOT NULL 
        AND summary != ''
      ORDER BY created_at DESC
      LIMIT 3000
    `).all()
    
    if (!result.results || result.results.length === 0) {
      return c.text('완료된 분석이 없습니다', 404)
    }
    
    // 모든 분석을 하나의 텍스트 파일로 결합
    let output = '='.repeat(80) + '\n'
    output += '완료된 분석 파일 모음 (' + result.results.length + '개)\n'
    output += '생성일: ' + new Date().toISOString() + '\n'
    output += '='.repeat(80) + '\n\n'
    
    for (const analysis of result.results) {
      const uploadDate = analysis.upload_date?.replace(/-/g, '') || ''
      const videoId = analysis.video_id || ''
      const title = analysis.title || 'Untitled'
      
      output += '\n' + '='.repeat(80) + '\n'
      output += `ID: ${analysis.id} | ${uploadDate} | ${title}\n`
      output += `비디오 ID: ${videoId} | https://youtube.com/watch?v=${videoId}\n`
      output += '='.repeat(80) + '\n\n'
      
      output += '【요약보고서】\n\n'
      output += analysis.summary + '\n\n'
      
      output += '-'.repeat(80) + '\n\n'
      output += '【대본전문】\n\n'
      output += analysis.transcript + '\n\n'
    }
    
    // 다운로드 히스토리 기록
    try {
      const fileSizeBytes = new TextEncoder().encode(output).length
      const userAgent = c.req.header('user-agent') || 'Unknown'
      const ipAddress = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'Unknown'
      
      await env.DB.prepare(`
        INSERT INTO export_history (export_type, file_format, total_analyses, file_size_bytes, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind('all', 'txt', result.results.length, fileSizeBytes, ipAddress, userAgent).run()
    } catch (historyError) {
      console.error('다운로드 히스토리 기록 실패:', historyError)
      // 히스토리 기록 실패해도 다운로드는 계속 진행
    }
    
    return new Response(output, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="completed_analyses_${result.results.length}files_${new Date().toISOString().split('T')[0]}.txt"`
      }
    })
  } catch (error) {
    console.error('Export error:', error)
    return c.json({ error: '내보내기 실패: ' + error.message }, 500)
  }
})

// 다운로드 통계 조회
app.get('/api/export/stats', async (c) => {
  const { env } = c
  
  if (!env.DB) {
    return c.json({ error: '데이터베이스가 설정되지 않았습니다.' }, 500)
  }
  
  try {
    // 총 다운로드 횟수
    const totalResult = await env.DB.prepare(`
      SELECT COUNT(*) as total FROM export_history
    `).first()
    
    // 오늘 다운로드 횟수
    const todayResult = await env.DB.prepare(`
      SELECT COUNT(*) as today FROM export_history
      WHERE DATE(exported_at) = DATE('now')
    `).first()
    
    // 최근 다운로드 목록
    const recentResult = await env.DB.prepare(`
      SELECT * FROM export_history
      ORDER BY exported_at DESC
      LIMIT 10
    `).all()
    
    return c.json({
      success: true,
      stats: {
        total: totalResult?.total || 0,
        today: todayResult?.today || 0,
        recent: recentResult.results || []
      }
    })
  } catch (error) {
    console.error('다운로드 통계 조회 실패:', error)
    return c.json({ error: '통계 조회 실패: ' + error.message }, 500)
  }
})

// 분석 히스토리 조회
app.get('/api/history', async (c) => {
  const { env } = c
  const supabase = createSupabaseClient(env)
  
  try {
    // 전체 데이터 조회 (LIMIT 1000)
    const { data: analyses, error: fetchError } = await supabase
      .from('analyses')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000)
    
    if (fetchError) {
      return c.json({
        error: '히스토리를 조회할 수 없습니다.',
        details: fetchError.message
      }, 500)
    }
    
    // 통계 계산 (메모리에서 처리)
    const total = analyses?.length || 0
    const completed_count = analyses?.filter(a => a.status === 'completed').length || 0
    const failed_count = analyses?.filter(a => a.status === 'failed').length || 0
    const transcript_only_count = analyses?.filter(a => a.status === 'transcript_only').length || 0
    
    return c.json({
      stats: {
        total,
        single_count: 0, // source 컬럼 없음 (향후 추가 가능)
        batch_count: 0,  // source 컬럼 없음 (향후 추가 가능)
        completed_count,
        failed_count,
        transcript_only_count
      },
      single: [], // source 컬럼 없음
      batch: [],  // source 컬럼 없음
      analyses: analyses || []
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
  const supabase = createSupabaseClient(env)
  
  try {
    const { data: analysis, error } = await supabase
      .from('analyses')
      .select('*')
      .eq('id', id)
      .single()
    
    if (error || !analysis) {
      return c.json({ error: '분석 결과를 찾을 수 없습니다.' }, 404)
    }
    
    return c.json(analysis)
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

            <!-- 분석 히스토리 (폴더형 구조) -->
            <div class="bg-white rounded-2xl shadow-xl p-8 mt-8">
                <h2 class="text-2xl font-bold text-gray-800 mb-6 flex items-center">
                    <i class="fas fa-history mr-3 text-gray-600"></i>
                    분석 히스토리
                </h2>
                
                <!-- 통계 표시 -->
                <div id="historyStats" class="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
                    <div class="bg-blue-50 rounded-lg p-4 text-center">
                        <div class="text-2xl font-bold text-blue-600" id="statTotal">0</div>
                        <div class="text-sm text-gray-600">전체</div>
                    </div>
                    <div class="bg-green-50 rounded-lg p-4 text-center">
                        <div class="text-2xl font-bold text-green-600" id="statCompleted">0</div>
                        <div class="text-sm text-gray-600">완료</div>
                    </div>
                    <div class="bg-purple-50 rounded-lg p-4 text-center">
                        <div class="text-2xl font-bold text-purple-600" id="statSingle">0</div>
                        <div class="text-sm text-gray-600">단일</div>
                    </div>
                    <div class="bg-orange-50 rounded-lg p-4 text-center">
                        <div class="text-2xl font-bold text-orange-600" id="statBatch">0</div>
                        <div class="text-sm text-gray-600">배치</div>
                    </div>
                    <div class="bg-yellow-50 rounded-lg p-4 text-center">
                        <div class="text-2xl font-bold text-yellow-600" id="statTranscript">0</div>
                        <div class="text-sm text-gray-600">대본만</div>
                    </div>
                    <div class="bg-red-50 rounded-lg p-4 text-center">
                        <div class="text-2xl font-bold text-red-600" id="statFailed">0</div>
                        <div class="text-sm text-gray-600">실패</div>
                    </div>
                </div>
                
                <div class="flex space-x-4 mb-4">
                    <button 
                        onclick="loadHistory()" 
                        class="bg-gray-600 text-white font-semibold py-2 px-6 rounded-lg hover:bg-gray-700 transition-all"
                    >
                        <i class="fas fa-refresh mr-2"></i>
                        새로고침
                    </button>
                    <button 
                        onclick="exportAllAnalyses()" 
                        class="bg-gradient-to-r from-green-500 to-emerald-600 text-white font-semibold py-2 px-6 rounded-lg hover:from-green-600 hover:to-emerald-700 transition-all shadow-lg hover:shadow-xl"
                    >
                        <i class="fas fa-download mr-2"></i>
                        완료된 분석 전체 다운로드 (TXT, 최대 3000개)
                    </button>
                </div>
                
                <!-- 폴더 구조 -->
                <div class="space-y-6">
                    <!-- 단일 영상 분석 폴더 -->
                    <div class="border-2 border-gray-200 rounded-lg">
                        <button 
                            onclick="toggleFolder('singleAnalysis')" 
                            class="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                        >
                            <div class="flex items-center">
                                <i id="singleAnalysisIcon" class="fas fa-folder text-blue-500 mr-3 text-xl"></i>
                                <div class="text-left">
                                    <h3 class="font-bold text-gray-800">단일 영상 분석</h3>
                                    <p class="text-sm text-gray-500">프론트엔드에서 시작한 분석 (개별 영상)</p>
                                </div>
                            </div>
                            <div class="flex items-center space-x-4">
                                <span id="singleAnalysisCount" class="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-semibold">0</span>
                                <i class="fas fa-chevron-down text-gray-400"></i>
                            </div>
                        </button>
                        <div id="singleAnalysisContent" class="hidden border-t-2 border-gray-200 p-4 bg-gray-50">
                            <div id="singleAnalysisList" class="space-y-3"></div>
                        </div>
                    </div>
                    
                    <!-- 채널 일괄 분석 폴더 -->
                    <div class="border-2 border-gray-200 rounded-lg">
                        <button 
                            onclick="toggleFolder('batchAnalysis')" 
                            class="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                        >
                            <div class="flex items-center">
                                <i id="batchAnalysisIcon" class="fas fa-folder text-green-500 mr-3 text-xl"></i>
                                <div class="text-left">
                                    <h3 class="font-bold text-gray-800">채널 일괄 분석</h3>
                                    <p class="text-sm text-gray-500">백엔드에서 자동 처리된 분석 (배치 작업)</p>
                                </div>
                            </div>
                            <div class="flex items-center space-x-4">
                                <span id="batchAnalysisCount" class="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-semibold">0</span>
                                <i class="fas fa-chevron-down text-gray-400"></i>
                            </div>
                        </button>
                        <div id="batchAnalysisContent" class="hidden border-t-2 border-gray-200 p-4 bg-gray-50">
                            <div id="batchAnalysisList" class="space-y-3"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
        <script src="/static/app.js"></script>
    </body>
    </html>
  `)
})

// Favicon 라우트 (404 대신 204 No Content 반환)
app.get('/favicon.ico', (c) => {
  return c.body(null, 204)
})

// ==================== 이메일 전송 API ====================

// 단일 분석 결과 이메일 전송
app.post('/api/send-email/single/:id', async (c) => {
  const { env } = c
  const id = parseInt(c.req.param('id'))
  const { email } = await c.req.json()
  
  if (!email) {
    return c.json({ error: '이메일 주소가 필요합니다.' }, 400)
  }
  
  if (!env.DB) {
    return c.json({ error: '데이터베이스가 설정되지 않았습니다.' }, 500)
  }
  
  try {
    // 분석 결과 조회
    const result = await env.DB.prepare(`
      SELECT * FROM analyses WHERE id = ?
    `).bind(id).first()
    
    if (!result) {
      return c.json({ error: '분석 결과를 찾을 수 없습니다.' }, 404)
    }
    
    // TODO: 실제 이메일 전송 로직 (SendGrid, Resend 등)
    // 현재는 시뮬레이션
    console.log(`📧 이메일 전송 시뮬레이션: ${email}`)
    console.log(`  - 분석 ID: ${id}`)
    console.log(`  - 영상 ID: ${result.video_id}`)
    console.log(`  - 대본 길이: ${result.transcript?.length || 0}`)
    console.log(`  - 요약 길이: ${result.summary?.length || 0}`)
    
    return c.json({
      success: true,
      message: `${email}로 전송 완료 (시뮬레이션)`,
      analysisId: id,
      email: email
    })
  } catch (error: any) {
    console.error('❌ 이메일 전송 실패:', error)
    return c.json({
      error: '이메일 전송 실패',
      details: error.message
    }, 500)
  }
})

// 일괄 분석 결과 이메일 전송 (배치 단위)
app.post('/api/send-email/batch/:batchId', async (c) => {
  const { env } = c
  const batchId = parseInt(c.req.param('batchId'))
  const { email } = await c.req.json()
  
  if (!email) {
    return c.json({ error: '이메일 주소가 필요합니다.' }, 400)
  }
  
  if (!env.DB) {
    return c.json({ error: '데이터베이스가 설정되지 않았습니다.' }, 500)
  }
  
  try {
    // 배치 정보 조회
    const batch = await env.DB.prepare(`
      SELECT * FROM batch_jobs WHERE id = ?
    `).bind(batchId).first()
    
    if (!batch) {
      return c.json({ error: '배치를 찾을 수 없습니다.' }, 404)
    }
    
    // 완료된 영상들 조회
    const videosResult = await env.DB.prepare(`
      SELECT bv.*, a.transcript, a.summary
      FROM batch_videos bv
      LEFT JOIN analyses a ON bv.analysis_id = a.id
      WHERE bv.batch_id = ? AND bv.status = 'completed'
    `).bind(batchId).all()
    
    const completedVideos = videosResult.results || []
    
    // TODO: 실제 이메일 전송 로직
    console.log(`📧 배치 이메일 전송 시뮬레이션: ${email}`)
    console.log(`  - 배치 ID: ${batchId}`)
    console.log(`  - 채널: ${batch.channel_name}`)
    console.log(`  - 완료된 영상: ${completedVideos.length}개`)
    
    return c.json({
      success: true,
      message: `${email}로 ${completedVideos.length}개 영상 분석 결과 전송 완료 (시뮬레이션)`,
      batchId: batchId,
      completedCount: completedVideos.length,
      email: email
    })
  } catch (error: any) {
    console.error('❌ 배치 이메일 전송 실패:', error)
    return c.json({
      error: '이메일 전송 실패',
      details: error.message
    }, 500)
  }
})

// ==================== 구글드라이브 전송 API ====================

// 단일 분석 결과 구글드라이브 전송
app.post('/api/send-drive/single/:id', async (c) => {
  const { env } = c
  const id = parseInt(c.req.param('id'))
  
  // Body가 있으면 파싱, 없으면 빈 객체
  let body: any = {}
  try {
    const text = await c.req.text()
    if (text) {
      body = JSON.parse(text)
    }
  } catch (e) {
    // Body가 없거나 빈 경우 무시
  }
  const driveFolder = body.driveFolder
  
  if (!env.DB) {
    return c.json({ error: '데이터베이스가 설정되지 않았습니다.' }, 500)
  }
  
  // Google Drive 환경 변수 확인
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    return c.json({ 
      error: 'Google Drive 설정이 필요합니다.',
      details: 'GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY를 설정해주세요. GOOGLE_DRIVE_SETUP.md 참고'
    }, 500)
  }
  
  try {
    // 분석 결과 조회
    const result = await env.DB.prepare(`
      SELECT * FROM analyses WHERE id = ?
    `).bind(id).first()
    
    if (!result) {
      return c.json({ error: '분석 결과를 찾을 수 없습니다.' }, 404)
    }
    
    // Google Drive 업로드 시작
    
    // Access Token 발급
    const accessToken = await getAccessToken(
      env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      env.GOOGLE_PRIVATE_KEY
    )
    
    if (!accessToken) {
      return c.json({ 
        error: 'Google Drive 인증 실패',
        details: 'Access Token을 발급받을 수 없습니다. Service Account 설정을 확인해주세요.'
      }, 500)
    }
    
    console.log(`✅ Access Token 발급 완료`)
    
    // 파일 내용 생성
    const title = (result.title as string) || result.video_id as string
    const videoId = result.video_id as string
    const transcript = (result.transcript as string) || ''
    const summary = (result.summary as string) || ''
    
    let fileContent = `# ${title}\n\n`
    fileContent += `**영상 ID:** ${videoId}\n`
    fileContent += `**URL:** https://www.youtube.com/watch?v=${videoId}\n`
    fileContent += `**분석일:** ${result.created_at}\n\n`
    
    if (transcript) {
      fileContent += `## 📝 대본\n\n${transcript}\n\n`
    }
    
    if (summary) {
      fileContent += `## 📊 AI 요약\n\n${summary}\n\n`
    }
    
    // 파일명 생성 (특수문자 제거)
    const safeTitle = title.replace(/[^a-zA-Z0-9�가-힣\s-]/g, '').substring(0, 100)
    const fileName = `${safeTitle}_${videoId}.md`
    
    // Google Drive에 업로드
    const uploadResult = await uploadToGoogleDrive(
      accessToken,
      fileName,
      fileContent,
      'text/markdown',
      env.GOOGLE_DRIVE_FOLDER_ID
    )
    
    if (!uploadResult) {
      return c.json({ 
        error: 'Google Drive 업로드 실패',
        details: '파일 업로드 중 오류가 발생했습니다.'
      }, 500)
    }
    
    console.log(`✅ 업로드 완료: ${uploadResult.webViewLink}`)
    
    return c.json({
      success: true,
      message: `구글드라이브에 업로드 완료`,
      analysisId: id,
      fileName: fileName,
      driveLink: uploadResult.webViewLink,
      fileId: uploadResult.id
    })
  } catch (error: any) {
    console.error('❌ 구글드라이브 전송 실패:', error)
    return c.json({
      error: '구글드라이브 전송 실패',
      details: error.message
    }, 500)
  }
})

// 일괄 분석 결과 구글드라이브 전송
app.post('/api/send-drive/batch/:batchId', async (c) => {
  const { env } = c
  const batchId = parseInt(c.req.param('batchId'))
  
  // Body가 있으면 파싱, 없으면 빈 객체
  let body: any = {}
  try {
    const text = await c.req.text()
    if (text) {
      body = JSON.parse(text)
    }
  } catch (e) {
    // Body가 없거나 빈 경우 무시
  }
  const driveFolder = body.driveFolder
  
  if (!env.DB) {
    return c.json({ error: '데이터베이스가 설정되지 않았습니다.' }, 500)
  }
  
  // Google Drive 환경 변수 확인
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    return c.json({ 
      error: 'Google Drive 설정이 필요합니다.',
      details: 'GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY를 설정해주세요. GOOGLE_DRIVE_SETUP.md 참고'
    }, 500)
  }
  
  try {
    // 배치 정보 조회
    const batch = await env.DB.prepare(`
      SELECT * FROM batch_jobs WHERE id = ?
    `).bind(batchId).first()
    
    if (!batch) {
      return c.json({ error: '배치를 찾을 수 없습니다.' }, 404)
    }
    
    // 완료된 영상들 조회 (analysis_id가 있는 것만)
    const videosResult = await env.DB.prepare(`
      SELECT bv.*, a.transcript, a.summary, a.title, a.created_at
      FROM batch_videos bv
      LEFT JOIN analyses a ON bv.analysis_id = a.id
      WHERE bv.batch_id = ? AND bv.status = 'completed' AND bv.analysis_id IS NOT NULL
    `).bind(batchId).all()
    
    const completedVideos = videosResult.results || []
    
    if (completedVideos.length === 0) {
      return c.json({ 
        error: '업로드할 완료된 분석이 없습니다.',
        details: '배치 분석이 완료될 때까지 기다려주세요.'
      }, 400)
    }
    
    // 배치 Google Drive 업로드 시작
    
    // Access Token 발급
    const accessToken = await getAccessToken(
      env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      env.GOOGLE_PRIVATE_KEY
    )
    
    if (!accessToken) {
      return c.json({ 
        error: 'Google Drive 인증 실패',
        details: 'Access Token을 발급받을 수 없습니다.'
      }, 500)
    }
    
    console.log(`✅ Access Token 발급 완료`)
    
    // 각 영상을 업로드
    const uploadResults = []
    const uploadErrors = []
    
    for (const video of completedVideos) {
      try {
        const title = (video.title as string) || video.video_id as string
        const videoId = video.video_id as string
        const transcript = (video.transcript as string) || ''
        const summary = (video.summary as string) || ''
        
        let fileContent = `# ${title}\n\n`
        fileContent += `**영상 ID:** ${videoId}\n`
        fileContent += `**URL:** https://www.youtube.com/watch?v=${videoId}\n`
        fileContent += `**분석일:** ${video.created_at}\n\n`
        
        if (transcript) {
          fileContent += `## 📝 대본\n\n${transcript}\n\n`
        }
        
        if (summary) {
          fileContent += `## 📊 AI 요약\n\n${summary}\n\n`
        }
        
        // 파일명 생성
        const safeTitle = title.replace(/[^a-zA-Z0-9가-힣\s-]/g, '').substring(0, 100)
        const fileName = `${safeTitle}_${videoId}.md`
        
        // Google Drive에 업로드
        const uploadResult = await uploadToGoogleDrive(
          accessToken,
          fileName,
          fileContent,
          'text/markdown',
          env.GOOGLE_DRIVE_FOLDER_ID
        )
        
        if (uploadResult) {
          uploadResults.push({
            videoId,
            fileName,
            driveLink: uploadResult.webViewLink
          })
          console.log(`✅ 업로드 완료: ${fileName}`)
        } else {
          uploadErrors.push({
            videoId,
            fileName,
            error: '업로드 실패'
          })
        }
        
        // Rate Limit 방지 (1초 대기)
        await new Promise(resolve => setTimeout(resolve, 1000))
      } catch (error: any) {
        console.error(`❌ 영상 ${video.video_id} 업로드 실패:`, error)
        uploadErrors.push({
          videoId: video.video_id as string,
          error: error.message
        })
      }
    }
    
    return c.json({
      success: true,
      message: `구글드라이브에 ${uploadResults.length}개 파일 업로드 완료`,
      batchId: batchId,
      channelName: batch.channel_name,
      uploadedCount: uploadResults.length,
      failedCount: uploadErrors.length,
      uploadResults: uploadResults,
      uploadErrors: uploadErrors
    })
  } catch (error: any) {
    console.error('❌ 배치 구글드라이브 전송 실패:', error)
    return c.json({
      error: '구글드라이브 전송 실패',
      details: error.message
    }, 500)
  }
})

// ============================================
// Supabase Helper Functions
// ============================================

async function getChannelVideosWithDuplicateRemovalSupabase(
  channelId: string,
  apiKey: string,
  targetCount: number,
  supabase: any
): Promise<any[] | null> {
  try {
    let allVideos: any[] = []
    let pageToken: string | undefined = undefined
    let pageCount = 0
    const maxPages = Math.ceil(targetCount / 50) + 10
    
    console.log(`📺 채널 영상 가져오기 시작 (목표: ${targetCount}개, Shorts 제외)`)
    
    while (allVideos.length < targetCount && pageCount < maxPages) {
      pageCount++
      
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
      
      // Shorts 영상 필터링
      const filteredVideos = videos.filter((v: any) => {
        const title = v.title.toLowerCase()
        const isShorts = title.includes('shorts') || 
                        title.includes('short') || 
                        title.includes('#shorts') ||
                        title.includes('#short')
        return !isShorts
      })
      
      if (filteredVideos.length === 0) {
        if (!nextPageToken) break
        pageToken = nextPageToken
        continue
      }
      
      // Supabase에서 중복 확인
      const videoIds = filteredVideos.map((v: any) => v.videoId)
      const { data: existingAnalyses } = await supabase
        .from('analyses')
        .select('video_id')
        .in('video_id', videoIds)
      
      const existingVideoIds = new Set(existingAnalyses?.map((r: any) => r.video_id) || [])
      const newVideos = filteredVideos.filter((v: any) => !existingVideoIds.has(v.videoId))
      
      console.log(`✅ 페이지 ${pageCount}: ${newVideos.length}개 신규 (${filteredVideos.length - newVideos.length}개 중복)`)
      
      allVideos = allVideos.concat(newVideos)
      
      if (allVideos.length >= targetCount) {
        allVideos = allVideos.slice(0, targetCount)
        break
      }
      
      if (!nextPageToken) break
      pageToken = nextPageToken
    }
    
    console.log(`📊 최종 결과: ${allVideos.length}개 영상`)
    return allVideos
    
  } catch (error) {
    console.error('채널 영상 목록 가져오기 오류:', error)
    return null
  }
}

async function processVideoAnalysisSupabase(
  supabase: any,
  batchVideoId: number,
  videoUrl: string,
  videoId: string,
  title: string,
  channelId: string | null,
  channelName: string | null,
  uploadDate: string | null,
  geminiApiKey: string
): Promise<any> {
  try {
    // 1단계: 대본 추출
    console.log(`\n🎬 배치 영상 분석 시작: ${title}`)
    console.log('📝 1단계 시작: 대본 추출 (Gemini API)')
    
    let transcript: string | null = await extractTranscriptFromYouTube(videoId)
    
    if (!transcript) {
      const transcriptResult = await extractTranscriptWithGemini(videoUrl, geminiApiKey)
      if (!transcriptResult) {
        // 실패 처리
        await supabase
          .from('batch_videos')
          .update({ 
            status: 'failed',
            error_message: '대본 추출 실패',
            finished_at: new Date().toISOString()
          })
          .eq('id', batchVideoId)
        
        return { success: false, error: '대본 추출 실패' }
      }
      transcript = transcriptResult.transcript
    }
    
    console.log(`✅ 대본 추출 완료 (${transcript.length}자)`)
    
    // analyses 테이블에 저장
    const { data: newAnalysis, error: insertError } = await supabase
      .from('analyses')
      .insert({
        video_id: videoId,
        url: videoUrl,
        transcript,
        title,
        channel_id: channelId,
        channel_name: channelName,
        status: 'transcript_only',
        source: 'batch'
      })
      .select()
      .single()
    
    if (insertError) throw insertError
    
    const analysisId = newAnalysis.id
    console.log(`💾 분석 결과 저장 완료 (ID: ${analysisId})`)
    
    // Rate Limit 방지
    console.log(`⏳ 65초 대기 중... (Rate Limit 방지)`)
    await new Promise(resolve => setTimeout(resolve, 65000))
    
    // 2단계: 요약 생성
    console.log('📊 2단계 시작: AI 요약 보고서 생성')
    const summary = await generateSummaryWithGemini(transcript, geminiApiKey, title)
    
    if (!summary) {
      await supabase
        .from('analyses')
        .update({ status: 'failed' })
        .eq('id', analysisId)
      
      await supabase
        .from('batch_videos')
        .update({ 
          status: 'failed',
          analysis_id: analysisId,
          error_message: '요약 생성 실패',
          finished_at: new Date().toISOString()
        })
        .eq('id', batchVideoId)
      
      return { success: false, error: '요약 생성 실패' }
    }
    
    // 요약 저장
    await supabase
      .from('analyses')
      .update({ summary, status: 'completed' })
      .eq('id', analysisId)
    
    console.log('✅ 보고서 생성 완료')
    
    // batch_videos 업데이트
    await supabase
      .from('batch_videos')
      .update({ 
        status: 'completed',
        analysis_id: analysisId,
        finished_at: new Date().toISOString()
      })
      .eq('id', batchVideoId)
    
    // batch_jobs 카운터 업데이트
    const { data: batchVideo } = await supabase
      .from('batch_videos')
      .select('batch_id')
      .eq('id', batchVideoId)
      .single()
    
    if (batchVideo) {
      // completed_videos 증가
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
    
    console.log(`✅ 영상 분석 완료: ${title}\n`)
    
    return { success: true, analysisId, summary }
    
  } catch (error: any) {
    console.error('❌ 영상 분석 오류:', error)
    
    // 실패 처리
    await supabase
      .from('batch_videos')
      .update({ 
        status: 'failed',
        error_message: error.message,
        finished_at: new Date().toISOString()
      })
      .eq('id', batchVideoId)
    
    return { success: false, error: error.message }
  }
}

export default app

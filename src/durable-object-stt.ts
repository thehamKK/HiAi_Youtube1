// Cloudflare Durable Object for STT Processing
// 긴 작업(10분+)을 처리할 수 있는 백엔드

export class VideoProcessorDO {
  private state: DurableObjectState
  private env: any

  constructor(state: DurableObjectState, env: any) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request) {
    const url = new URL(request.url)
    
    if (url.pathname === '/process') {
      // 비동기 처리 시작
      const { videoId, batchVideoId, title } = await request.json()
      
      // 백그라운드에서 처리 (응답 즉시 반환)
      this.processVideo(videoId, batchVideoId, title)
      
      return new Response(JSON.stringify({ 
        status: 'processing',
        message: 'Video processing started'
      }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }
    
    if (url.pathname === '/status') {
      const status = await this.state.storage.get('status')
      return new Response(JSON.stringify(status), {
        headers: { 'Content-Type': 'application/json' }
      })
    }
    
    return new Response('Not found', { status: 404 })
  }

  private async processVideo(videoId: string, batchVideoId: number, title: string) {
    try {
      await this.state.storage.put('status', { stage: 'downloading' })
      
      // 1단계: YouTube 오디오 URL 추출 (youtube-dl API 사용)
      const audioUrl = await this.getYouTubeAudioUrl(videoId)
      
      await this.state.storage.put('status', { stage: 'transcribing' })
      
      // 2단계: Whisper API로 STT
      const transcript = await this.transcribeWithWhisper(audioUrl)
      
      await this.state.storage.put('status', { stage: 'summarizing' })
      
      // 3단계: Gemini로 요약
      const summary = await this.generateSummary(transcript, title)
      
      // 4단계: Supabase에 저장
      await this.saveToSupabase(batchVideoId, videoId, title, transcript, summary)
      
      await this.state.storage.put('status', { stage: 'completed' })
      
    } catch (error: any) {
      await this.state.storage.put('status', { 
        stage: 'failed', 
        error: error.message 
      })
    }
  }

  private async getYouTubeAudioUrl(videoId: string): Promise<string> {
    // YouTube-DL API 서비스 사용 (예: https://youtube-dl-api.herokuapp.com)
    const response = await fetch(`https://youtube-dl-api.herokuapp.com/api/info?url=https://www.youtube.com/watch?v=${videoId}`)
    const data = await response.json()
    
    // 오디오만 추출 (m4a, webm 등)
    const audioFormat = data.formats.find((f: any) => f.acodec !== 'none' && f.vcodec === 'none')
    return audioFormat.url
  }

  private async transcribeWithWhisper(audioUrl: string): Promise<string> {
    // OpenAI Whisper API 호출
    const openaiKey = this.env.OPENAI_API_KEY
    
    // 오디오 파일을 직접 다운로드하지 않고 URL 전달
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'whisper-1',
        audio_url: audioUrl,  // URL 직접 전달
        language: 'ko'
      })
    })
    
    const data = await response.json()
    return data.text
  }

  private async generateSummary(transcript: string, title: string): Promise<string> {
    const geminiKey = this.env.GEMINI_API_KEY
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `다음은 YouTube 영상의 대본입니다 (제목: ${title}). 이 대본을 읽고 1페이지 분량의 요약 보고서를 작성해주세요.

보고서 형식:
1. 핵심 내용 요약 (3-5문장)
2. 주요 포인트 (불릿 포인트 5-7개)
3. 결론 및 시사점

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

  private async saveToSupabase(
    batchVideoId: number, 
    videoId: string, 
    title: string, 
    transcript: string, 
    summary: string
  ) {
    const supabaseUrl = this.env.SUPABASE_URL
    const supabaseKey = this.env.SUPABASE_SERVICE_ROLE_KEY
    
    // Supabase REST API 호출
    await fetch(`${supabaseUrl}/rest/v1/analyses`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
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
    
    // batch_videos 상태 업데이트
    await fetch(`${supabaseUrl}/rest/v1/batch_videos?id=eq.${batchVideoId}`, {
      method: 'PATCH',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: 'completed',
        finished_at: new Date().toISOString()
      })
    })
  }
}

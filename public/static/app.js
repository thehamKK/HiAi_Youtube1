// Hi DB v2.1.3 - Frontend JavaScript

// 전역 변수
let currentAnalysis = null;
let currentBatch = null;

// ==================== 단일 영상 분석 ====================

async function analyzeVideo() {
    const videoUrl = document.getElementById('videoUrl').value.trim();
    
    if (!videoUrl) {
        showError('YouTube URL을 입력해주세요.');
        return;
    }
    
    hideError();
    hideSuccess();
    document.getElementById('results').classList.add('hidden');
    
    const analyzeBtn = document.getElementById('analyzeBtn');
    analyzeBtn.disabled = true;
    analyzeBtn.classList.add('opacity-50', 'cursor-not-allowed');
    
    try {
        // 1단계: 대본 추출
        showLoading('1단계: 대본 추출 중... (최대 10분 소요)');
        
        const stage1Response = await axios.post('/api/analyze/transcript', {
            videoUrl
        }, {
            timeout: 600000  // 10분
        });
        
        if (!stage1Response.data.success) {
            showError(stage1Response.data.error || '1단계 실패: 대본 추출 오류');
            return;
        }
        
        const { analysisId, transcript, videoId, title } = stage1Response.data;
        
        console.log('✅ 1단계 완료:', {
            analysisId,
            videoId,
            title,
            transcriptLength: transcript.length
        });
        
        // 중간 성공 메시지
        showSuccess('1단계 완료! 잠시 후 2단계를 시작합니다... (65초 대기)');
        
        // 65초 대기
        await new Promise(resolve => setTimeout(resolve, 65000));
        
        // 2단계: 보고서 생성
        hideSuccess();
        showLoading('2단계: AI 보고서 생성 중... (최대 5분 소요)');
        
        const stage2Response = await axios.post('/api/analyze/report', {
            analysisId
        }, {
            timeout: 300000  // 5분
        });
        
        if (!stage2Response.data.success) {
            showError(stage2Response.data.error || '2단계 실패: 보고서 생성 오류');
            return;
        }
        
        const { summary } = stage2Response.data;
        
        console.log('✅ 2단계 완료');
        
        // 결과 표시
        currentAnalysis = {
            id: analysisId,
            videoId,
            title,
            transcript,
            summary
        };
        
        displayResults(currentAnalysis);
        
        hideLoading();
        showSuccess('✅ 분석 완료! 보고서와 대본을 확인하세요.');
        
    } catch (error) {
        console.error('분석 오류:', error);
        
        hideLoading();
        
        if (error.response && error.response.data) {
            const errorData = error.response.data;
            
            if (error.response.status === 429) {
                // Rate Limit 오류
                if (errorData.stage === 1) {
                    showErrorWithRetry(
                        '1단계(대본 추출) 중 Rate Limit 발생\n\n잠시 후 다시 시도해주세요.'
                    );
                } else {
                    showErrorWithRetry(
                        '2단계(보고서 생성) 중 Rate Limit 발생\n\n보고서 재생성 버튼을 클릭하여 재시도하세요.'
                    );
                }
            } else {
                showError(errorData.details || errorData.error);
            }
        } else if (error.code === 'ECONNABORTED') {
            const errorMessage = '요청 시간 초과\n\n';
            const detailsMessage = error.message.includes('timeout') ? 
                '서버 응답이 너무 오래 걸립니다. 잠시 후 다시 시도해주세요.' : 
                error.message;
            
            showError(errorMessage + detailsMessage);
        } else {
            showError(
                '서버와 통신할 수 없습니다. 잠시 후 다시 시도해주세요.\n\n' +
                (error.message || '')
            );
        }
    } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
}

// 보고서 재생성
async function regenerateReport() {
    if (!currentAnalysis || !currentAnalysis.transcript) {
        showError('대본 정보가 없습니다. 처음부터 다시 시도해주세요.');
        return;
    }
    
    hideError();
    showLoading('보고서 재생성 중...');
    
    try {
        const response = await axios.post('/api/analyze/report', {
            analysisId: currentAnalysis.id
        }, {
            timeout: 300000  // 5분
        });
        
        if (response.data.success) {
            currentAnalysis.summary = response.data.summary;
            displayResults(currentAnalysis);
            hideLoading();
            showSuccess('✅ 보고서 재생성 완료!');
            loadHistory();  // 히스토리 새로고침
        } else {
            throw new Error(response.data.error || '보고서 생성 실패');
        }
        
    } catch (error) {
        console.error('보고서 재생성 오류:', error);
        hideLoading();
        
        if (error.response && error.response.data) {
            const errorData = error.response.data;
            
            if (error.response.status === 429) {
                showErrorWithRetry(
                    '보고서 생성 중 Rate Limit 발생\n\n잠시 후 다시 시도해주세요.'
                );
            } else {
                showErrorWithRetry(errorData.error || '보고서 생성 중 오류가 발생했습니다.');
            }
        } else {
            showErrorWithRetry('서버와 통신할 수 없습니다. 잠시 후 다시 시도해주세요.');
        }
    }
}

// 결과 표시
function displayResults(analysis) {
    document.getElementById('summary').textContent = analysis.summary || '보고서가 생성되지 않았습니다.';
    document.getElementById('transcript').textContent = analysis.transcript || '대본이 없습니다.';
    document.getElementById('results').classList.remove('hidden');
}

// 보고서 다운로드
function downloadReport() {
    if (!currentAnalysis || !currentAnalysis.summary) {
        showError('다운로드할 보고서가 없습니다.');
        return;
    }
    
    const blob = new Blob([currentAnalysis.summary], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentAnalysis.title || currentAnalysis.videoId}_요약보고서.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 대본 다운로드
function downloadTranscript() {
    if (!currentAnalysis || !currentAnalysis.transcript) {
        showError('다운로드할 대본이 없습니다.');
        return;
    }
    
    const blob = new Blob([currentAnalysis.transcript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentAnalysis.title || currentAnalysis.videoId}_대본.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==================== 채널 일괄 분석 ====================

async function analyzeChannel() {
    const channelUrl = document.getElementById('channelUrl').value.trim();
    const maxVideos = parseInt(document.getElementById('maxVideos').value) || 10;
    
    if (!channelUrl) {
        showChannelError('YouTube 채널 URL을 입력해주세요.');
        return;
    }
    
    hideChannelError();
    document.getElementById('channelProgress').classList.add('hidden');
    document.getElementById('channelResults').classList.add('hidden');
    
    const channelBtn = document.getElementById('analyzeChannelBtn');
    channelBtn.disabled = true;
    channelBtn.classList.add('opacity-50', 'cursor-not-allowed');
    
    try {
        showLoading('채널 분석을 시작하는 중...');
        
        const response = await axios.post('/api/channel/analyze', {
            videoUrl: channelUrl,
            maxVideos
        }, {
            timeout: 300000  // 5분
        });
        
        hideLoading();
        
        if (response.data.success) {
            const { batchId, channelName, totalVideos, alreadyAnalyzed } = response.data;
            
            currentBatch = {
                batchId,
                channelName,
                totalVideos
            };
            
            // 진행상황 표시
            document.getElementById('channelProgress').classList.remove('hidden');
            document.getElementById('channelName').textContent = channelName;
            document.getElementById('progressText').textContent = `0 / ${totalVideos}`;
            document.getElementById('progressBar').style.width = '0%';
            
            // 중복 정보 알림
            if (alreadyAnalyzed > 0) {
                showSuccess(`이미 분석된 ${alreadyAnalyzed}개 영상은 자동으로 스킵합니다.`);
            }
            
            // 배치 처리 자동 시작
            startBatchProcessing(batchId, totalVideos);
            
            // 진행상황 폴링 시작
            pollChannelProgress(batchId, totalVideos);
        } else {
            throw new Error(response.data.error || '채널 분석 시작 실패');
        }

    } catch (error) {
        console.error('채널 분석 오류:', error);
        
        const channelBtn = document.getElementById('analyzeChannelBtn');
        channelBtn.disabled = false;
        channelBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        
        if (error.response && error.response.data) {
            showChannelError(error.response.data.error || '채널 분석 중 오류가 발생했습니다.');
        } else {
            showChannelError('서버와 통신할 수 없습니다. 잠시 후 다시 시도해주세요.');
        }
    }
}

// 배치 처리 자동 시작 (재귀적으로 다음 영상 처리)
// 백엔드에서 자동으로 1단계(대본) → 65초 대기 → 2단계(보고서) 수행
async function startBatchProcessing(batchId, totalVideos) {
    try {
        console.log(`배치 처리 시작: ${batchId}`);
        
        // 다음 영상 처리 요청 (백엔드에서 자동 분석 수행)
        const response = await axios.post(`/api/channel/process/${batchId}`, {}, {
            timeout: 900000  // 15분 타임아웃 (대본 10분 + 대기 65초 + 보고서 5분)
        });
        
        if (response.data.success) {
            if (response.data.completed) {
                console.log('✅ 모든 영상 처리 완료');
            } else {
                // 백엔드에서 분석 진행 중이므로, 5초 후 다음 영상 트리거
                const videoInfo = response.data.video;
                console.log(`📹 영상 분석 시작: ${videoInfo.title}`);
                console.log(`⏰ 예상 소요 시간: 약 2-3분 (대본 추출 + 65초 대기 + 보고서 생성)`);
                
                // 5초 후 다음 영상 트리거 (백엔드에서 병렬 처리)
                setTimeout(() => startBatchProcessing(batchId, totalVideos), 5000);
            }
        }
    } catch (error) {
        console.error('배치 처리 오류:', error);
        
        // 타임아웃 또는 일시적 오류 시 재시도
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            console.log('⏰ 타임아웃 발생, 5초 후 재시도...');
            setTimeout(() => startBatchProcessing(batchId, totalVideos), 5000);
        } else {
            showChannelError('배치 처리 중 오류가 발생했습니다. 진행상황을 확인해주세요.');
        }
    }
}

// 채널 분석 진행상황 폴링
async function pollChannelProgress(batchId, totalVideos) {
    const pollInterval = setInterval(async () => {
        try {
            const response = await axios.get(`/api/channel/status/${batchId}`);
            
            if (response.data.batch && response.data.progress) {
                const { progress, videos } = response.data;
                
                // 진행률 업데이트 (완료 + 실패)
                const processedCount = progress.completed + progress.failed;
                const percentage = Math.round((processedCount / progress.total) * 100);
                document.getElementById('progressBar').style.width = `${percentage}%`;
                document.getElementById('progressText').textContent = 
                    `${processedCount} / ${progress.total} (성공: ${progress.completed}, 실패: ${progress.failed})`;
                
                // 영상별 상태 업데이트
                videos.forEach(video => {
                    updateVideoStatus(
                        video.video_id, 
                        video.status, 
                        video.error_message || '', 
                        0
                    );
                });
                
                // 현재 처리 중인 영상 표시
                const processingVideo = videos.find(v => v.status === 'processing');
                if (processingVideo) {
                    document.getElementById('currentVideo').textContent = `현재: ${processingVideo.video_title}`;
                } else {
                    document.getElementById('currentVideo').textContent = '대기 중...';
                }
                
                // 완료 확인 (성공 + 실패 = 전체)
                if (processedCount >= progress.total) {
                    clearInterval(pollInterval);
                    showChannelComplete(batchId, progress.completed, progress.failed, progress.total);
                }
            }
        } catch (error) {
            console.error('진행상황 조회 오류:', error);
            // 에러가 발생해도 폴링 계속 (일시적 네트워크 오류 대응)
            console.log('⚠️ 진행상황 조회 실패, 계속 시도...');
        }
    }, 3000);  // 3초마다 확인
}

// 채널 분석 완료
function showChannelComplete(batchId, completedCount, failedCount, totalVideos) {
    document.getElementById('channelProgress').classList.add('hidden');
    document.getElementById('channelResults').classList.remove('hidden');
    
    // 결과 메시지 (성공/실패 구분)
    let resultMessage = '';
    if (failedCount === 0) {
        resultMessage = `✅ ${completedCount}개 영상 분석이 완료되었습니다!`;
        showSuccess('채널 분석이 완료되었습니다! ZIP 다운로드 버튼을 클릭하세요.');
    } else if (completedCount === 0) {
        resultMessage = `❌ ${failedCount}개 영상 분석이 모두 실패했습니다.`;
        showChannelError(`모든 영상 분석 실패: 대본 추출이 실패했습니다. Gemini API 키를 확인해주세요.`);
    } else {
        resultMessage = `⚠️ ${completedCount}개 성공, ${failedCount}개 실패 (총 ${totalVideos}개)`;
        showSuccess(`일부 분석 완료: ${completedCount}개 성공, ${failedCount}개 실패`);
    }
    
    document.getElementById('channelResultMessage').textContent = resultMessage;
    
    const channelBtn = document.getElementById('analyzeChannelBtn');
    channelBtn.disabled = false;
    channelBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    
    loadHistory();  // 히스토리 새로고침
}


// ==================== ZIP 다운로드 ====================

// 전체 보고서 ZIP 다운로드 (배치 완료 후)
async function downloadAllReports() {
    if (!currentBatch) {
        showChannelError('배치 정보가 없습니다. 채널 분석을 먼저 실행해주세요.');
        return;
    }

    try {
        showLoading();
        
        const { batchId, channelName } = currentBatch;
        
        console.log(`ZIP 생성 시작: 배치 ${batchId}`);
        
        // 배치에 속한 모든 영상 조회
        const statusResponse = await axios.get(`/api/channel/status/${batchId}`);
        
        if (!statusResponse.data.videos || statusResponse.data.videos.length === 0) {
            showChannelError('분석된 영상이 없습니다.');
            hideLoading();
            return;
        }
        
        const videos = statusResponse.data.videos;
        const completedVideos = videos.filter(v => v.analysis_id && v.status === 'completed');
        
        if (completedVideos.length === 0) {
            showChannelError('완료된 분석이 없습니다.');
            hideLoading();
            return;
        }
        
        // JSZip 객체 생성
        const zip = new JSZip();
        const folderName = sanitizeFilename(channelName);
        
        // 각 영상의 보고서 가져오기
        for (const video of completedVideos) {
            try {
                const analysisResponse = await axios.get(`/api/analysis/${video.analysis_id}`);
                const analysis = analysisResponse.data.analysis;
                
                if (analysis && analysis.summary) {
                    const uploadDate = video.upload_date || '20250101';
                    const analysisDate = formatDateForFilename(new Date(analysis.created_at));
                    const videoTitle = sanitizeFilename(video.video_title);
                    const filename = `${uploadDate}_${videoTitle}_${analysisDate}_요약보고서.txt`;
                    
                    zip.file(`${folderName}/${filename}`, analysis.summary);
                    console.log(`✅ 추가: ${filename}`);
                }
            } catch (error) {
                console.error(`영상 ${video.video_id} 처리 실패:`, error);
            }
        }
        
        // ZIP 생성 및 다운로드
        const blob = await zip.generateAsync({ type: 'blob' });
        const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const zipFilename = `${folderName}_${today}_보고서모음.zip`;
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = zipFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showSuccess(`${completedVideos.length}개 보고서를 ZIP으로 다운로드했습니다! 🎉`);
        console.log(`✅ ZIP 다운로드 완료: ${zipFilename}`);
        
    } catch (error) {
        console.error('ZIP 생성 오류:', error);
        if (error.response && error.response.status === 404) {
            showChannelError('해당 채널의 분석 결과를 찾을 수 없습니다.');
        } else {
            showChannelError('ZIP 생성 중 오류가 발생했습니다. 콘솔을 확인해주세요.');
        }
    } finally {
        hideLoading();
    }
}

// 파일명 안전 처리
function sanitizeFilename(filename) {
    return filename
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, '_')
        .substring(0, 100);
}

// 날짜 포맷팅
function formatDateForFilename(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}_${hour}${minute}${second}`;
}

// ==================== 히스토리 ====================

async function loadHistory() {
    try {
        const response = await axios.get('/api/history');
        
        if (response.data.analyses && response.data.analyses.length > 0) {
            displayHistory(response.data.analyses);
        } else {
            document.getElementById('history').innerHTML = 
                '<p class="text-gray-500">분석 히스토리가 없습니다.</p>';
        }
    } catch (error) {
        console.error('히스토리 로드 오류:', error);
        document.getElementById('history').innerHTML = 
            '<p class="text-red-500">히스토리를 불러올 수 없습니다.</p>';
    }
}

function displayHistory(analyses) {
    const historyDiv = document.getElementById('history');
    
    let html = '<div class="space-y-4">';
    
    for (const analysis of analyses) {
        const date = new Date(analysis.created_at).toLocaleString('ko-KR');
        const statusBadge = analysis.status === 'completed' ? 
            '<span class="bg-green-100 text-green-800 px-2 py-1 rounded text-xs">완료</span>' :
            '<span class="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs">대본만</span>';
        
        html += `
            <div class="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                <div class="flex justify-between items-start mb-2">
                    <div class="flex-1">
                        <h4 class="font-semibold text-gray-800">${analysis.title || analysis.video_id}</h4>
                        <p class="text-sm text-gray-500">ID: ${analysis.id} | ${date}</p>
                        ${analysis.channel_name ? `<p class="text-sm text-gray-600">채널: ${analysis.channel_name}</p>` : ''}
                    </div>
                    <div class="flex items-center space-x-2">
                        ${statusBadge}
                    </div>
                </div>
                <div class="flex space-x-2 mt-3">
                    <button 
                        onclick="viewAnalysis(${analysis.id})" 
                        class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 text-sm"
                    >
                        <i class="fas fa-eye mr-1"></i>보기
                    </button>
                    <a 
                        href="${analysis.url}" 
                        target="_blank" 
                        class="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 text-sm inline-block"
                    >
                        <i class="fab fa-youtube mr-1"></i>YouTube
                    </a>
                </div>
            </div>
        `;
    }
    
    html += '</div>';
    historyDiv.innerHTML = html;
}

async function viewAnalysis(id) {
    try {
        const response = await axios.get(`/api/analysis/${id}`);
        
        if (response.data.analysis) {
            const analysis = response.data.analysis;
            
            currentAnalysis = {
                id: analysis.id,
                videoId: analysis.video_id,
                title: analysis.title,
                transcript: analysis.transcript,
                summary: analysis.summary
            };
            
            displayResults(currentAnalysis);
            
            // 스크롤
            document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
        }
    } catch (error) {
        console.error('분석 결과 조회 오류:', error);
        showError('분석 결과를 불러올 수 없습니다.');
    }
}

// ==================== UI 유틸리티 ====================

// 채널 분석 전용 에러 표시
function showChannelError(message) {
    const errorDiv = document.getElementById('channelError');
    const errorMessage = document.getElementById('channelErrorMessage');
    errorMessage.textContent = message;
    errorDiv.classList.remove('hidden');
    
    // 진행상황 숨기기
    document.getElementById('channelProgress').classList.add('hidden');
}

function hideChannelError() {
    document.getElementById('channelError').classList.add('hidden');
}

// 에러 메시지 + 보고서 재생성 버튼 표시
function showErrorWithRetry(message) {
    const errorDiv = document.getElementById('error');
    const errorMessage = document.getElementById('errorMessage');
    
    // 에러 메시지 + 버튼 HTML
    errorMessage.innerHTML = `
        <div class="space-y-4">
            <p style="white-space: pre-line;">${message}</p>
            <button 
                id="retryReportButton"
                onclick="regenerateReport()" 
                class="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-semibold"
            >
                <i class="fas fa-redo mr-2"></i>
                보고서 재생성
            </button>
        </div>
    `;
    
    errorDiv.classList.remove('hidden');
}

function showError(message) {
    const errorDiv = document.getElementById('error');
    const errorMessage = document.getElementById('errorMessage');
    errorMessage.textContent = message;
    errorDiv.classList.remove('hidden');
}

function hideError() {
    document.getElementById('error').classList.add('hidden');
}

function showSuccess(message) {
    const successDiv = document.getElementById('success');
    const successMessage = document.getElementById('successMessage');
    successMessage.textContent = message;
    successDiv.classList.remove('hidden');
}

function hideSuccess() {
    document.getElementById('success').classList.add('hidden');
}

function showLoading(message = '처리 중...') {
    const loadingDiv = document.getElementById('loading');
    const loadingMessage = document.getElementById('loadingMessage');
    loadingMessage.textContent = message;
    loadingDiv.classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading').classList.add('hidden');
}

// ==================== 채널 일괄 분석 ====================

// 채널 분석 시작
async function analyzeChannel() {
    const channelUrl = document.getElementById('channelUrl').value.trim();
    const maxVideos = parseInt(document.getElementById('maxVideos').value);
    
    if (!channelUrl) {
        showChannelError('YouTube 채널 URL을 입력해주세요.');
        return;
    }
    
    hideChannelError();
    hideChannelSuccess();
    document.getElementById('channelProgress').classList.add('hidden');
    document.getElementById('channelResults').classList.add('hidden');
    
    const analyzeChannelBtn = document.getElementById('analyzeChannelBtn');
    analyzeChannelBtn.disabled = true;
    analyzeChannelBtn.classList.add('opacity-50', 'cursor-not-allowed');
    
    try {
        // 1단계: 배치 작업 생성
        showChannelLoading(`채널 영상 목록 가져오는 중... (최대 ${maxVideos}개)`);
        
        const response = await axios.post('/api/channel/analyze', {
            videoUrl: channelUrl,
            maxVideos
        }, {
            timeout: 30000  // 30초
        });
        
        if (!response.data.success) {
            showChannelError(response.data.error || '채널 분석을 시작할 수 없습니다.');
            return;
        }
        
        const { batchId, channelName, totalVideos, requestedCount, message } = response.data;
        currentBatch = { batchId, channelName, totalVideos };
        
        console.log('✅ 배치 작업 생성:', { batchId, channelName, totalVideos, requestedCount });
        
        showChannelSuccess(
            `채널: ${channelName}\n` +
            `${message}\n` +
            `배치 작업이 생성되었습니다. 자동 분석이 시작됩니다...`
        );
        
        // 영상 목록 초기화 (대기중 상태로 표시)
        initializeVideoList(response.data.videos);
        
        // 1초 대기 후 자동 처리 시작
        setTimeout(() => {
            startBatchProcessing(batchId, totalVideos, channelName);
        }, 1000);
        
    } catch (error) {
        console.error('채널 분석 시작 오류:', error);
        hideChannelLoading();
        
        if (error.response && error.response.data) {
            showChannelError(error.response.data.error || '채널 분석을 시작할 수 없습니다.');
        } else if (error.code === 'ECONNABORTED') {
            showChannelError('채널 정보를 가져오는데 시간이 너무 오래 걸렸습니다.\n잠시 후 다시 시도해주세요.');
        } else {
            showChannelError('서버와 통신할 수 없습니다.\n잠시 후 다시 시도해주세요.');
        }
    } finally {
        analyzeChannelBtn.disabled = false;
        analyzeChannelBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
}

// 영상 목록 초기화 (대기중 상태)
function initializeVideoList(videos) {
    const listDiv = document.getElementById('videoStatusList');
    
    listDiv.innerHTML = videos.map((video, index) => `
        <div id="video-item-${video.videoId}" class="bg-white border-2 border-gray-200 rounded-lg p-4 transition-all hover:shadow-md">
            <div class="flex items-start space-x-3">
                <!-- 상태 아이콘 -->
                <div id="video-icon-${video.videoId}" class="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-gray-100">
                    <i class="fas fa-clock text-gray-400"></i>
                </div>
                
                <!-- 영상 정보 -->
                <div class="flex-1 min-w-0">
                    <div class="flex items-start justify-between mb-1">
                        <p class="font-semibold text-gray-800 text-sm truncate pr-2">
                            ${index + 1}. ${video.title}
                        </p>
                        <span id="video-badge-${video.videoId}" class="flex-shrink-0 px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
                            대기중
                        </span>
                    </div>
                    <p class="text-xs text-gray-500 mb-2">
                        <i class="fas fa-link mr-1"></i>
                        <a href="${video.url}" target="_blank" class="text-blue-600 hover:underline">
                            ${video.videoId}
                        </a>
                    </p>
                    <!-- 진행률 바 (숨김 상태) -->
                    <div id="video-progress-${video.videoId}" class="hidden mt-2">
                        <div class="w-full bg-gray-200 rounded-full h-2">
                            <div id="video-progress-bar-${video.videoId}" class="bg-blue-500 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
                        </div>
                        <p id="video-status-text-${video.videoId}" class="text-xs text-gray-600 mt-1"></p>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

// 영상 상태 업데이트
function updateVideoStatus(videoId, status, statusText = '', progress = 0) {
    const iconDiv = document.getElementById(`video-icon-${videoId}`);
    const badgeSpan = document.getElementById(`video-badge-${videoId}`);
    const progressDiv = document.getElementById(`video-progress-${videoId}`);
    const progressBar = document.getElementById(`video-progress-bar-${videoId}`);
    const statusTextP = document.getElementById(`video-status-text-${videoId}`);
    const itemDiv = document.getElementById(`video-item-${videoId}`);
    
    if (!iconDiv || !badgeSpan) return;
    
    // 상태별 UI 업데이트
    switch(status) {
        case 'pending':
            iconDiv.innerHTML = '<i class="fas fa-clock text-gray-400"></i>';
            iconDiv.className = 'flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-gray-100';
            badgeSpan.textContent = '대기중';
            badgeSpan.className = 'flex-shrink-0 px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600';
            itemDiv.className = 'bg-white border-2 border-gray-200 rounded-lg p-4 transition-all hover:shadow-md';
            progressDiv.classList.add('hidden');
            break;
            
        case 'processing':
            iconDiv.innerHTML = '<i class="fas fa-spinner fa-spin text-blue-500"></i>';
            iconDiv.className = 'flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-blue-100';
            badgeSpan.textContent = '분석중';
            badgeSpan.className = 'flex-shrink-0 px-2 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700';
            itemDiv.className = 'bg-blue-50 border-2 border-blue-300 rounded-lg p-4 transition-all shadow-md';
            progressDiv.classList.remove('hidden');
            progressBar.style.width = `${progress}%`;
            if (statusTextP && statusText) {
                statusTextP.textContent = statusText;
            }
            break;
            
        case 'completed':
            iconDiv.innerHTML = '<i class="fas fa-check-circle text-green-500"></i>';
            iconDiv.className = 'flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-green-100';
            badgeSpan.textContent = '완료';
            badgeSpan.className = 'flex-shrink-0 px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700';
            itemDiv.className = 'bg-green-50 border-2 border-green-300 rounded-lg p-4 transition-all hover:shadow-md';
            progressDiv.classList.remove('hidden');
            progressBar.style.width = '100%';
            progressBar.className = 'bg-green-500 h-2 rounded-full transition-all duration-300';
            if (statusTextP) {
                statusTextP.textContent = '✓ 분석 완료';
            }
            break;
            
        case 'failed':
            iconDiv.innerHTML = '<i class="fas fa-times-circle text-red-500"></i>';
            iconDiv.className = 'flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-red-100';
            badgeSpan.textContent = '오류';
            badgeSpan.className = 'flex-shrink-0 px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700';
            itemDiv.className = 'bg-red-50 border-2 border-red-300 rounded-lg p-4 transition-all hover:shadow-md';
            progressDiv.classList.remove('hidden');
            if (statusTextP && statusText) {
                statusTextP.textContent = `✗ ${statusText}`;
            }
            break;
    }
}

// 배치 처리 시작
async function startBatchProcessing(batchId, totalVideos, channelName) {
    let completed = 0;
    let failed = 0;
    
    hideChannelSuccess();
    document.getElementById('channelProgress').classList.remove('hidden');
    document.getElementById('channelProgressBar').style.width = '0%';
    document.getElementById('channelProgressText').textContent = `0 / ${totalVideos} 완료`;
    document.getElementById('channelCurrentVideo').textContent = '분석 시작 중...';
    
    try {
        while (completed + failed < totalVideos) {
            // 진행 상황 폴링
            const statusResponse = await axios.get(`/api/channel/status/${batchId}`);
            
            if (statusResponse.data.error) {
                throw new Error(statusResponse.data.error);
            }
            
            const batch = statusResponse.data.batch;
            const progress = statusResponse.data.progress;
            const videos = statusResponse.data.videos || [];
            
            completed = progress.completed;
            failed = progress.failed;
            
            // 전체 진행률 업데이트
            const progressPercent = Math.round(((completed + failed) / totalVideos) * 100);
            document.getElementById('channelProgressBar').style.width = `${progressPercent}%`;
            document.getElementById('channelProgressPercentage').textContent = `${progressPercent}%`;
            document.getElementById('channelProgressText').textContent = 
                `${completed + failed} / ${totalVideos} (성공: ${completed}, 실패: ${failed})`;
            
            // 각 영상별 상태 업데이트
            videos.forEach(video => {
                if (video.status === 'pending') {
                    updateVideoStatus(video.video_id, 'pending');
                } else if (video.status === 'processing') {
                    // 처리 중인 영상: 단계별 진행률 표시
                    const elapsed = video.started_at ? 
                        Math.floor((Date.now() - new Date(video.started_at).getTime()) / 1000) : 0;
                    
                    let stepProgress = 0;
                    let stepText = '';
                    
                    if (elapsed < 90) {
                        // 1단계: 대본 추출 (0-90초)
                        stepProgress = Math.min(Math.floor((elapsed / 90) * 40), 40);
                        stepText = `1단계: 대본 추출 중... (${elapsed}초 경과)`;
                    } else if (elapsed < 155) {
                        // 대기 시간 (90-155초)
                        stepProgress = 40 + Math.min(Math.floor(((elapsed - 90) / 65) * 20), 20);
                        stepText = `Rate Limit 방지 대기 중... (${155 - elapsed}초 남음)`;
                    } else {
                        // 2단계: 보고서 생성 (155초~)
                        stepProgress = 60 + Math.min(Math.floor(((elapsed - 155) / 30) * 40), 40);
                        stepText = `2단계: AI 요약 보고서 생성 중...`;
                    }
                    
                    updateVideoStatus(video.video_id, 'processing', stepText, stepProgress);
                } else if (video.status === 'completed') {
                    updateVideoStatus(video.video_id, 'completed');
                } else if (video.status === 'failed') {
                    updateVideoStatus(video.video_id, 'failed', video.error_message || '알 수 없는 오류');
                }
            });
            
            // 완료 확인
            if (batch.status === 'completed') {
                break;
            }
            
            // 폴링 간격 (3초)
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        // 완료 메시지
        hideChannelLoading();
        document.getElementById('channelProgressBar').style.width = '100%';
        document.getElementById('channelProgressText').textContent = 
            `완료! (성공: ${completed}, 실패: ${failed})`;
        document.getElementById('channelCurrentVideo').textContent = '모든 영상 분석 완료';
        
        showChannelSuccess(
            `채널 "${channelName}" 분석 완료!\n` +
            `성공: ${completed}개 / 실패: ${failed}개`
        );
        
        // 결과 표시
        displayChannelResults(batchId);
        
        // 히스토리 새로고침
        loadHistory();
        
    } catch (error) {
        console.error('배치 처리 오류:', error);
        hideChannelLoading();
        showChannelError('배치 처리 중 오류가 발생했습니다.\n' + (error.message || '알 수 없는 오류'));
    }
}

// 채널 분석 결과 표시
async function displayChannelResults(batchId) {
    try {
        const response = await axios.get(`/api/channel/status/${batchId}`);
        
        if (response.data.error) {
            showChannelError('분석 결과를 불러올 수 없습니다.');
            return;
        }
        
        const videos = response.data.videos || [];
        
        if (videos.length === 0) {
            showChannelError('분석된 영상이 없습니다.');
            return;
        }
        
        document.getElementById('channelResults').classList.remove('hidden');
        
        // ZIP 다운로드 버튼 활성화
        const downloadBtn = document.getElementById('downloadAllReports');
        downloadBtn.onclick = () => downloadAllReports(batchId);
        
    } catch (error) {
        console.error('결과 표시 오류:', error);
        showChannelError('결과를 표시하는 중 오류가 발생했습니다.');
    }
}

// 전체 보고서 ZIP 다운로드
async function downloadAllReports(batchId) {
    if (!currentBatch) {
        showChannelError('배치 정보가 없습니다. 채널 분석을 먼저 실행해주세요.');
        return;
    }
    
    try {
        showChannelLoading('보고서 ZIP 파일 생성 중...');
        
        // 배치 상태 가져오기
        const statusResponse = await axios.get(`/api/channel/status/${batchId}`);
        if (statusResponse.data.error) {
            throw new Error(statusResponse.data.error);
        }
        
        const videos = statusResponse.data.videos || [];
        const completedVideos = videos.filter(v => v.status === 'completed' && v.analysis_id);
        
        if (completedVideos.length === 0) {
            showChannelError('다운로드할 보고서가 없습니다.');
            return;
        }
        
        // ZIP 파일 생성
        const zip = new JSZip();
        
        for (const video of completedVideos) {
            try {
                const analysisResponse = await axios.get(`/api/analysis/${video.analysis_id}`);
                if (analysisResponse.data.success && analysisResponse.data.analysis) {
                    const analysis = analysisResponse.data.analysis;
                    
                    // 파일명 생성
                    const uploadDate = video.upload_date || 'Unknown';
                    const title = video.video_title || video.video_id;
                    const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_');
                    
                    // 요약 보고서
                    if (analysis.summary) {
                        zip.file(`[${uploadDate}] ${safeTitle} - 요약보고서.txt`, analysis.summary);
                    }
                    
                    // 대본
                    if (analysis.transcript) {
                        zip.file(`[${uploadDate}] ${safeTitle} - 대본.txt`, analysis.transcript);
                    }
                }
            } catch (err) {
                console.error(`영상 ${video.video_id} 처리 실패:`, err);
            }
        }
        
        // ZIP 다운로드
        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentBatch.channelName || 'channel'}_분석결과_${new Date().toISOString().split('T')[0]}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        hideChannelLoading();
        showChannelSuccess(`ZIP 파일 다운로드 완료! (${completedVideos.length}개 영상)`);
        
    } catch (error) {
        console.error('ZIP 생성 오류:', error);
        hideChannelLoading();
        showChannelError('ZIP 생성 중 오류가 발생했습니다.');
    }
}

// 채널 에러/성공/로딩 메시지
function showChannelError(message) {
    const errorDiv = document.getElementById('channelError');
    const errorMessage = document.getElementById('channelErrorMessage');
    errorMessage.textContent = message;
    errorDiv.classList.remove('hidden');
}

function hideChannelError() {
    document.getElementById('channelError').classList.add('hidden');
}

function showChannelSuccess(message) {
    const successDiv = document.getElementById('channelSuccess');
    const successMessage = document.getElementById('channelSuccessMessage');
    successMessage.textContent = message;
    successDiv.classList.remove('hidden');
}

function hideChannelSuccess() {
    document.getElementById('channelSuccess').classList.add('hidden');
}

function showChannelLoading(message = '처리 중...') {
    const loadingDiv = document.getElementById('channelLoading');
    const loadingMessage = document.getElementById('channelLoadingMessage');
    loadingMessage.textContent = message;
    loadingDiv.classList.remove('hidden');
}

function hideChannelLoading() {
    document.getElementById('channelLoading').classList.add('hidden');
}

// ==================== 분석 히스토리 ====================

// 히스토리 로드
async function loadHistory() {
    try {
        const response = await axios.get('/api/history');
        
        if (!response.data.success) {
            console.error('히스토리 로드 실패:', response.data.error);
            return;
        }
        
        displayHistory(response.data.analyses);
    } catch (error) {
        console.error('히스토리 로드 오류:', error);
    }
}

// 히스토리 표시
function displayHistory(analyses) {
    const historyDiv = document.getElementById('history');
    
    if (!analyses || analyses.length === 0) {
        historyDiv.innerHTML = `
            <div class="text-center text-gray-500 py-8">
                <i class="fas fa-inbox text-4xl mb-4"></i>
                <p>아직 분석된 영상이 없습니다.</p>
            </div>
        `;
        return;
    }
    
    historyDiv.innerHTML = analyses.map(item => `
        <div class="border-2 border-gray-200 rounded-lg p-4 hover:border-orange-500 transition-colors">
            <div class="flex justify-between items-start mb-2">
                <div class="flex-1">
                    <h3 class="font-bold text-lg text-gray-800 mb-1">
                        ${item.title || '제목 없음'}
                    </h3>
                    <p class="text-sm text-gray-500 mb-2">
                        <i class="fas fa-link mr-1"></i>
                        <a href="${item.url}" target="_blank" class="text-blue-600 hover:underline">
                            ${item.video_id}
                        </a>
                    </p>
                    ${item.channel_name ? `
                        <p class="text-sm text-gray-500 mb-2">
                            <i class="fas fa-tv mr-1"></i>
                            채널: ${item.channel_name}
                        </p>
                    ` : ''}
                    <p class="text-xs text-gray-400">
                        <i class="fas fa-clock mr-1"></i>
                        분석일: ${new Date(item.created_at).toLocaleString('ko-KR')}
                    </p>
                </div>
                <div class="ml-4">
                    <span class="px-3 py-1 rounded-full text-xs font-semibold ${
                        item.status === 'completed' 
                            ? 'bg-green-100 text-green-800' 
                            : item.status === 'transcript_only'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-gray-100 text-gray-800'
                    }">
                        ${
                            item.status === 'completed' 
                                ? '✓ 완료' 
                                : item.status === 'transcript_only'
                                ? '대본만'
                                : item.status
                        }
                    </span>
                </div>
            </div>
            
            <div class="mt-4 flex space-x-2">
                ${item.status === 'completed' ? `
                    <button 
                        onclick="viewAnalysis('${item.id}')" 
                        class="bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 transition-colors text-sm font-semibold"
                    >
                        <i class="fas fa-eye mr-1"></i>
                        보고서 보기
                    </button>
                    <button 
                        onclick="downloadHistoryReport('${item.id}', '${item.video_id}', '${(item.title || '').replace(/'/g, "\\'")}', '${item.upload_date || ''}')" 
                        class="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors text-sm font-semibold"
                    >
                        <i class="fas fa-download mr-1"></i>
                        보고서 다운로드
                    </button>
                ` : ''}
                <button 
                    onclick="downloadHistoryTranscript('${item.id}', '${item.video_id}', '${(item.title || '').replace(/'/g, "\\'")}', '${item.upload_date || ''}')" 
                    class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-semibold"
                >
                    <i class="fas fa-download mr-1"></i>
                    대본 다운로드
                </button>
            </div>
        </div>
    `).join('');
}

// 히스토리에서 분석 보기
async function viewAnalysis(analysisId) {
    try {
        const response = await axios.get(`/api/analysis/${analysisId}`);
        
        if (!response.data.success) {
            showError('분석 결과를 불러올 수 없습니다.');
            return;
        }
        
        const analysis = response.data.analysis;
        
        // 현재 분석 설정
        currentAnalysis = {
            analysisId: analysis.id,
            videoId: analysis.video_id,
            title: analysis.title,
            uploadDate: analysis.upload_date,
            summary: analysis.summary,
            transcript: analysis.transcript
        };
        
        // 결과 표시
        document.getElementById('results').classList.remove('hidden');
        document.getElementById('summary').innerHTML = analysis.summary.replace(/\n/g, '<br>');
        document.getElementById('transcript').textContent = analysis.transcript;
        
        // 스크롤
        document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
        
        showSuccess('분석 결과를 불러왔습니다.');
    } catch (error) {
        console.error('분석 보기 오류:', error);
        showError('분석 결과를 불러오는 중 오류가 발생했습니다.');
    }
}

// 히스토리에서 보고서 다운로드
async function downloadHistoryReport(analysisId, videoId, title, uploadDate) {
    try {
        const response = await axios.get(`/api/analysis/${analysisId}`);
        
        if (!response.data.success || !response.data.analysis.summary) {
            showError('보고서를 찾을 수 없습니다.');
            return;
        }
        
        const summary = response.data.analysis.summary;
        const filename = `[${uploadDate || 'Unknown'}] ${title || videoId} - 요약보고서.txt`;
        
        downloadTextFile(summary, filename);
        showSuccess('보고서가 다운로드되었습니다.');
    } catch (error) {
        console.error('보고서 다운로드 오류:', error);
        showError('보고서 다운로드 중 오류가 발생했습니다.');
    }
}

// 히스토리에서 대본 다운로드
async function downloadHistoryTranscript(analysisId, videoId, title, uploadDate) {
    try {
        const response = await axios.get(`/api/analysis/${analysisId}`);
        
        if (!response.data.success || !response.data.analysis.transcript) {
            showError('대본을 찾을 수 없습니다.');
            return;
        }
        
        const transcript = response.data.analysis.transcript;
        const filename = `[${uploadDate || 'Unknown'}] ${title || videoId} - 대본.txt`;
        
        downloadTextFile(transcript, filename);
        showSuccess('대본이 다운로드되었습니다.');
    } catch (error) {
        console.error('대본 다운로드 오류:', error);
        showError('대본 다운로드 중 오류가 발생했습니다.');
    }
}

// 페이지 로드 시 히스토리 자동 로드
document.addEventListener('DOMContentLoaded', () => {
    loadHistory();
});


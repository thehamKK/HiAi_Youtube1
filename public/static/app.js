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
async function downloadReport(analysisId) {
    try {
        // API에서 분석 데이터 가져오기
        const response = await axios.get(`/api/analysis/${analysisId}`);
        const analysis = response.data;
        
        if (!analysis || !analysis.summary) {
            showError('다운로드할 보고서가 없습니다.');
            return;
        }
        
        // 파일명 규칙: 영상업로드날짜_영상제목에서3단어만_영상유튜브주소_요약보고서.txt
        const uploadDate = analysis.upload_date || 'NODATE';
        const titleWords = (analysis.title || '')
            .replace(/[<>:"/\\|?*()]/g, '')  // 특수문자 제거
            .split(/\s+/)  // 공백으로 단어 분리
            .filter(word => word.length > 0)  // 빈 문자열 제거
            .slice(0, 3)  // 첫 3단어만
            .join('_');  // 언더스코어로 연결
        const videoUrl = analysis.video_id;
        const fileName = `${uploadDate}_${titleWords}_${videoUrl}_요약보고서.txt`;
        
        const blob = new Blob([analysis.summary], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log('✅ 보고서 다운로드 완료:', analysis.video_id);
    } catch (error) {
        console.error('보고서 다운로드 실패:', error);
        showError('보고서 다운로드 중 오류가 발생했습니다.');
    }
}

// 대본 다운로드
async function downloadTranscript(analysisId, videoId) {
    try {
        // API에서 분석 데이터 가져오기
        const response = await axios.get(`/api/analysis/${analysisId}`);
        const analysis = response.data;
        
        if (!analysis || !analysis.transcript) {
            showError('다운로드할 대본이 없습니다.');
            return;
        }
        
        // 파일명 규칙: 영상업로드날짜_영상제목에서3단어만_영상유튜브주소_대본전문.txt
        const uploadDate = analysis.upload_date || 'NODATE';
        const titleWords = (analysis.title || '')
            .replace(/[<>:"/\\|?*()]/g, '')  // 특수문자 제거
            .split(/\s+/)  // 공백으로 단어 분리
            .filter(word => word.length > 0)  // 빈 문자열 제거
            .slice(0, 3)  // 첫 3단어만
            .join('_');  // 언더스코어로 연결
        const videoUrl = analysis.video_id;
        const fileName = `${uploadDate}_${titleWords}_${videoUrl}_대본전문.txt`;
        
        const blob = new Blob([analysis.transcript], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log('✅ 대본 다운로드 완료:', videoId);
    } catch (error) {
        console.error('대본 다운로드 실패:', error);
        showError('대본 다운로드 중 오류가 발생했습니다.');
    }
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
                    // 현재 단계 표시 (processing 상태일 때)
                    const statusText = video.status === 'processing' 
                        ? (video.current_step || '처리 중...')
                        : (video.error_message || '');
                    
                    updateVideoStatus(
                        video.video_id, 
                        video.status, 
                        statusText, 
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

// 폴더 토글 함수
function toggleFolder(folderId) {
    const content = document.getElementById(folderId + 'Content');
    const icon = document.getElementById(folderId + 'Icon');
    
    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        icon.classList.remove('fa-folder');
        icon.classList.add('fa-folder-open');
    } else {
        content.classList.add('hidden');
        icon.classList.remove('fa-folder-open');
        icon.classList.add('fa-folder');
    }
}

async function loadHistory() {
    try {
        console.log('🔄 히스토리 로드 시작...');
        const response = await axios.get('/api/history');
        console.log('✅ 히스토리 API 응답:', response.data);
        console.log('📊 단일 분석:', response.data.single?.length || 0, '개');
        console.log('📊 배치 분석:', response.data.batch?.length || 0, '개');
        
        // 단일 분석 표시
        const singleList = document.getElementById('singleAnalysisList');
        const singleCount = document.getElementById('singleAnalysisCount');
        
        if (response.data.single && response.data.single.length > 0) {
            console.log('✅ 단일 분석 렌더링 중...');
            singleCount.textContent = response.data.single.length;
            singleList.innerHTML = response.data.single.map(analysis => 
                createHistoryItem(analysis, 'single')
            ).join('');
        } else {
            console.log('⚠️  단일 분석 데이터 없음');
            singleCount.textContent = '0';
            singleList.innerHTML = '<p class="text-gray-500 text-sm">분석 히스토리가 없습니다.</p>';
        }
        
        // 배치 분석 표시
        const batchList = document.getElementById('batchAnalysisList');
        const batchCount = document.getElementById('batchAnalysisCount');
        
        if (response.data.batch && response.data.batch.length > 0) {
            batchCount.textContent = response.data.batch.length;
            batchList.innerHTML = response.data.batch.map(analysis => 
                createHistoryItem(analysis, 'batch')
            ).join('');
        } else {
            batchCount.textContent = '0';
            batchList.innerHTML = '<p class="text-gray-500 text-sm">분석 히스토리가 없습니다.</p>';
        }
        
    } catch (error) {
        console.error('히스토리 로드 실패:', error);
        document.getElementById('singleAnalysisList').innerHTML = 
            '<p class="text-red-500 text-sm">히스토리를 불러올 수 없습니다.</p>';
        document.getElementById('batchAnalysisList').innerHTML = 
            '<p class="text-red-500 text-sm">히스토리를 불러올 수 없습니다.</p>';
    }
}

function createHistoryItem(analysis, source) {
    const date = new Date(analysis.created_at).toLocaleString('ko-KR');
    const statusBadge = analysis.status === 'completed' ? 
        '<span class="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-semibold">완료</span>' :
        '<span class="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs font-semibold">대본만</span>';
    
    const sourceBadge = source === 'single' ?
        '<span class="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-semibold">단일</span>' :
        '<span class="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-semibold">배치</span>';
    
    return `
        <div class="border border-gray-200 rounded-lg p-3 hover:shadow-md transition-shadow bg-white">
            <div class="flex justify-between items-start mb-2">
                <div class="flex-1">
                    <h4 class="font-semibold text-gray-800 text-sm">${analysis.title || analysis.video_id}</h4>
                    <p class="text-xs text-gray-500">ID: ${analysis.id} | ${date}</p>
                    ${analysis.channel_name ? `<p class="text-xs text-gray-600">채널: ${analysis.channel_name}</p>` : ''}
                </div>
                <div class="flex items-center space-x-1">
                    ${sourceBadge}
                    ${statusBadge}
                </div>
            </div>
            <div class="space-y-2 mt-3">
                <!-- 첫 번째 줄: 보기/YouTube/보고서/대본 -->
                <div class="flex space-x-2">
                    <button 
                        onclick="viewAnalysis(${analysis.id})" 
                        class="flex-1 bg-blue-500 text-white px-3 py-1.5 rounded text-xs hover:bg-blue-600 transition-colors"
                    >
                        <i class="fas fa-eye mr-1"></i>
                        결과 보기
                    </button>
                    <a 
                        href="${analysis.url}" 
                        target="_blank" 
                        class="flex-1 bg-red-500 text-white px-3 py-1.5 rounded text-xs hover:bg-red-600 transition-colors text-center"
                    >
                        <i class="fab fa-youtube mr-1"></i>
                        YouTube
                    </a>
                    ${analysis.status === 'completed' ? `
                        <button 
                            onclick="downloadReport(${analysis.id})" 
                            class="flex-1 bg-green-500 text-white px-3 py-1.5 rounded text-xs hover:bg-green-600 transition-colors"
                        >
                            <i class="fas fa-download mr-1"></i>
                            보고서
                        </button>
                    ` : ''}
                    <button 
                        onclick="downloadTranscript(${analysis.id}, '${analysis.video_id}')" 
                        class="flex-1 bg-gray-500 text-white px-3 py-1.5 rounded text-xs hover:bg-gray-600 transition-colors"
                    >
                        <i class="fas fa-file-alt mr-1"></i>
                        대본
                    </button>
                </div>
                <!-- 두 번째 줄: 이메일/구글드라이브 전송 -->
                <div class="flex space-x-2">
                    <button 
                        onclick="sendToEmail(${analysis.id}, '${source}')" 
                        class="flex-1 bg-purple-500 text-white px-3 py-1.5 rounded text-xs hover:bg-purple-600 transition-colors"
                    >
                        <i class="fas fa-envelope mr-1"></i>
                        이메일 전송
                    </button>
                    <button 
                        onclick="sendToDrive(${analysis.id}, '${source}')" 
                        class="flex-1 bg-indigo-500 text-white px-3 py-1.5 rounded text-xs hover:bg-indigo-600 transition-colors"
                    >
                        <i class="fab fa-google-drive mr-1"></i>
                        드라이브 전송
                    </button>
                </div>
            </div>
        </div>
    `;
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
        const analysis = response.data;
        
        if (analysis) {
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

// ==================== 페이지 로드 시 실행 ====================
window.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 페이지 로드 완료');
    loadHistory();
});

// ==================== 이메일/드라이브 전송 ====================

// 이메일 전송 함수
async function sendToEmail(analysisId, source) {
    const email = prompt('이메일 주소를 입력하세요:', localStorage.getItem('lastEmail') || '');
    
    if (!email) {
        return;
    }
    
    // 이메일 주소 저장
    localStorage.setItem('lastEmail', email);
    
    try {
        showLoading('이메일 전송 중...');
        
        const endpoint = source === 'batch' 
            ? `/api/send-email/batch/${analysisId}`
            : `/api/send-email/single/${analysisId}`;
        
        const response = await axios.post(endpoint, { email });
        
        hideLoading();
        
        if (response.data.success) {
            showSuccess(response.data.message);
        } else {
            showError(response.data.error || '이메일 전송 실패');
        }
    } catch (error) {
        hideLoading();
        console.error('이메일 전송 오류:', error);
        showError('이메일 전송 실패: ' + (error.response?.data?.error || error.message));
    }
}

// 구글드라이브 전송 함수
async function sendToDrive(analysisId, source) {
    const driveFolder = prompt('구글드라이브 폴더 이름을 입력하세요 (선택사항):', localStorage.getItem('lastDriveFolder') || '');
    
    // 취소를 누르면 null이 반환되므로 확인
    if (driveFolder === null) {
        return;
    }
    
    // 폴더 이름 저장
    if (driveFolder) {
        localStorage.setItem('lastDriveFolder', driveFolder);
    }
    
    try {
        showLoading('구글드라이브 전송 중...');
        
        const endpoint = source === 'batch' 
            ? `/api/send-drive/batch/${analysisId}`
            : `/api/send-drive/single/${analysisId}`;
        
        const response = await axios.post(endpoint, { driveFolder: driveFolder || '' });
        
        hideLoading();
        
        if (response.data.success) {
            showSuccess(response.data.message);
        } else {
            showError(response.data.error || '드라이브 전송 실패');
        }
    } catch (error) {
        hideLoading();
        console.error('드라이브 전송 오류:', error);
        showError('드라이브 전송 실패: ' + (error.response?.data?.error || error.message));
    }
}

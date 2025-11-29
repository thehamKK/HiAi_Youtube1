#!/usr/bin/env python3
import json
import subprocess
import os
import zipfile
from pathlib import Path

OUTPUT_DIR = Path("/home/user/webapp/completed_analyses")
ZIP_FILE = Path("/home/user/webapp/completed_analyses.zip")

# 출력 디렉토리 생성
OUTPUT_DIR.mkdir(exist_ok=True)

print("📊 완료된 분석 파일 추출 중...")

# D1 데이터베이스에서 완료된 분석 조회
cmd = [
    "npx", "wrangler", "d1", "execute", "hidb-production", "--local",
    "--command",
    """SELECT 
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
    LIMIT 200"""
]

try:
    result = subprocess.run(cmd, capture_output=True, text=True, cwd="/home/user/webapp")
    
    # wrangler 출력에서 JSON 부분만 추출
    output = result.stdout
    
    # JSON 배열 찾기
    json_start = output.find('[')
    if json_start == -1:
        print("❌ JSON 데이터를 찾을 수 없습니다")
        exit(1)
    
    json_data = output[json_start:]
    data = json.loads(json_data)
    
    # 첫 번째 결과 세트의 results 추출
    if data and len(data) > 0 and 'results' in data[0]:
        analyses = data[0]['results']
        
        print(f"📁 {len(analyses)}개 분석 파일 생성 중...")
        
        file_count = 0
        for analysis in analyses:
            aid = analysis.get('id', '')
            title = analysis.get('title', 'Untitled')
            video_id = analysis.get('video_id', '')
            upload_date = analysis.get('upload_date', '').replace('-', '')
            transcript = analysis.get('transcript', '')
            summary = analysis.get('summary', '')
            
            # 파일명에서 특수문자 제거 (한글, 영문, 숫자만 유지)
            import re
            clean_title = re.sub(r'[^가-힣a-zA-Z0-9\s]', '', title)[:30]
            clean_title = clean_title.strip().replace(' ', '_')
            
            # 파일명 생성
            filename_prefix = f"{upload_date}_{clean_title}_{video_id}"
            
            # 요약보고서 저장
            if summary:
                summary_file = OUTPUT_DIR / f"{filename_prefix}_요약보고서.txt"
                summary_file.write_text(summary, encoding='utf-8')
                file_count += 1
            
            # 대본전문 저장
            if transcript:
                transcript_file = OUTPUT_DIR / f"{filename_prefix}_대본전문.txt"
                transcript_file.write_text(transcript, encoding='utf-8')
                file_count += 1
            
            print(f"✅ ID {aid}: {clean_title[:20]}")
        
        # ZIP 파일 생성
        print("\n📦 ZIP 파일 생성 중...")
        with zipfile.ZipFile(ZIP_FILE, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for txt_file in OUTPUT_DIR.glob("*.txt"):
                zipf.write(txt_file, arcname=f"completed_analyses/{txt_file.name}")
        
        zip_size = ZIP_FILE.stat().st_size / 1024 / 1024  # MB
        
        print("\n✅ 추출 완료!")
        print(f"📁 총 파일 수: {file_count}")
        print(f"📁 분석 건수: {len(analyses)}")
        print(f"📦 ZIP 크기: {zip_size:.2f} MB")
        print(f"📍 ZIP 파일 경로: {ZIP_FILE}")
        
    else:
        print("❌ 데이터베이스에서 결과를 찾을 수 없습니다")
        
except Exception as e:
    print(f"❌ 오류 발생: {e}")
    import traceback
    traceback.print_exc()

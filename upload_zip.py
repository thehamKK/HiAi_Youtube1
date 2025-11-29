#!/usr/bin/env python3
import requests
import sys

zip_file_path = "/home/user/webapp/completed_analyses.zip"
upload_url = "https://www.genspark.ai/api/files/upload"

try:
    with open(zip_file_path, 'rb') as f:
        files = {'file': ('completed_analyses_120files.zip', f, 'application/zip')}
        response = requests.post(upload_url, files=files, timeout=180)
        
        print("Status Code:", response.status_code)
        print("Response:", response.text)
        
        if response.status_code == 200:
            result = response.json()
            download_url = result.get('url') or result.get('download_url') or result.get('file_url')
            if download_url:
                print(f"\n✅ 업로드 성공!")
                print(f"📥 다운로드 URL: {download_url}")
            else:
                print("\n⚠️ 업로드되었으나 다운로드 URL을 찾을 수 없습니다")
                print("응답 데이터:", result)
        else:
            print(f"\n❌ 업로드 실패: {response.status_code}")
            
except Exception as e:
    print(f"❌ 오류 발생: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

module.exports = {
  apps: [
    {
      name: 'hidb',
      script: 'npx',
      args: 'wrangler pages dev dist --d1=hidb-production --local --ip 0.0.0.0 --port 3000',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
        NODE_OPTIONS: '--max-old-space-size=256'
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      // 메모리 기반 자동 재시작 (700MB 초과 시)
      max_memory_restart: '700M',
      // 시간 기반 자동 재시작 (30분마다)
      cron_restart: '*/30 * * * *',
      // 최소 가동 시간 (30초 이상 돌아야 정상)
      min_uptime: '30s',
      // 1시간당 최대 재시작 횟수 (무한 재시작 방지)
      max_restarts: 20,
      // 재시작 간격 (3초)
      restart_delay: 3000,
      // 자동 재시작 활성화
      autorestart: true,
      // 프로세스 종료 타임아웃 (5초)
      kill_timeout: 5000,
      // 로그 설정
      error_file: '/home/user/.pm2/logs/hidb-error.log',
      out_file: '/home/user/.pm2/logs/hidb-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      // 로그 파일 최대 크기 (10MB)
      max_size: '10M',
      // 로그 파일 보관 개수
      retain: 3
    }
  ]
}

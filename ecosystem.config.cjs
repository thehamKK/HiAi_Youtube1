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
      max_memory_restart: '300M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      autorestart: true,
      kill_timeout: 3000,
      error_file: '/home/user/.pm2/logs/hidb-error.log',
      out_file: '/home/user/.pm2/logs/hidb-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
}

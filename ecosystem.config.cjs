module.exports = {
  apps: [{
    name: 'bot-x-posts',
    script: 'scripts/cron-daemon.js',
    cwd: '/Users/user/AppsCalude/Bot-X-Posts',
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    env: {
      NODE_ENV: 'production'
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: 'logs/error.log',
    out_file: 'logs/output.log',
    merge_logs: true
  }]
}

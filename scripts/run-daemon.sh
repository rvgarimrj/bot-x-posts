#!/bin/bash
cd /Users/user/AppsCalude/Bot-X-Posts

# Carrega variáveis de ambiente
export $(cat .env | grep -v '^#' | xargs)

# Desativa App Nap para este processo
defaults write com.botxposts.daemon NSAppSleepDisabled -bool YES 2>/dev/null || true

# Aguarda Chrome estar pronto
sleep 10

# Log de inicio
echo "$(date): Daemon iniciando..." >> logs/daemon.log

# Executa o daemon
exec /usr/local/bin/node scripts/cron-daemon.js

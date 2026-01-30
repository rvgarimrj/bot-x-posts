#!/bin/bash
cd /Users/user/AppsCalude/Bot-X-Posts

PIDFILE="logs/daemon.pid"
LOGFILE="logs/daemon.log"

# Verifica se ja existe uma instancia rodando
if [ -f "$PIDFILE" ]; then
  OLD_PID=$(cat "$PIDFILE")
  if ps -p "$OLD_PID" > /dev/null 2>&1; then
    echo "$(date): Daemon ja rodando (PID $OLD_PID), saindo..." >> "$LOGFILE"
    exit 0
  fi
fi

# Mata qualquer processo orfao do daemon
pkill -f "cron-daemon.js" 2>/dev/null || true
sleep 2

# Carrega variáveis de ambiente
export $(cat .env | grep -v '^#' | xargs)

# Desativa App Nap para este processo
defaults write com.botxposts.daemon NSAppSleepDisabled -bool YES 2>/dev/null || true

# Aguarda Chrome estar pronto
sleep 5

# Log de inicio
echo "$(date): Daemon iniciando..." >> "$LOGFILE"

# Salva PID
echo $$ > "$PIDFILE"

# Cleanup ao sair
trap "rm -f $PIDFILE" EXIT

# Executa o daemon
exec /usr/local/bin/node scripts/cron-daemon.js

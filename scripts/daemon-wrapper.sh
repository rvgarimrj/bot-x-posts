#!/bin/bash
# Daemon Wrapper with caffeinate
# Prevents macOS from suspending the daemon when screen is locked
#
# caffeinate flags:
# -i = prevent idle sleep
# -s = prevent system sleep (requires AC power)
# -w = wait for process to finish (attached to child PID)
#
# Usage: ./scripts/daemon-wrapper.sh
#

cd /Users/user/AppsCalude/Bot-X-Posts

# Log startup
echo "[WRAPPER] Starting daemon with caffeinate..."
echo "[WRAPPER] Working directory: $(pwd)"
echo "[WRAPPER] Time: $(date)"

# Run node daemon with caffeinate -i (prevent idle sleep)
# This keeps the process active even when screen is locked
exec caffeinate -i /usr/local/bin/node scripts/cron-daemon-v2.js

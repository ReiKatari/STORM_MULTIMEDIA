#!/bin/bash
# ========================================================
# STORM MULTIMEDIA - Скрипт автозапуска и сторож для Synology NAS
# ========================================================

export PATH=$PATH:/usr/local/bin:/var/packages/Node.js_v20/target/usr/local/bin:/var/packages/Node.js_v18/target/usr/local/bin
export PORT=3900

PROJECT_DIR="/volume1/WEBSITES/STORM MULTIMEDIA"
cd "$PROJECT_DIR" || exit 1

# Завершаем старые процессы, если они были
pkill -f "node.*server.js" || true
sleep 1

# Запуск вечного демона-сторожа в фоне с автоматическим восстановлением
nohup bash -c '
until node server.js; do
  EXIT_CODE=$?
  echo "[$(date "+%Y-%m-%d %H:%M:%S")] Сервер STORM MULTIMEDIA завершился с кодом $EXIT_CODE. Авто-перезапуск через 3 сек..." >> "'"$PROJECT_DIR"'/daemon.log"
  sleep 3
done
' >/dev/null 2>&1 &

#!/bin/bash
# ========================================================
# STORM MULTIMEDIA - Скрипт автозапуска и сторож для Synology NAS
# ========================================================

export PATH=$PATH:/usr/local/bin:/usr/bin:/bin:/var/packages/Node.js_v22/target/usr/local/bin:/var/packages/Node.js_v20/target/usr/local/bin:/var/packages/Node.js_v18/target/usr/local/bin
export PORT=3900
export NODE_ENV=production

PROJECT_DIR="/volume1/WEBSITES/STORM MULTIMEDIA"
cd "$PROJECT_DIR" || exit 1

# Завершаем старые процессы именно STORM MULTIMEDIA, не затрагивая другие проекты
fuser -k 3900/tcp || true
pkill -f "STORM MULTIMEDIA.*server.js" || true
pkill -f "STORM MULTIMEDIA.*watchdog.js" || true
sleep 1

# Запуск вечного демона-сторожа в фоне с автоматическим восстановлением
nohup bash -c '
echo "[$(date "+%Y-%m-%d %H:%M:%S")] Запуск демона STORM MULTIMEDIA на порту 3900..." >> "'"$PROJECT_DIR"'/daemon.log"
until node watchdog.js || node server.js; do
  EXIT_CODE=$?
  echo "[$(date "+%Y-%m-%d %H:%M:%S")] Сервер STORM MULTIMEDIA завершился с кодом $EXIT_CODE. Авто-перезапуск через 3 сек..." >> "'"$PROJECT_DIR"'/daemon.log"
  sleep 3
done
' >> "$PROJECT_DIR/daemon.log" 2>&1 &

echo "STORM MULTIMEDIA демон запущен в фоне (лог: $PROJECT_DIR/daemon.log)"

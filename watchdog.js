/**
 * STORM MULTIMEDIA - Автоматический супервизор и сторож (Watchdog Supervisor)
 * 
 * Особенности:
 * - Автоматический перезапуск сервера при любых падениях, сбоях и кодах выхода.
 * - Мгновенный перезапуск при вызове административного рестарта (/api/admin/restart).
 * - Защита от зацикливания при фатальных ошибках (Rapid Crash Protection).
 * - Активный фоновый мониторинг здоровья (Healthcheck Ping) каждые 15 секунд.
 * - Корректный перехват и проброс системных сигналов SIGINT/SIGTERM.
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_SCRIPT = path.join(__dirname, 'server.js');
const PORT = process.env.PORT || 3900;
const HEALTHCHECK_INTERVAL_MS = 15000;
const HEALTHCHECK_TIMEOUT_MS = 5000;
const MAX_CONSECUTIVE_FAILURES = 4;
const RAPID_RESTART_WINDOW_MS = 10000;
const MAX_RAPID_RESTARTS = 5;

let currentChild = null;
let isShuttingDown = false;
let restartHistory = [];
let consecutiveHealthFailures = 0;
let healthCheckTimer = null;
let serverWasEverHealthy = false;

function log(msg) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${timestamp}] [STORM WATCHDOG] ${msg}`);
}

function checkHealth() {
  if (isShuttingDown || !currentChild) return;

  const req = http.get(`http://127.0.0.1:${PORT}/api/health`, { timeout: HEALTHCHECK_TIMEOUT_MS }, (res) => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      consecutiveHealthFailures = 0;
      serverWasEverHealthy = true;
    } else {
      consecutiveHealthFailures++;
      log(`⚠️ Healthcheck вернул статус ${res.statusCode} (сбой #${consecutiveHealthFailures})`);
      evaluateHealthFailures();
    }
    res.resume();
  });

  req.on('timeout', () => {
    req.destroy();
    consecutiveHealthFailures++;
    log(`⚠️ Healthcheck таймаут (> ${HEALTHCHECK_TIMEOUT_MS}мс, сбой #${consecutiveHealthFailures})`);
    evaluateHealthFailures();
  });

  req.on('error', (err) => {
    // В процессе первоначального запуска сервер может быть не готов
    if (serverWasEverHealthy) {
      consecutiveHealthFailures++;
      log(`⚠️ Healthcheck ошибка соединения: ${err.message} (сбой #${consecutiveHealthFailures})`);
      evaluateHealthFailures();
    }
  });
}

function evaluateHealthFailures() {
  if (consecutiveHealthFailures >= MAX_CONSECUTIVE_FAILURES && serverWasEverHealthy && !isShuttingDown) {
    log(`🚨 Сервер не отвечает более ${MAX_CONSECUTIVE_FAILURES} проверок подряд! Принудительный перезапуск зависшего процесса...`);
    consecutiveHealthFailures = 0;
    if (currentChild) {
      try {
        currentChild.kill('SIGKILL');
      } catch (e) {
        log(`Ошибка завершения зависшего процесса: ${e.message}`);
      }
    }
  }
}

function isRapidRestartLoop() {
  const now = Date.now();
  restartHistory.push(now);
  restartHistory = restartHistory.filter(t => now - t <= RAPID_RESTART_WINDOW_MS);
  return restartHistory.length >= MAX_RAPID_RESTARTS;
}

function startServer() {
  if (isShuttingDown) return;

  const isRapid = isRapidRestartLoop();
  const cooldownMs = isRapid ? 8000 : 1000;

  if (isRapid) {
    log(`⚠️ Обнаружено частое падение процесса (> ${MAX_RAPID_RESTARTS} раз за ${RAPID_RESTART_WINDOW_MS / 1000}с). Охлаждение ${cooldownMs / 1000}с перед перезапуском...`);
  }

  setTimeout(() => {
    if (isShuttingDown) return;

    log(`🚀 Запуск процесса сервера: ${SERVER_SCRIPT}...`);
    consecutiveHealthFailures = 0;
    serverWasEverHealthy = false;

    const child = spawn(process.execPath, [SERVER_SCRIPT], {
      cwd: __dirname,
      stdio: 'inherit',
      env: {
        ...process.env,
        STORM_WATCHDOG_MANAGED: '1',
        PORT: String(PORT)
      }
    });

    currentChild = child;
    log(`✅ Дочерний процесс запущен (PID: ${child.pid}) на порту ${PORT}`);

    child.on('exit', (code, signal) => {
      currentChild = null;
      log(`ℹ️ Процесс сервера (PID: ${child.pid}) завершился (код: ${code}, сигнал: ${signal || 'none'})`);

      if (isShuttingDown) {
        log('Сторож завершает работу в штатном режиме.');
        process.exit(0);
        return;
      }

      log('🔄 Автоматический перезапуск сервера через 1 секунду...');
      startServer();
    });

    child.on('error', (err) => {
      log(`❌ Ошибка запуска дочернего процесса: ${err.message}`);
    });
  }, cooldownMs);
}

// Запуск таймера healthcheck
healthCheckTimer = setInterval(checkHealth, HEALTHCHECK_INTERVAL_MS);

// Обработка сигналов завершения супервизора
function handleShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log(`Получен сигнал ${signal}. Завершение работы супервизора и остановка сервера...`);

  if (healthCheckTimer) clearInterval(healthCheckTimer);

  if (currentChild) {
    try {
      currentChild.kill('SIGTERM');
      setTimeout(() => {
        if (currentChild) {
          try { currentChild.kill('SIGKILL'); } catch (_) {}
        }
        process.exit(0);
      }, 3000);
    } catch (_) {
      process.exit(0);
    }
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// Перехват неожиданных ошибок самого сторожа
process.on('uncaughtException', (err) => {
  log(`Критическая ошибка супервизора: ${err?.stack || err}`);
});

process.on('unhandledRejection', (reason) => {
  log(`Необработанный промис в супервизоре: ${reason}`);
});

log(`========================================================`);
log(`🛡️ STORM MULTIMEDIA - СТОРОЖ АВТОПЕРЕЗАПУСКА АКТИВИРОВАН`);
log(`Порт: ${PORT} | Интервал проверки: ${HEALTHCHECK_INTERVAL_MS / 1000}с`);
log(`========================================================`);

startServer();

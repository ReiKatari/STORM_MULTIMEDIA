/**
 * STORM MULTIMEDIA 1.2.0 — Структурированный JSON-логгер (Пункт 6.5)
 * Трассировка запросов по X-Request-Id и кольцевой буфер логов для админ-панели.
 */
import crypto from 'node:crypto';

const recentLogsRing = [];
const MAX_RING_LOGS = 250;

function writeEntry(level, msg, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: String(msg || ''),
    ...meta
  };
  recentLogsRing.push(entry);
  if (recentLogsRing.length > MAX_RING_LOGS) {
    recentLogsRing.shift();
  }
  if (level === 'error' || level === 'fatal') {
    console.error(JSON.stringify(entry));
  } else if (process.env.STORM_JSON_LOGS === '1') {
    console.log(JSON.stringify(entry));
  }
  return entry;
}

export const logger = {
  info: (msg, meta) => writeEntry('info', msg, meta),
  warn: (msg, meta) => writeEntry('warn', msg, meta),
  error: (msg, meta) => writeEntry('error', msg, meta),
  debug: (msg, meta) => writeEntry('debug', msg, meta)
};

export function getRecentLogs(limit = 100) {
  return recentLogsRing.slice(-Math.min(Math.max(Number(limit) || 100, 1), MAX_RING_LOGS)).reverse();
}

export function requestTracingMiddleware(req, res, next) {
  const reqId = req.headers['x-request-id'] || crypto.randomUUID();
  req.requestId = reqId;
  res.setHeader('X-Request-Id', reqId);
  next();
}

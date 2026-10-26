/**
 * STORM MULTIMEDIA 1.2.0 — Демон мониторинга балансеров и HTTP Keep-Alive (Пункты 1.4, 6.9)
 * Поддерживает постоянные соединения (maxSockets: 64) и автоматический фейловер источников.
 */
import http from 'node:http';
import https from 'node:https';

export const globalHttpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 64,
  maxFreeSockets: 16
});

export const globalHttpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 64,
  maxFreeSockets: 16
});

const BALANCER_TARGETS = [
  { id: 'lift_adfree', name: 'Lift 4K Ad-Free', url: 'https://api.liftw.ws' },
  { id: 'fanfilm4k_uhd', name: 'FanFilm 4K UHD', url: 'https://fanfilm.tv' },
  { id: 'kodik_direct', name: 'Kodik Anime CDN', url: 'https://kodikapi.com' },
  { id: 'tmdb_meta', name: 'TMDB API', url: 'https://api.themoviedb.org/3/configuration' }
];

const balancerStatusMap = new Map(
  BALANCER_TARGETS.map(b => [
    b.id,
    { id: b.id, name: b.name, status: 'healthy', latency: 35, lastCheck: Date.now(), failures: 0 }
  ])
);

let healthInterval = null;
let preprobeInterval = null;

export async function pingSingleBalancer(target) {
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    const res = await fetch(target.url, { method: 'HEAD', signal: ctrl.signal }).catch(() => null);
    clearTimeout(timer);
    const latency = Date.now() - start;
    const prev = balancerStatusMap.get(target.id) || { failures: 0 };
    if (res && res.status < 502) {
      const entry = { id: target.id, name: target.name, status: 'healthy', latency, lastCheck: Date.now(), failures: 0 };
      balancerStatusMap.set(target.id, entry);
      return entry;
    }
    const failures = (prev.failures || 0) + 1;
    const entry = {
      id: target.id,
      name: target.name,
      status: failures >= 3 ? 'degraded' : 'healthy',
      latency,
      lastCheck: Date.now(),
      failures
    };
    balancerStatusMap.set(target.id, entry);
    return entry;
  } catch {
    const prev = balancerStatusMap.get(target.id) || { failures: 0 };
    const failures = (prev.failures || 0) + 1;
    const entry = {
      id: target.id,
      name: target.name,
      status: failures >= 3 ? 'degraded' : 'healthy',
      latency: 999,
      lastCheck: Date.now(),
      failures
    };
    balancerStatusMap.set(target.id, entry);
    return entry;
  }
}

export async function runBalancerHealthChecks() {
  await Promise.allSettled(BALANCER_TARGETS.map(t => pingSingleBalancer(t)));
  return getBalancerHealthSnapshot();
}

export const checkAllBalancersHealth = runBalancerHealthChecks;

export function getBalancerHealthSnapshot() {
  const out = {};
  for (const [k, v] of balancerStatusMap.entries()) {
    out[k] = { ...v };
  }
  return out;
}

export const getBalancerHealthOverview = getBalancerHealthSnapshot;

export function getPreferredBalancerOrder() {
  return Array.from(balancerStatusMap.values())
    .sort((a, b) => {
      if (a.status === 'healthy' && b.status !== 'healthy') return -1;
      if (a.status !== 'healthy' && b.status === 'healthy') return 1;
      return (a.latency || 50) - (b.latency || 50);
    })
    .map(x => x.id);
}

export function startBalancerDaemons(preprobeCallback) {
  if (healthInterval) clearInterval(healthInterval);
  if (preprobeInterval) clearInterval(preprobeInterval);

  healthInterval = setInterval(() => {
    runBalancerHealthChecks().catch(() => {});
  }, 1000 * 60 * 5);
  healthInterval.unref?.();

  if (typeof preprobeCallback === 'function') {
    preprobeInterval = setInterval(() => {
      Promise.resolve(preprobeCallback()).catch(() => {});
    }, 1000 * 60 * 15);
    preprobeInterval.unref?.();
  }
}

export function stopBalancerDaemons() {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
  if (preprobeInterval) {
    clearInterval(preprobeInterval);
    preprobeInterval = null;
  }
}

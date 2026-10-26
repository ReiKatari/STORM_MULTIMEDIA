/**
 * STORM MULTIMEDIA 1.2.0 — Двухслойный In-Memory L1 LRU-кэш (Пункт 1.2)
 * Лимит памяти по умолчанию: 250 МБ, поддержка TTL, префиксной инвалидации и метрик Hit/Miss.
 */
export class StormLruCache {
  constructor(options = {}) {
    this.maxBytes = Number(options.maxBytes) || 250 * 1024 * 1024;
    this.defaultTtlMs = Number(options.defaultTtlMs) || 1000 * 60 * 15;
    this.store = new Map();
    this.currentBytes = 0;
    this.hits = 0;
    this.misses = 0;
  }

  _estimateSize(val) {
    if (val === null || val === undefined) return 8;
    if (Buffer.isBuffer(val)) return val.length;
    if (val && Buffer.isBuffer(val.buffer)) return val.buffer.length + 64;
    if (typeof val === 'string') return val.length * 2;
    try {
      return Buffer.byteLength(JSON.stringify(val), 'utf8');
    } catch {
      return 256;
    }
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.delete(key);
      this.misses++;
      return undefined;
    }
    // Перемещение в конец Map (MRU)
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    if (this.store.has(key)) {
      this.delete(key);
    }
    const size = this._estimateSize(value);
    if (size > this.maxBytes * 0.5) {
      return false;
    }
    while (this.currentBytes + size > this.maxBytes && this.store.size > 0) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.delete(oldestKey);
    }
    this.store.set(key, {
      value,
      size,
      expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0
    });
    this.currentBytes += size;
    return true;
  }

  delete(key) {
    const entry = this.store.get(key);
    if (!entry) return false;
    this.currentBytes = Math.max(0, this.currentBytes - (entry.size || 0));
    return this.store.delete(key);
  }

  invalidatePrefix(prefix) {
    let removed = 0;
    for (const k of Array.from(this.store.keys())) {
      if (String(k).startsWith(prefix)) {
        this.delete(k);
        removed++;
      }
    }
    return removed;
  }

  clear() {
    this.store.clear();
    this.currentBytes = 0;
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      entries: this.store.size,
      usedBytes: this.currentBytes,
      usedMb: Math.round((this.currentBytes / (1024 * 1024)) * 100) / 100,
      maxMb: Math.round((this.maxBytes / (1024 * 1024)) * 100) / 100,
      hits: this.hits,
      misses: this.misses,
      hitRatePercent: total > 0 ? Math.round((this.hits / total) * 1000) / 10 : 100
    };
  }
}

export const l1Cache = new StormLruCache({
  maxBytes: 250 * 1024 * 1024,
  defaultTtlMs: 1000 * 60 * 15
});

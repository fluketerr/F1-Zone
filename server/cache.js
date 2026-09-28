/**
 * In-memory TTL cache พร้อม de-duplicate คำขอพร้อมกัน (in-flight dedup)
 * - get/set แบบ LRU-touch
 * - wrap(key, ttl, loader): ถ้ามีคนกำลังโหลด key เดียวกันอยู่ จะได้ Promise เดียวกัน
 */
export function createCache({ defaultTtlMs = 60_000, maxEntries = 800 } = {}) {
  const store = new Map();
  const inflight = new Map();

  function get(key) {
    const hit = store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }
    store.delete(key);
    store.set(key, hit); // LRU touch
    return hit.value;
  }

  function set(key, value, ttlMs = defaultTtlMs) {
    if (store.size >= maxEntries) {
      const oldest = store.keys().next().value;
      if (oldest !== undefined) store.delete(oldest);
    }
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  function wrap(key, ttlMs, loader) {
    const hit = get(key);
    if (hit !== undefined) return Promise.resolve(hit);
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      try {
        const value = await loader();
        set(key, value, ttlMs);
        return value;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  }

  function stats() {
    return { entries: store.size, inflight: inflight.size };
  }

  function clear() {
    store.clear();
    inflight.clear();
  }

  return { get, set, wrap, stats, clear };
}

export const globalCache = createCache({ defaultTtlMs: 5 * 60_000 });

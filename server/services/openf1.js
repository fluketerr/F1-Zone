import { config } from '../config.js';
import { globalCache } from '../cache.js';

export class OpenF1Error extends Error {
  constructor(message, { status = 502, path } = {}) {
    super(message);
    this.name = 'OpenF1Error';
    this.status = status;
    this.path = path;
  }
}

/* ---- Rate limiting: OpenF1 อนุญาต 3 req/s (ไม่ใส่ token) → คิวอนุกรมเว้นระยะ ---- */
let chain = Promise.resolve();
let lastRequestAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function throttled(runner) {
  const task = chain.then(async () => {
    const wait = lastRequestAt + config.openf1.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return runner();
  });
  chain = task.then(() => {}, () => {}); // รักษาสายคิวให้เดินต่อแม้ task ล้ม
  return task;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.openf1.timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, statusText: res.statusText, data };
  } finally {
    clearTimeout(timer);
  }
}

/** ลองใหม่เมื่อโดน 429 (rate limit) — ถอยหลังแบบ exponential */
async function fetchWithRetry(url) {
  const backoffs = [1200, 2600];
  let last;
  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    last = await fetchJson(url);
    if (last.status !== 429) return last;
    if (attempt < backoffs.length) await sleep(backoffs[attempt]);
  }
  return last;
}

const TTL_BY_PATH = [
  ['/v1/meetings', () => config.cacheTtls.meetings],
  ['/v1/sessions', () => config.cacheTtls.sessions],
  ['/v1/drivers', () => config.cacheTtls.drivers],
  ['/v1/session_result', () => config.cacheTtls.sessionResult],
  ['/v1/position', () => config.cacheTtls.position],
];

function ttlForPath(path) {
  for (const [prefix, getTtl] of TTL_BY_PATH) {
    if (path.startsWith(prefix)) return getTtl();
  }
  return 5 * 60_000;
}

/**
 * เรียก OpenF1 API พร้อม cache — session_key ใช้ "latest" ได้
 * @param {string} path เช่น '/v1/meetings'
 * @param {Record<string, string|number>} params query params
 * @param {{ ttlMs?: number }} [opts]
 */
export async function openf1(path, params = {}, opts = {}) {
  const url = new URL(path, config.openf1.baseUrl);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const key = url.toString();
  const ttl = opts.ttlMs ?? ttlForPath(path);

  return globalCache.wrap(key, ttl, async () => {
    let res;
    try {
      res = await throttled(() => fetchWithRetry(key));
    } catch (err) {
      const reason = err?.name === 'AbortError' ? 'timeout' : err?.message ?? 'network error';
      throw new OpenF1Error(`OpenF1 request failed: ${path} (${reason})`, { path });
    }
    if (!res.ok) {
      throw new OpenF1Error(`OpenF1 ${res.status} ${res.statusText}: ${path}`, {
        status: res.status >= 500 ? 502 : res.status,
        path,
      });
    }
    if (res.data === null) {
      throw new OpenF1Error(`OpenF1 returned invalid JSON: ${path}`, { path });
    }
    return res.data;
  });
}

export const openf1Api = {
  meetings: (year) => openf1('/v1/meetings', { year }),
  sessions: (year, extra = {}) => openf1('/v1/sessions', { year, ...extra }),
  drivers: (sessionKey) => openf1('/v1/drivers', { session_key: sessionKey }),
  sessionResult: (sessionKey, opts) => openf1('/v1/session_result', { session_key: sessionKey }, opts),
  positions: (sessionKey) => openf1('/v1/position', { session_key: sessionKey }),
};

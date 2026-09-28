export class ApiError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status ?? 0;
  }
}

async function get(path, { timeoutMs = 20_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new ApiError(`${path} → HTTP ${res.status}`, { status: res.status });
    return await res.json();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(`${path} → ${err?.name === 'AbortError' ? 'timeout' : err?.message ?? 'network error'}`);
  } finally {
    clearTimeout(timer);
  }
}

const qs = (year) => (year != null ? `?year=${encodeURIComponent(year)}` : '');

export const api = {
  health: () => get('/api/health', { timeoutMs: 5000 }),
  next: (year) => get(`/api/next${qs(year)}`),
  meetings: (year) => get(`/api/meetings${qs(year)}`),
  grid: () => get('/api/grid'),
  season: (year) => get(`/api/season${qs(year)}`, { timeoutMs: 45_000 }), // ครั้งแรกอาจคำนวณนาน
  live: () => get('/api/live'),
};

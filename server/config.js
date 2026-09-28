const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const config = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  season: process.env.SEASON ? Number(process.env.SEASON) : new Date().getFullYear(),
  openf1: {
    baseUrl: process.env.OPENF1_BASE_URL || 'https://api.openf1.org',
    // OpenF1 จำกัดอัตราคำขอ (โดน 429 ได้ง่าย) — เว้นระยะพอสมควรทุกคำขอ
    minIntervalMs: Number(process.env.OPENF1_MIN_INTERVAL_MS) || 700,
    timeoutMs: Number(process.env.OPENF1_TIMEOUT_MS) || 12_000,
  },
  cacheTtls: {
    meetings: 6 * HOUR,
    sessions: 6 * HOUR,
    drivers: 10 * MIN,
    sessionResult: 10 * MIN,
    sessionResultPast: 7 * DAY, // ผลของเซสชันที่จบไปแล้วไม่เปลี่ยน
    position: 5_000,            // ตำแหน่งสด ใช้ TTL สั้น
    season: 10 * MIN,
    grid: 10 * MIN,
  },
};

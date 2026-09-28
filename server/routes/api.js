import { Router } from 'express';
import { config } from '../config.js';
import { OpenF1Error, openf1Api } from '../services/openf1.js';
import { getSeasonSummary, slimSession } from '../services/season.js';
import { getGrid } from '../services/grid.js';
import { flagOf } from '../data/flags.js';

const router = Router();
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const isGP = (m) => m.meeting_name !== 'Pre-Season Testing' && !m.is_cancelled;

function slimMeeting(m, round) {
  return {
    meetingKey: m.meeting_key,
    round,
    name: m.meeting_name,
    officialName: m.meeting_official_name,
    countryName: m.country_name,
    countryCode: m.country_code,
    flag: flagOf(m.country_code),
    circuit: m.circuit_short_name,
    location: m.location,
    dateStart: m.date_start,
    dateEnd: m.date_end,
    gmtOffset: m.gmt_offset,
  };
}

router.get('/health', (req, res) => {
  res.json({ ok: true, uptimeSec: Math.round(process.uptime()), season: config.season });
});

/** ปฏิทินการแข่งขัน (เฉพาะสนามเรซ ไม่รวมทดสอบ) */
router.get('/meetings', asyncH(async (req, res) => {
  const year = Number(req.query.year) || config.season;
  const meetings = (await openf1Api.meetings(year)).filter(isGP);
  const now = Date.now();
  res.json({
    year,
    count: meetings.length,
    meetings: meetings.map((m, i) => ({
      ...slimMeeting(m, i + 1),
      isPast: new Date(m.date_end).getTime() < now,
    })),
  });
}));

/** สนามถัดไป (สำหรับนับถอยหลัง) */
router.get('/next', asyncH(async (req, res) => {
  const year = Number(req.query.year) || config.season;
  const meetings = (await openf1Api.meetings(year)).filter(isGP);
  const now = Date.now();
  const upcoming = meetings.find((m) => new Date(m.date_start).getTime() > now);
  if (!upcoming) {
    return res.json({ year, next: null, message: 'ฤดูกาลนี้จบการแข่งขันแล้ว' });
  }
  let session = null;
  try {
    const ss = await openf1Api.sessions(year, {
      meeting_key: upcoming.meeting_key,
      session_type: 'Race',
      session_name: 'Race',
    });
    session = ss[0] ?? null;
  } catch { /* ใช้วันที่ meeting แทน */ }
  res.json({
    year,
    next: {
      ...slimMeeting(upcoming, meetings.indexOf(upcoming) + 1),
      session: session
        ? { sessionKey: session.session_key, dateStart: session.date_start, dateEnd: session.date_end }
        : null,
    },
  });
}));

/** ทีม + นักแข่งปัจจุบัน (จากเซสชันล่าสุด) */
router.get('/grid', asyncH(async (req, res) => {
  res.json(await getGrid());
}));

/** อันดับ + ผู้ชนะ + โพเดียมสนามล่าสุด (คำนวณจากผลเรซทั้งฤดูกาล — endpoint นี้จะช้าครั้งแรก) */
router.get('/season', asyncH(async (req, res) => {
  const year = Number(req.query.year) || config.season;
  res.json(await getSeasonSummary(year));
}));

/** สถานะสด: ถ้ามีเซสชันกำลังแข่งอยู่ ส่งตำแหน่งล่าสุดด้วย */
router.get('/live', asyncH(async (req, res) => {
  const year = Number(req.query.year) || config.season;
  const sessions = await openf1Api.sessions(year);
  const now = Date.now();

  const active = sessions.find(
    (s) => !s.is_cancelled
      && new Date(s.date_start).getTime() <= now
      && new Date(s.date_end).getTime() >= now,
  );

  if (active) {
    let positions = [];
    try {
      const raw = await openf1Api.positions(active.session_key);
      const best = new Map();
      for (const p of raw) {
        const prev = best.get(p.driver_number);
        if (!prev || new Date(p.date) > new Date(prev.date)) best.set(p.driver_number, p);
      }
      positions = [...best.values()]
        .sort((a, b) => a.position - b.position)
        .slice(0, 20)
        .map((p) => ({ position: p.position, number: p.driver_number }));
    } catch { /* ส่งเซสชันไปเฉย ๆ ถ้าดึงตำแหน่งไม่ได้ */ }
    return res.json({ live: true, session: slimSession(active), positions });
  }

  const upcoming = sessions
    .filter((s) => !s.is_cancelled && new Date(s.date_start).getTime() > now)
    .sort((a, b) => new Date(a.date_start) - new Date(b.date_start))[0] ?? null;
  res.json({ live: false, session: upcoming ? slimSession(upcoming) : null });
}));

router.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  const status = err instanceof OpenF1Error ? err.status : 500;
  console.error(`[api] ${req.method} ${req.path} →`, err.message);
  res.status(status).json({ error: err.message ?? 'Internal error' });
});

export default router;

import { config } from '../config.js';
import { globalCache } from '../cache.js';
import { openf1Api, OpenF1Error } from './openf1.js';
import { driverName, normalizeColour } from './format.js';

/**
 * สรุปทั้งฤดูกาล: อันดับนักแข่ง/คอนสตรัคเตอร์, ผู้ชนะแต่ละสนาม, โพเดียมสนามล่าสุด
 * คำนวณจาก session_result ของทุกเซสชันประเภท Race (รวมสปรินต์) — คะแนนมาจาก OpenF1 โดยตรง
 */
export async function getSeasonSummary(year = config.season) {
  return globalCache.wrap(`season:${year}`, config.cacheTtls.season, async () => {
    const now = Date.now();

    const scoringSessions = (await openf1Api.sessions(year, { session_type: 'Race' }))
      .filter((s) => !s.is_cancelled);
    const races = scoringSessions.filter((s) => s.session_name === 'Race');

    // ผลการแข่งแต่ละเซสชัน (เซสชันที่จบนานแล้วใช้ cache ยาว)
    const resultsBySession = new Map();
    for (const s of scoringSessions) {
      try {
        const finishedAwhileAgo = new Date(s.date_end).getTime() < now - 60 * 60_000;
        const result = await openf1Api.sessionResult(s.session_key, {
          ttlMs: finishedAwhileAgo ? config.cacheTtls.sessionResultPast : config.cacheTtls.sessionResult,
        });
        resultsBySession.set(s.session_key, Array.isArray(result) ? result : []);
      } catch {
        resultsBySession.set(s.session_key, []); // เซสชันไหนหาผลไม่ได้ก็ข้าม
      }
    }

    // ทะเบียนนักแข่ง (ชื่อ/ทีม/สี) — ไล่จากเซสชันเรซล่าสุดย้อนไปจนกว่าจะเจอข้อมูล
    const resultCount = [...resultsBySession.values()].reduce((n, rows) => n + rows.length, 0);
    if (resultCount === 0) {
      // อย่า cache สรุปที่ว่างเปล่า (มักโดน rate limit) — โยน error เพื่อให้ลองใหม่รอบหน้า
      throw new OpenF1Error('ไม่ได้ข้อมูลผลการแข่งขันเลย (upstream อาจโดน rate limit)', { path: '/v1/session_result' });
    }

    let registry = {};
    for (let i = races.length - 1; i >= 0 && Object.keys(registry).length === 0; i--) {
      try {
        const list = await openf1Api.drivers(races[i].session_key);
        registry = Object.fromEntries(list.map((d) => [d.driver_number, d]));
      } catch { /* ลองเซสชันก่อนหน้าต่อ */ }
    }
    if (Object.keys(registry).length === 0) {
      try {
        const list = await openf1Api.drivers('latest');
        registry = Object.fromEntries(list.map((d) => [d.driver_number, d]));
      } catch { /* ไม่มีข้อมูลนักแข่งก็แสดงเป็น #เบอร์ */ }
    }

    // รวมคะแนนรายคน
    const acc = new Map();
    const bump = (num, fn) => {
      if (!acc.has(num)) acc.set(num, { number: num, points: 0, wins: 0, podiums: 0 });
      fn(acc.get(num));
    };
    for (const s of scoringSessions) {
      for (const row of resultsBySession.get(s.session_key) ?? []) {
        bump(row.driver_number, (a) => {
          a.points += row.points ?? 0;
          if (s.session_name === 'Race' && !row.dns) {
            if (row.position === 1 && !row.dnf && !row.dsq) a.wins += 1;
            if (row.position >= 1 && row.position <= 3 && !row.dsq) a.podiums += 1;
          }
        });
      }
    }

    const driverRows = [...acc.values()]
      .map((a) => {
        const reg = registry[a.number] ?? null;
        return {
          number: a.number,
          name: driverName(reg) ?? `#${a.number}`,
          acronym: reg?.name_acronym ?? null,
          team: reg?.team_name ?? 'ไม่ทราบทีม',
          teamColour: normalizeColour(reg?.team_colour),
          headshot: reg?.headshot_url ?? null,
          points: Math.round(a.points * 10) / 10,
          wins: a.wins,
          podiums: a.podiums,
        };
      })
      .sort((x, y) => y.points - x.points || y.wins - x.wins || x.number - y.number)
      .map((row, i) => ({ position: i + 1, ...row }));

    const constructorsMap = new Map();
    for (const row of driverRows) {
      if (!constructorsMap.has(row.team)) {
        constructorsMap.set(row.team, {
          name: row.team,
          teamColour: row.teamColour,
          points: 0,
          wins: 0,
          drivers: [],
        });
      }
      const c = constructorsMap.get(row.team);
      c.points += row.points;
      c.wins += row.wins;
      c.drivers.push(row.number);
    }
    const constructorRows = [...constructorsMap.values()]
      .map((c) => ({ ...c, points: Math.round(c.points * 10) / 10 }))
      .sort((x, y) => y.points - x.points || y.wins - x.wins)
      .map((row, i) => ({ position: i + 1, ...row }));

    // ผู้ชนะแต่ละสนาม (เฉพาะเรซหลัก)
    const winners = [];
    for (const s of races) {
      const winnerRow = (resultsBySession.get(s.session_key) ?? []).find((r) => r.position === 1);
      if (!winnerRow) continue;
      const reg = registry[winnerRow.driver_number] ?? null;
      winners.push({
        meetingKey: s.meeting_key,
        sessionKey: s.session_key,
        date: s.date_start,
        number: winnerRow.driver_number,
        name: driverName(reg) ?? `#${winnerRow.driver_number}`,
        team: reg?.team_name ?? '—',
        teamColour: normalizeColour(reg?.team_colour),
      });
    }

    // สนามล่าสุดที่แข่งจบแล้ว + โพเดียม
    const completedRaces = races.filter(
      (s) => new Date(s.date_end).getTime() < now && (resultsBySession.get(s.session_key) ?? []).length > 0,
    );
    const lastRaceSession = completedRaces.length ? completedRaces[completedRaces.length - 1] : null;
    let lastRace = null;
    if (lastRaceSession) {
      const rows = (resultsBySession.get(lastRaceSession.session_key) ?? [])
        .filter((r) => r.position != null)
        .sort((a, b) => a.position - b.position);
      lastRace = {
        meetingKey: lastRaceSession.meeting_key,
        sessionKey: lastRaceSession.session_key,
        name: lastRaceSession.country_name,
        circuit: lastRaceSession.circuit_short_name,
        location: lastRaceSession.location,
        countryCode: lastRaceSession.country_code,
        date: lastRaceSession.date_start,
        podium: rows.slice(0, 3).map((r) => {
          const reg = registry[r.driver_number] ?? null;
          return {
            position: r.position,
            number: r.driver_number,
            name: driverName(reg) ?? `#${r.driver_number}`,
            acronym: reg?.name_acronym ?? null,
            team: reg?.team_name ?? '—',
            teamColour: normalizeColour(reg?.team_colour),
            headshot: reg?.headshot_url ?? null,
            points: r.points ?? 0,
            gapToLeader: r.gap_to_leader ?? null,
          };
        }),
      };
    }

    const upcomingRaces = races
      .filter((s) => new Date(s.date_start).getTime() > now)
      .sort((a, b) => new Date(a.date_start) - new Date(b.date_start));

    return {
      year,
      updatedAt: new Date().toISOString(),
      progress: { completed: completedRaces.length, total: races.length },
      nextRace: upcomingRaces[0] ? slimSession(upcomingRaces[0]) : null,
      lastRace,
      winners,
      standings: { drivers: driverRows, constructors: constructorRows },
    };
  });
}

export function slimSession(s) {
  return {
    sessionKey: s.session_key,
    meetingKey: s.meeting_key,
    type: s.session_type,
    name: s.session_name,
    countryName: s.country_name,
    countryCode: s.country_code,
    circuit: s.circuit_short_name,
    location: s.location,
    dateStart: s.date_start,
    dateEnd: s.date_end,
  };
}

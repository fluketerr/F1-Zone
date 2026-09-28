import { config } from '../config.js';
import { globalCache } from '../cache.js';
import { openf1Api, OpenF1Error } from './openf1.js';
import { driverName, normalizeColour } from './format.js';

/**
 * กริดปัจจุบัน: จัดกลุ่มนักแข่งตามทีม จากเซสชันล่าสุดของ OpenF1 (session_key=latest)
 * ได้ทั้งสีทีมจริงและรูป headshot
 */
export async function getGrid() {
  return globalCache.wrap('grid', config.cacheTtls.grid, async () => {
    const list = await openf1Api.drivers('latest');
    if (!Array.isArray(list) || list.length === 0) {
      throw new OpenF1Error('OpenF1 drivers: ไม่พบข้อมูลนักแข่ง', { path: '/v1/drivers' });
    }

    const teams = new Map();
    for (const d of list) {
      const teamName = d.team_name ?? 'Unknown';
      if (!teams.has(teamName)) {
        teams.set(teamName, { name: teamName, colour: normalizeColour(d.team_colour), drivers: [] });
      }
      teams.get(teamName).drivers.push({
        number: d.driver_number,
        name: driverName(d) ?? d.broadcast_name ?? `#${d.driver_number}`,
        acronym: d.name_acronym ?? null,
        headshot: d.headshot_url ?? null,
        countryCode: d.country_code ?? null,
      });
    }
    const teamArr = [...teams.values()]
      .map((t) => ({ ...t, drivers: t.drivers.sort((a, b) => a.number - b.number) }));

    return {
      sessionKey: list[0]?.session_key ?? null,
      meetingKey: list[0]?.meeting_key ?? null,
      teams: teamArr,
      updatedAt: new Date().toISOString(),
    };
  });
}

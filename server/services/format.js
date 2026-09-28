/** ตัวช่วยจัดรูปแบบข้อมูลที่ได้จาก OpenF1 */

export function titleCase(s) {
  if (typeof s !== 'string' || !s.trim()) return null;
  return s
    .trim()
    .split(/\s+/)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** "Lando NORRIS" → "Lando Norris" โดยใช้ first_name/last_name ก่อน แล้วค่อย fallback full_name */
export function driverName(d) {
  if (!d) return null;
  const first = titleCase(d.first_name ?? '');
  const last = titleCase(d.last_name ?? '');
  if (first && last) return `${first} ${last}`;
  return titleCase(d.full_name ?? '');
}

/** OpenF1 ให้สีทีมแบบไม่มี "#", เช่น "F47600" → "#F47600" */
export function normalizeColour(c, fallback = '#8A8F98') {
  if (typeof c !== 'string') return fallback;
  const hex = c.replace('#', '').trim();
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toUpperCase()}` : fallback;
}

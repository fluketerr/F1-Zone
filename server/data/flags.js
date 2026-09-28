/**
 * แปลงรหัสประเทศ 3 ตัวอักษรของ OpenF1 → emoji ธง
 * หมายเหตุ: OpenF1 ใช้รหัสแบบ FIA เอง เช่น บาห์เรน = BRN, ซาอุดีอาระเบีย = KSA
 */
const FLAGS = {
  AUS: '🇦🇺', BRN: '🇧🇭', BHR: '🇧🇭', CHN: '🇨🇳', JPN: '🇯🇵',
  KSA: '🇸🇦', SAU: '🇸🇦', USA: '🇺🇸', CAN: '🇨🇦', MON: '🇲🇨',
  ESP: '🇪🇸', AUT: '🇦🇹', GBR: '🇬🇧', BEL: '🇧🇪', HUN: '🇭🇺',
  NED: '🇳🇱', ITA: '🇮🇹', AZE: '🇦🇿', SGP: '🇸🇬', MEX: '🇲🇽',
  BRA: '🇧🇷', QAT: '🇶🇦', UAE: '🇦🇪', ARE: '🇦🇪', FRA: '🇫🇷',
  GER: '🇩🇪', FIN: '🇫🇮', DEN: '🇩🇰', SWE: '🇸🇪', NOR: '🇳🇴',
  THA: '🇹🇭', IDN: '🇮🇩', ARG: '🇦🇷', COL: '🇨🇴', NZL: '🇳🇿',
};

export function flagOf(code) {
  if (typeof code !== 'string') return '🏁';
  return FLAGS[code.toUpperCase()] ?? '🏁';
}

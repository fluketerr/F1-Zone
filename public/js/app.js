import { api, ApiError } from './api.js';
import { FALLBACK } from './fallback-data.js';

const $ = (s) => document.querySelector(s);

/* ---------- helpers ---------- */
const FLAGS = {
  AUS: '🇦🇺', BRN: '🇧🇭', CHN: '🇨🇳', JPN: '🇯🇵', KSA: '🇸🇦', USA: '🇺🇸',
  CAN: '🇨🇦', MON: '🇲🇨', ESP: '🇪🇸', AUT: '🇦🇹', GBR: '🇬🇧', BEL: '🇧🇪',
  HUN: '🇭🇺', NED: '🇳🇱', ITA: '🇮🇹', AZE: '🇦🇿', SGP: '🇸🇬', MEX: '🇲🇽',
  BRA: '🇧🇷', QAT: '🇶🇦', UAE: '🇦🇪',
};
const flagOf = (code) => FLAGS[String(code ?? '').toUpperCase()] ?? '🏁';
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const fmt = {
  full: (d) => new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d),
  short: (d) => new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }).format(d),
  dateTime: (d) => new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d),
  stamp: (d) => new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(d),
};

const state = {
  meetings: [],
  winners: new Map(),
  season: null,
  nextMeetingKey: null,
  countdownTimer: null,
  liveTimer: null,
  stats: {},
};

function markDemo(reason) {
  const b = $('#demoBanner');
  if (!b.hidden) return;
  b.hidden = false;
  b.textContent = `⚠️ ${reason} — กำลังแสดงข้อมูลสาธิตแทนข้อมูลจริง`;
}

/* ---------- countdown ---------- */
function setCountdown(targetISO, meta) {
  const target = new Date(targetISO).getTime();
  if (Number.isNaN(target)) return;
  $('#cdTitle').innerHTML = `สนามถัดไป <b>· ${meta.flag} ${escapeHtml(meta.name)} (รอบที่ ${meta.round})</b>`;
  $('#cdSub').textContent = `${meta.circuit ?? ''}${meta.circuit ? ' · ' : ''}${fmt.full(new Date(target))} · ${new Date(target).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} เวลาท้องถิ่น`;
  const boxes = { d: $('#cdD'), h: $('#cdH'), m: $('#cdM'), s: $('#cdS') };
  const pad = (n) => String(n).padStart(2, '0');
  clearInterval(state.countdownTimer);
  const tick = () => {
    const diff = Math.max(0, target - Date.now());
    boxes.d.textContent = pad(Math.floor(diff / 864e5));
    boxes.h.textContent = pad(Math.floor(diff / 36e5) % 24);
    boxes.m.textContent = pad(Math.floor(diff / 6e4) % 60);
    boxes.s.textContent = pad(Math.floor(diff / 1e3) % 60);
  };
  tick();
  state.countdownTimer = setInterval(tick, 1000);
}

function seasonEnded() {
  clearInterval(state.countdownTimer);
  $('#cdTitle').innerHTML = 'ฤดูกาลนี้จบการแข่งขันแล้ว 🏁';
  $('#cdSub').textContent = 'พบกันใหม่ฤดูกาลหน้า';
  for (const id of ['#cdD', '#cdH', '#cdM', '#cdS']) $(id).textContent = '00';
}

/* ---------- data loads ---------- */
async function loadNext() {
  try {
    const { next } = await api.next();
    if (!next) { seasonEnded(); return; }
    state.nextMeetingKey = next.meetingKey;
    setCountdown(next.session?.dateStart ?? next.dateStart, next);
  } catch (err) {
    console.warn('[f1zone] /api/next:', err.message);
    markDemo('เชื่อมต่อ API ไม่สำเร็จ');
    setCountdown(FALLBACK.next.when, FALLBACK.next);
  }
}

async function loadGrid() {
  try {
    const grid = await api.grid();
    renderTeams(grid.teams);
    setStats({
      teams: grid.teams.length,
      drivers: grid.teams.reduce((n, t) => n + t.drivers.length, 0),
    });
  } catch (err) {
    console.warn('[f1zone] /api/grid:', err.message);
    markDemo('เชื่อมต่อ API ไม่สำเร็จ');
    renderTeams(FALLBACK.teams);
    setStats({
      teams: FALLBACK.teams.length,
      drivers: FALLBACK.teams.reduce((n, t) => n + t.drivers.length, 0),
    });
  }
}

async function loadMeetings() {
  try {
    const { meetings } = await api.meetings();
    state.meetings = meetings;
  } catch (err) {
    console.warn('[f1zone] /api/meetings:', err.message);
    markDemo('เชื่อมต่อ API ไม่สำเร็จ');
    state.meetings = FALLBACK.meetings;
  }
  renderCalendar();
}

async function loadSeason() {
  try {
    const season = await api.season();
    state.season = season;
    state.winners = new Map(season.winners.map((w) => [w.meetingKey, w]));
  } catch (err) {
    console.warn('[f1zone] /api/season:', err.message);
    markDemo('เชื่อมต่อ API ไม่สำเร็จ');
    state.season = FALLBACK.season;
    state.winners = new Map();
  }

  const season = state.season;
  renderStandings();
  renderPodium(season.lastRace);
  setStats({ done: season.progress.completed, total: season.progress.total });
  $('#spText').textContent = `${season.progress.completed} / ${season.progress.total} สนาม`;
  $('#spFill').style.width = `${Math.round((season.progress.completed / Math.max(1, season.progress.total)) * 100)}%`;
  if (season.nextRace?.meetingKey) state.nextMeetingKey = season.nextRace.meetingKey;
  renderCalendar();
  if (season.updatedAt) {
    $('#updatedAt').textContent = `ข้อมูลอัปเดตเมื่อ ${fmt.stamp(new Date(season.updatedAt))}`;
  }
}

async function loadLive() {
  const strip = $('#liveStrip');
  try {
    renderLive(await api.live());
  } catch (err) {
    console.warn('[f1zone] /api/live:', err.message);
    strip.innerHTML = '<span class="muted">ไม่สามารถดึงสถานะเซสชันได้</span>';
  }
}

/* ---------- renderers ---------- */
function setStats(patch) {
  Object.assign(state.stats, patch);
  const s = state.stats;
  if (s.done != null) $('#statDone').textContent = s.done;
  if (s.total != null) $('#statTotal').textContent = s.total;
  if (s.teams != null) $('#statTeams').textContent = s.teams;
  if (s.drivers != null) $('#statDrivers').textContent = s.drivers;
}

function renderTeams(teams) {
  $('#teamsGrid').innerHTML = teams.map((t) => `
    <div class="team-card" style="--tc:${t.colour}">
      <div class="tc-head">
        <h3>${escapeHtml(t.name)}</h3>
        <span class="tc-engine">${t.drivers.length} นักแข่ง</span>
      </div>
      <div class="tc-drivers">
        ${t.drivers.map((d) => `
          <div class="driver">
            ${d.headshot ? `<img class="d-face" src="${d.headshot}" alt="" loading="lazy" onerror="this.remove()">` : ''}
            <span class="d-no">${d.number}</span>
            <span class="d-name">${escapeHtml(d.name)}${d.acronym ? ` <small>(${escapeHtml(d.acronym)})</small>` : ''}</span>
          </div>`).join('')}
      </div>
    </div>`).join('');
}

function standingsRows(rows) {
  if (!rows?.length) return '<p class="muted">ยังไม่มีข้อมูลอันดับ</p>';
  const max = rows[0].points || 1;
  return rows.map((r) => `
    <div class="st-row">
      <span class="st-pos${r.position <= 3 ? ` p${r.position}` : ''}">${r.position}</span>
      <div>
        <div class="st-line1">
          <span class="st-name">${escapeHtml(r.name)}</span>
          ${r.team ? `<span class="st-team" style="color:${r.teamColour}">${escapeHtml(r.team)}</span>` : ''}
        </div>
        <div class="st-bar"><i data-w="${Math.max(4, Math.round((r.points / max) * 100))}" style="background:${r.teamColour}"></i></div>
      </div>
      <div class="st-pts od">${r.points}<small>PTS</small>${r.wins != null ? `<small>🏆 ${r.wins} ชนะ</small>` : ''}</div>
    </div>`).join('');
}

function renderStandings() {
  const st = state.season?.standings;
  $('#driversList').innerHTML = standingsRows(st?.drivers);
  $('#constructorsList').innerHTML = standingsRows(st?.constructors);
  animateBars();
}

function animateBars() {
  requestAnimationFrame(() => {
    document.querySelectorAll('.st-panel.show .st-bar i').forEach((bar) => {
      bar.style.width = '0%';
      requestAnimationFrame(() => { bar.style.width = `${bar.dataset.w}%`; });
    });
  });
}

function renderCalendar() {
  const wrap = $('#raceList');
  if (!state.meetings.length) return;
  const notPast = state.meetings.filter((m) => !m.isPast);
  const nextKey = state.nextMeetingKey ?? state.season?.nextRace?.meetingKey ?? notPast[0]?.meetingKey ?? null;
  wrap.innerHTML = state.meetings.map((m) => {
    const isNext = m.meetingKey === nextKey;
    const winner = state.winners.get(m.meetingKey);
    const chip = isNext
      ? '<span class="chip next-chip">🏁 สนามถัดไป</span>'
      : m.isPast
        ? `<span class="chip ${winner ? 'win' : ''}">${winner ? `🏆 ${escapeHtml(winner.name)}` : 'แข่งแล้ว'}</span>`
        : '<span class="chip">ยังไม่แข่ง</span>';
    return `
      <div class="race-item ${isNext ? 'next' : m.isPast ? 'past' : ''}">
        <div class="r-no od">${String(m.round).padStart(2, '0')}</div>
        <div class="r-flag">${m.flag}</div>
        <div>
          <div class="r-name">${escapeHtml(m.name)}</div>
          <div class="r-circuit">${escapeHtml([m.circuit, m.location].filter(Boolean).join(' · '))} · ${fmt.short(new Date(m.dateStart))}</div>
        </div>
        <div class="r-status">${chip}</div>
      </div>`;
  }).join('');
}

function renderPodium(last) {
  const section = $('#podium');
  if (!last?.podium?.length) { section.hidden = true; return; }
  section.hidden = false;
  $('#podiumTitle').textContent = `${flagOf(last.countryCode)} ${last.name ?? 'สนามล่าสุด'} — ${last.circuit ?? ''}`.trim();
  $('#podiumSub').textContent = `แข่งเมื่อ ${fmt.full(new Date(last.date))} · ผลการแข่งขันจริงจาก OpenF1`;
  const order = [1, 0, 2]; // จัดวางแบบโพเดียมจริง: 2-1-3
  $('#podiumWrap').innerHTML = order.map((i) => last.podium[i]).filter(Boolean).map((p) => `
    <div class="podium-card p${p.position}" style="--pc:${p.teamColour}">
      <div class="podium-face-box">
        <div class="podium-face fallback">${p.number}</div>
        ${p.headshot ? `<img class="podium-face" src="${p.headshot}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.style.display='none'">` : ''}
      </div>
      <div class="podium-pos od">P${p.position}</div>
      <div class="podium-name">${escapeHtml(p.name)}</div>
      <div class="podium-team">${escapeHtml(p.team)}</div>
      <div class="podium-pts">+${p.points} คะแนน</div>
    </div>`).join('');
}

function renderLive({ live, session, positions = [] }) {
  const strip = $('#liveStrip');
  if (!session) { strip.innerHTML = '<span class="muted">ไม่มีข้อมูลเซสชัน</span>'; return; }
  if (live) {
    strip.innerHTML = `
      <span class="chip live">● LIVE</span>
      <b>${flagOf(session.countryCode)} ${escapeHtml(session.countryName ?? '')} — ${escapeHtml(session.name)}</b>
      <span class="live-positions">${positions.slice(0, 10).map((p) => `<span class="lp"><i>${p.position}</i>#${p.number}</span>`).join('')}</span>`;
    clearTimeout(state.liveTimer);
    state.liveTimer = setTimeout(loadLive, 30_000);
  } else {
    strip.innerHTML = `
      <span class="chip">📍 เซสชันถัดไป</span>
      <b>${flagOf(session.countryCode)} ${escapeHtml(session.countryName ?? '')} — ${escapeHtml(session.name)}</b>
      <span class="muted">${fmt.dateTime(new Date(session.dateStart))} (เวลาท้องถิ่นเครื่องคุณ)</span>`;
  }
}

/* ---------- static interactive bits ---------- */
function initStatic() {
  const FACTS = [
    'รถ F1 ปี 2026 มีพลังรวมกว่า 1,000 แรงม้า จากเครื่องยนต์และมอเตอร์ไฟฟ้า',
    'นักแข่งเสียเหงื่อมากกว่า 3 กิโลกรัมต่อการแข่งหนึ่งสนาม',
    'แรงเหวี่ยงขณะเบรกหนัก ๆ ของรถ F1 สูงกว่า 5G เทียบเท่านักบินขับไล่',
    'ความเร็วสูงสุดของรถ F1 ทะลุ 370 km/h ที่สนามมอนซา',
    'ยางรถ F1 ทำงานที่อุณหภูมิกว่า 100 องศาเซลเซียส',
    'ทีมพิตสต็อฟท็อป ๆ เปลี่ยนยาง 4 เส้นได้ในเวลาต่ำกว่า 2 วินาที',
    'Cadillac คือทีมใหม่ล่าสุดทำให้กริดปี 2026 มีถึง 11 ทีม 22 คัน',
    'เชื้อเพลิงยั่งยืน 100% ของ F1 ถูกออกแบบให้ใช้กับเครื่องยนต์เบนซินทั่วไปได้ด้วย',
  ];
  const half = FACTS.map((f) => `<span><b>🏎️</b>${f}</span>`).join('');
  $('#tickerTrack').innerHTML = half + half;

  window.addEventListener('scroll', () => {
    $('#nav').classList.toggle('scrolled', window.scrollY > 24);
  }, { passive: true });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.st-panel').forEach((p) => p.classList.remove('show'));
      btn.classList.add('active');
      $(`#panel-${btn.dataset.tab}`).classList.add('show');
      animateBars();
    });
  });

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -30px 0px' });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

  const cols = [...document.querySelectorAll('.light-col')];
  const btn = $('#startBtn');
  const msg = $('#lightsMsg');
  let running = false;
  btn.addEventListener('click', () => {
    if (running) return;
    running = true;
    btn.disabled = true;
    msg.textContent = '';
    cols.forEach((c) => c.querySelectorAll('.light').forEach((l) => l.classList.remove('on')));
    let i = 0;
    const step = () => {
      if (i < cols.length) {
        cols[i].querySelectorAll('.light').forEach((l) => l.classList.add('on'));
        i += 1;
        setTimeout(step, 700);
      } else {
        // ดีเลย์แบบสุ่มก่อนไฟดับ เหมือนการออกตัวจริง
        setTimeout(() => {
          cols.forEach((c) => c.querySelectorAll('.light').forEach((l) => l.classList.remove('on')));
          msg.textContent = 'LIGHTS OUT AND AWAY WE GO! 🏁';
          btn.disabled = false;
          running = false;
        }, 500 + Math.random() * 1200);
      }
    };
    setTimeout(step, 350);
  });
}

/* ---------- boot ---------- */
initStatic();
loadNext();
loadGrid();
loadMeetings();
loadSeason();
loadLive();

'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   STATS PAGE — personal records + global leaderboard.

   Toggle: Personal | Global. Mode buttons: Time Trial / Sudden Death / Gauntlet.
   - Personal aggregates the signed-in user's own runs (read directly; RLS allows
     reading your own rows): per-BPM (free modes) or per-level (gauntlet) best
     rank, best green%, longest survival, run counts, total runs.
   - Global calls the get_leaderboard RPC for a chosen BPM (free) or level
     (gauntlet) and lists the top players.
   ════════════════════════════════════════════════════════════════════════════ */

const RANK_ORDER = { E: 0, D: 1, C: 2, B: 3, A: 4, S: 5, SS: 6 };
const RANK_COLOR = { SS: '#ffe066', S: '#00c8ff', A: '#00e87a', B: '#4aa8ff', C: '#e8f0f5', D: '#8ab0c8', E: '#ff3838' };
const GAME_BPM_MIN = 50, GAME_BPM_MAX = 250, GAME_BPM_STEP = 5;

const state = { view: 'personal', mode: 'timetrial', instrument: 'kick', bpm: 120, level: 1 };
let myRunsCache = null;

const $ = (id) => document.getElementById(id);

function fmtMMSS(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function rankBetter(a, b) { return (RANK_ORDER[a] ?? -1) > (RANK_ORDER[b] ?? -1) ? a : b; }
function rankPill(rank) {
  return '<span class="stats-rank" style="color:' + (RANK_COLOR[rank] || '#fff') + '">' + (rank || '–') + '</span>';
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Auth wiring ──────────────────────────────────────────────────────────────
function initAuthBars() {
  if (!window.Cloud) { setTimeout(initAuthBars, 100); return; }
  window.Cloud.mountAuthBar($('cloudAuthBar'));
  window.Cloud.mountAuthBar($('cloudAuthBar2'));
  window.Cloud.onAuth((user) => {
    const signedIn = !!user;
    $('statsSignedOut').hidden = signedIn;
    $('statsMain').hidden = !signedIn;
    myRunsCache = null;
    if (signedIn) render();
  });
}

// ── Controls ─────────────────────────────────────────────────────────────────
function wireControls() {
  document.querySelectorAll('.stats-view-btn').forEach(b =>
    b.addEventListener('click', () => {
      state.view = b.dataset.view;
      document.querySelectorAll('.stats-view-btn').forEach(x => x.classList.toggle('active', x === b));
      render();
    }));
  document.querySelectorAll('.stats-mode-btn').forEach(b =>
    b.addEventListener('click', () => {
      state.mode = b.dataset.mode;
      document.querySelectorAll('.stats-mode-btn').forEach(x => x.classList.toggle('active', x === b));
      render();
    }));
  document.querySelectorAll('.stats-instr-btn').forEach(b =>
    b.addEventListener('click', () => {
      state.instrument = b.dataset.instr;
      document.querySelectorAll('.stats-instr-btn').forEach(x => x.classList.toggle('active', x === b));
      render();
    }));
  $('statsSubSelectEl').addEventListener('change', (e) => {
    if (state.mode === 'gauntlet') state.level = parseInt(e.target.value, 10);
    else state.bpm = parseInt(e.target.value, 10);
    render();
  });
}

// Populate the Global secondary selector for the current mode.
function populateSubSelect() {
  const sel = $('statsSubSelectEl');
  sel.innerHTML = '';
  if (state.mode === 'gauntlet') {
    $('statsSubLabel').textContent = 'Level';
    for (let l = 1; l <= 6; l++) sel.appendChild(opt(l, 'Level ' + l));
    sel.value = String(state.level);
  } else {
    $('statsSubLabel').textContent = 'BPM';
    for (let b = GAME_BPM_MIN; b <= GAME_BPM_MAX; b += GAME_BPM_STEP) sel.appendChild(opt(b, b + ' BPM'));
    sel.value = String(state.bpm);
  }
}
function opt(val, label) { const o = document.createElement('option'); o.value = String(val); o.textContent = label; return o; }

// ── Render ───────────────────────────────────────────────────────────────────
async function render() {
  const isTrophies = state.view === 'trophies';
  // The mode / instrument / BPM controls only apply to Personal & Global.
  if ($('statsInstrRow')) $('statsInstrRow').style.display = isTrophies ? 'none' : '';
  if ($('statsModesRow')) $('statsModesRow').style.display = isTrophies ? 'none' : '';
  // .stats-subselect has an author display:flex rule, so toggle display directly
  // (the `hidden` attribute would be overridden by it).
  $('statsSubSelect').style.display = (isTrophies || state.view !== 'global') ? 'none' : 'flex';

  if (isTrophies) { await renderTrophies(); return; }
  if (state.view === 'global') populateSubSelect();
  if (state.view === 'personal') await renderPersonal();
  else await renderGlobal();
}

async function renderPersonal() {
  $('statsContent').innerHTML = '<div class="stats-loading">Loading…</div>';
  if (!myRunsCache) myRunsCache = await window.Cloud.myRuns();
  const runs = myRunsCache;
  const totalRuns = runs.length;
  const instr = state.instrument;
  const instrRuns = runs.filter(r => (r.instrument || 'kick') === instr);
  const modeRuns = instrRuns.filter(r => r.mode === state.mode);

  $('statsSummary').innerHTML =
    '<span class="stats-stat"><b>' + totalRuns + '</b> total runs</span>' +
    '<span class="stats-stat"><b>' + instrRuns.length + '</b> on ' + instrLabel(instr) + '</span>' +
    '<span class="stats-stat"><b>' + modeRuns.length + '</b> in ' + modeLabel(state.mode) + '</span>';

  if (!modeRuns.length) {
    $('statsContent').innerHTML = '<div class="stats-empty">No ' + instrLabel(instr) + ' ' + modeLabel(state.mode) + ' runs yet — go set a record.</div>';
    return;
  }

  if (state.mode === 'gauntlet') {
    const by = {};
    modeRuns.forEach(r => {
      const o = by[r.level] || (by[r.level] = { level: r.level, count: 0, rank: 'E', green: 0, cleared: false });
      o.count++; o.rank = rankBetter(o.rank, r.rank); o.green = Math.max(o.green, r.green_pct); o.cleared = o.cleared || r.cleared;
    });
    const rows = Object.values(by).sort((a, b) => a.level - b.level).map(o =>
      tr([ 'Level ' + o.level, rankPill(o.rank), o.green + '%', o.cleared ? '✓' : '—', o.count ]));
    $('statsContent').innerHTML = table(['Level', 'Best rank', 'Best %', 'Cleared', 'Runs'], rows);
  } else {
    const by = {};
    modeRuns.forEach(r => {
      const o = by[r.bpm] || (by[r.bpm] = { bpm: r.bpm, count: 0, rank: 'E', green: 0, longest: 0 });
      o.count++; o.rank = rankBetter(o.rank, r.rank); o.green = Math.max(o.green, r.green_pct);
      o.longest = Math.max(o.longest, r.survival_sec || 0);
    });
    const ordered = Object.values(by).sort((a, b) => a.bpm - b.bpm);
    if (state.mode === 'suddendeath') {
      const rows = ordered.map(o => tr([ o.bpm + ' BPM', fmtMMSS(o.longest), rankPill(o.rank), o.count ]));
      $('statsContent').innerHTML = table(['BPM', 'Longest survived', 'Best rank', 'Runs'], rows);
    } else {
      const rows = ordered.map(o => tr([ o.bpm + ' BPM', rankPill(o.rank), o.green + '%', o.count ]));
      $('statsContent').innerHTML = table(['BPM', 'Best rank', 'Best %', 'Runs'], rows);
    }
  }
}

async function renderGlobal() {
  $('statsSummary').innerHTML = '';
  $('statsContent').innerHTML = '<div class="stats-loading">Loading…</div>';
  const isGauntlet = state.mode === 'gauntlet';
  const rows = await window.Cloud.leaderboard(
    state.mode,
    isGauntlet ? null : state.bpm,
    isGauntlet ? state.level : null,
    state.instrument
  );
  const where = instrLabel(state.instrument) + ' · ' + (isGauntlet ? ('Level ' + state.level) : (state.bpm + ' BPM'));

  if (!rows.length) {
    $('statsContent').innerHTML = '<div class="stats-empty">No scores yet for ' + modeLabel(state.mode) + ' · ' + where + '. Be the first.</div>';
    return;
  }

  const body = rows.map((r, i) => {
    const who = '<span class="stats-player">' +
      (r.avatar_url ? '<img class="cloud-avatar sm" src="' + esc(r.avatar_url) + '" referrerpolicy="no-referrer">' : '') +
      esc(r.display_name || 'Drummer') + '</span>';
    const pos = '<span class="stats-pos' + (i < 3 ? ' top' : '') + '">' + (i + 1) + '</span>';
    if (state.mode === 'suddendeath') return tr([ pos, who, fmtMMSS(r.survival_sec) ]);
    if (state.mode === 'gauntlet')    return tr([ pos, who, rankPill(r.rank), r.green_pct + '%', r.cleared ? '✓' : '—' ]);
    return tr([ pos, who, rankPill(r.rank), r.green_pct + '%', fmtMMSS(r.duration_sec) ]); // time trial
  });

  const head = state.mode === 'suddendeath' ? ['#', 'Player', 'Survived']
    : state.mode === 'gauntlet' ? ['#', 'Player', 'Grade', 'Green', 'Cleared']
    : ['#', 'Player', 'Grade', 'Green', 'Duration'];
  $('statsContent').innerHTML = '<div class="stats-lb-where">' + modeLabel(state.mode) + ' · ' + where + '</div>' +
    table(head, body);
}

// ── Trophies / achievements ──────────────────────────────────────────────────
// Everything is derived from the user's own runs (no extra storage). Each trophy
// is "tiered": one-offs are just a single tier of 1. icon is an emoji placeholder —
// swap for an <img src> later to drop in custom badge art without touching logic.
const TIER_NAMES  = ['', 'Bronze', 'Silver', 'Gold', 'Platinum'];

const ACHIEVEMENTS = [
  { id: 'mileage',  name: 'Mileage',        icon: '🥁', key: 'total',          tiers: [10, 50, 100, 500], unit: ' runs' },
  { id: 'sharp',    name: 'Sharpshooter',   icon: '🎯', key: 'sOrBetter',      tiers: [1, 10, 50],        unit: ' S+ ranks' },
  { id: 'untouch',  name: 'Untouchable',    icon: '💎', key: 'ss',             tiers: [1, 10, 25],        unit: ' SS ranks' },
  { id: 'speed',    name: 'Speed Demon',    icon: '⚡', key: 'maxBpm',         tiers: [120, 160, 200, 240], fmt: v => v + ' BPM' },
  { id: 'iron',     name: 'Iron Endurance', icon: '🔥', key: 'bestSurvival',   tiers: [60, 180, 300, 600],  fmt: v => fmtMMSS(v) + ' survived' },
  { id: 'streak',   name: 'Consistency',    icon: '📅', key: 'dayStreak',      tiers: [3, 7, 30],         fmt: v => v + '-day streak' },
  { id: 'first',    name: 'First Blood',    icon: '✅', key: 'total',          tiers: [1],  desc: 'Complete your first run.' },
  { id: 'perfect',  name: 'Perfectionist',  icon: '✨', key: 'flawless',       tiers: [1],  desc: 'Land a 100% green run.' },
  { id: 'gaunt',    name: 'Gauntlet Slayer',icon: '🏆', key: 'gauntletCleared',tiers: [1],  desc: 'Clear a Gauntlet.' },
  { id: 'ambi',     name: 'Ambidextrous',   icon: '🤹', key: 'instruments',    tiers: [2],  desc: 'Log runs on both Kick and Snare.' },
  { id: 'marathon', name: 'Marathon',       icon: '⏱️', key: 'longestRun',     tiers: [600],desc: 'A single run of 10+ minutes.' },
  { id: 'range',    name: 'Full Spectrum',  icon: '🎚️', key: 'distinctBpms',   tiers: [5],  desc: 'Play at 5 different tempos.' },
];

function deriveMetrics(runs) {
  const days = [...new Set(runs.map(r => (r.created_at || '').slice(0, 10)).filter(Boolean))].sort();
  return {
    total: runs.length,
    sOrBetter: runs.filter(r => (RANK_ORDER[r.rank] ?? -1) >= RANK_ORDER.S).length,
    ss: runs.filter(r => r.rank === 'SS').length,
    maxBpm: runs.reduce((m, r) => Math.max(m, r.bpm || 0), 0),
    bestSurvival: runs.reduce((m, r) => Math.max(m, r.survival_sec || 0), 0),
    flawless: runs.some(r => (r.green_pct || 0) >= 100) ? 1 : 0,
    gauntletCleared: runs.some(r => r.mode === 'gauntlet' && r.cleared) ? 1 : 0,
    instruments: new Set(runs.map(r => r.instrument || 'kick')).size,
    longestRun: runs.reduce((m, r) => Math.max(m, r.duration_sec || 0), 0),
    distinctBpms: new Set(runs.filter(r => r.bpm).map(r => r.bpm)).size,
    dayStreak: longestDayStreak(days),
  };
}

// Longest run of consecutive calendar days (YYYY-MM-DD strings, pre-sorted).
function longestDayStreak(days) {
  let best = 0, cur = 0, prev = null;
  for (const d of days) {
    const t = Date.parse(d + 'T00:00:00');
    if (prev !== null && t - prev === 86400000) cur++;
    else cur = 1;
    prev = t;
    if (cur > best) best = cur;
  }
  return best;
}

async function renderTrophies() {
  $('statsSummary').innerHTML = '';
  $('statsContent').innerHTML = '<div class="stats-loading">Loading…</div>';
  if (!myRunsCache) myRunsCache = await window.Cloud.myRuns();
  const m = deriveMetrics(myRunsCache);

  let unlocked = 0;
  const cards = ACHIEVEMENTS.map(a => {
    const value = m[a.key] || 0;
    const reached = a.tiers.filter(t => value >= t).length;   // highest tier index reached
    const maxed = reached >= a.tiers.length;
    const earned = reached > 0;
    if (earned) unlocked++;
    const next = maxed ? null : a.tiers[reached];
    const tierColorIdx = Math.min(reached, 4);
    const showVal = a.fmt ? a.fmt : (v => v + (a.unit || ''));

    // Sub-line: tier label for multi-tier; progress / desc otherwise.
    let tierLabel = '';
    if (a.tiers.length > 1) tierLabel = earned ? (TIER_NAMES[Math.min(reached, 4)] || ('Tier ' + reached)) : 'Locked';
    else tierLabel = earned ? 'Unlocked' : 'Locked';

    let prog, pct;
    if (maxed) { prog = '★ Maxed · ' + showVal(a.tiers[a.tiers.length - 1]); pct = 100; }
    else if (a.tiers.length === 1) { prog = a.desc || ('Reach ' + showVal(a.tiers[0])); pct = Math.min(100, value / a.tiers[0] * 100); }
    else { prog = showVal(value) + '  →  next ' + showVal(next); pct = Math.min(100, value / next * 100); }

    return '<div class="trophy ' + (earned ? 'earned' : 'locked') + ' tier-' + tierColorIdx + '">' +
        '<div class="trophy-badge"><span class="trophy-icon">' + a.icon + '</span>' +
          (earned ? '' : '<span class="trophy-lock">🔒</span>') + '</div>' +
        '<div class="trophy-name">' + esc(a.name) + '</div>' +
        '<div class="trophy-tier">' + tierLabel + (a.tiers.length > 1 && earned && !maxed ? ' · ' + reached + '/' + a.tiers.length : '') + '</div>' +
        '<div class="trophy-bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="trophy-prog">' + esc(prog) + '</div>' +
      '</div>';
  });

  $('statsContent').innerHTML =
    '<div class="trophy-summary"><b>' + unlocked + '</b> / ' + ACHIEVEMENTS.length + ' trophies unlocked</div>' +
    '<div class="trophy-grid">' + cards.join('') + '</div>';
}

// ── tiny table helpers ───────────────────────────────────────────────────────
function table(headers, rows) {
  return '<table class="stats-table"><thead><tr>' +
    headers.map(h => '<th>' + h + '</th>').join('') +
    '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
}
function tr(cells) { return '<tr>' + cells.map(c => '<td>' + c + '</td>').join('') + '</tr>'; }
function modeLabel(m) { return m === 'suddendeath' ? 'Sudden Death' : m === 'gauntlet' ? 'Gauntlet' : 'Time Trial'; }
function instrLabel(i) { return i === 'snare' ? 'Snare' : 'Kick'; }

// ── boot ─────────────────────────────────────────────────────────────────────
wireControls();
initAuthBars();

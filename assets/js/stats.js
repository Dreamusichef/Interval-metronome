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
  // Whitelist to the 7 real ranks. `rank` comes from the DB; a spoofed row could
  // carry arbitrary text, so anything not in RANK_ORDER renders as the neutral '–'
  // and never reaches the DOM (stored-XSS guard, issue #48).
  const r = (rank in RANK_ORDER) ? rank : '';
  return '<span class="stats-rank" style="color:' + (RANK_COLOR[r] || '#fff') + '">' + (r || '–') + '</span>';
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Auth wiring ──────────────────────────────────────────────────────────────
// Cloud scripts load async (see stats.html loadCloudScripts); poll until Cloud
// exists, then subscribe via onAuth — do not read currentUser() synchronously.
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

function validRuns(runs) {
  return runs.filter(r => r.valid !== false);
}

async function renderPersonal() {
  $('statsContent').innerHTML = '<div class="stats-loading">Loading…</div>';
  if (!myRunsCache) myRunsCache = validRuns(await window.Cloud.myRuns());
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
      const rows = ordered.map(o => tr([ o.bpm + ' BPM', fmtMMSS(o.longest), rankPill(o.rank), o.green + '%', o.count ]));
      $('statsContent').innerHTML = table(['BPM', 'Longest survived', 'Best rank', 'Best %', 'Runs'], rows);
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
    // Only render https:// avatars — esc() blocks attribute breakout but not a
    // javascript:/data: URL scheme. Google OAuth avatars are always https (#48).
    const safeAvatar = (r.avatar_url && r.avatar_url.startsWith('https://')) ? esc(r.avatar_url) : '';
    const who = '<span class="stats-player">' +
      (safeAvatar ? '<img class="cloud-avatar sm" src="' + safeAvatar + '" referrerpolicy="no-referrer">' : '') +
      esc(r.display_name || 'Drummer') + '</span>';
    const pos = '<span class="stats-pos' + (i < 3 ? ' top' : '') + '">' + (i + 1) + '</span>';
    if (state.mode === 'suddendeath') return tr([ pos, who, fmtMMSS(r.survival_sec) ]);
    if (state.mode === 'gauntlet')    return tr([ pos, who, rankPill(r.rank), r.green_pct + '%', r.cleared ? '✓' : '—' ]);
    return tr([ pos, who, rankPill(r.rank), r.green_pct + '%', fmtMMSS(r.duration_sec) ]); // time trial
  });

  const head = state.mode === 'suddendeath' ? ['#', 'Player', 'Survived']
    : state.mode === 'gauntlet' ? ['#', 'Player', 'Grade', 'Progress', 'Cleared']
    : ['#', 'Player', 'Grade', 'Green', 'Duration'];
  $('statsContent').innerHTML = '<div class="stats-lb-where">' + modeLabel(state.mode) + ' · ' + where + '</div>' +
    table(head, body);
}

// ── Trophies / achievements (definitions live in achievements.js — shared with
//    the game page so the run-end popup uses the exact same trophies) ───────────
async function renderTrophies() {
  $('statsSummary').innerHTML = '';
  $('statsContent').innerHTML = '<div class="stats-loading">Loading…</div>';
  if (!window.Achievements) { $('statsContent').innerHTML = '<div class="stats-empty">Trophies unavailable.</div>'; return; }
  if (!myRunsCache) myRunsCache = validRuns(await window.Cloud.myRuns());
  const A = window.Achievements;
  const m = A.deriveMetrics(myRunsCache);

  let unlocked = 0;
  const cards = A.LIST.map(a => {
    const e = A.evaluate(a, m);
    if (e.earned) unlocked++;
    const cardCls = (a.tiers.length === 1) ? (e.earned ? 'solo' : 'tier-0') : ('tier-' + e.reached);
    return '<div class="trophy ' + (e.earned ? 'earned' : 'locked') + ' ' + cardCls + '">' +
        A.badgeHtml(a, e.reached) +
        '<div class="trophy-name">' + esc(a.name) + '</div>' +
        '<div class="trophy-tier">' + e.tierLabel + (a.tiers.length > 1 && e.earned && !e.maxed ? ' · ' + e.reached + '/' + a.tiers.length : '') + '</div>' +
        '<div class="trophy-bar"><i style="width:' + e.pct + '%"></i></div>' +
        '<div class="trophy-prog">' + esc(e.prog) + '</div>' +
        '<div class="trophy-desc">' + esc(a.desc || '') + '</div>' +
      '</div>';
  });

  $('statsContent').innerHTML =
    '<div class="trophy-summary"><b>' + unlocked + '</b> / ' + A.LIST.length + ' trophies unlocked</div>' +
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

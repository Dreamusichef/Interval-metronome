'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   ACHIEVEMENTS — shared trophy definitions + evaluation.

   Loaded on BOTH the game page (for the live "trophy unlocked" popup at run-end)
   and the stats page (for the Trophies grid), so there's one source of truth.
   Everything derives from the user's run rows — no extra storage.

   window.Achievements:
     LIST                      the trophy definitions
     deriveMetrics(runs)       run history → metric bag
     evaluate(ach, metrics)    → { value, reached, maxed, earned, next, pct,
                                   tierLabel, prog, tierColorIdx }
     reachedMap(runs)          → { id: reachedTierCount }  (for diffing)
     diff(before, after)       → [{ ach, reached }]  newly-raised tiers
     badgeHtml(ach, reached)   → hexagon badge markup (shared by grid + popup)
   ════════════════════════════════════════════════════════════════════════════ */
const Achievements = (() => {
  const RANK_ORDER = { E: 0, D: 1, C: 2, B: 3, A: 4, S: 5, SS: 6 };
  const TIER_NAMES = ['', 'Unlocked'];   // single-badge fallback
  // 10-rung ranked ladder used by every tiered trophy.
  const LADDER_10 = ['', 'Iron', 'Bronze', 'Silver', 'Gold', 'Emerald', 'Ruby', 'Diamond', 'Platinum', 'Master', 'Grandmaster'];
  // Speed Demon tiers: 120→240 BPM (each rung must be earned with an A+ run).
  const SPEED_TIERS = [120, 130, 140, 150, 165, 180, 195, 210, 225, 240];
  // Free-tempo ladder is 50–250 BPM step 5 = 41 tempos — the ceiling for the
  // "distinct tempos at rank X" collection trophies.
  const TEMPO_COLLECT = [3, 6, 10, 15, 20, 25, 30, 35, 38, 41];

  const LIST = [
    { id: 'speedKick',  name: 'Kick Speed Demon', icon: '🦵', key: 'kickSpeedBpm',  tiers: SPEED_TIERS, tierNames: LADDER_10, fmt: v => v + ' BPM', desc: 'Highest tempo cleared with an A+ on Kick.' },
    { id: 'speedSnare', name: 'Snare Speed Demon',icon: '✋', key: 'snareSpeedBpm', tiers: SPEED_TIERS, tierNames: LADDER_10, fmt: v => v + ' BPM', desc: 'Highest tempo cleared with an A+ on Snare.' },
    { id: 'mileage',    name: 'Mileage',          icon: '🥁', key: 'total',         tiers: [5, 10, 25, 50, 100, 200, 350, 500, 750, 1000], tierNames: LADDER_10, fmt: v => v + ' runs', desc: 'Total runs played.' },
    { id: 'iron',       name: 'Iron Endurance',   icon: '🔥', key: 'bestSurvival',  tiers: [30, 60, 120, 180, 300, 450, 600, 900, 1200, 1800], tierNames: LADDER_10, fmt: v => fmtMMSS(v), desc: 'Longest Sudden Death survival.' },
    { id: 'woodshed',   name: 'Woodshed',         icon: '🪵', key: 'totalSeconds',  tiers: [3600, 18000, 36000, 90000, 180000, 360000, 720000, 1440000, 2520000, 3600000], tierNames: LADDER_10, fmt: v => fmtHours(v), desc: 'Total time practiced.' },
    { id: 'streak',     name: 'Consistency',      icon: '📅', key: 'dayStreak',     tiers: [3, 5, 7, 14, 21, 30, 45, 60, 80, 100], tierNames: LADDER_10, fmt: v => v + 'd', desc: 'Consecutive days practiced.' },
    { id: 'gauntSlay',  name: 'Gauntlet Slayer',  icon: '⚔️', key: 'gauntletClears',tiers: [1, 3, 5, 10, 20, 30, 50, 70, 85, 100], tierNames: LADDER_10, fmt: v => v + '×', desc: 'Gauntlets cleared.' },
    { id: 'spectrum',   name: 'Full Spectrum',    icon: '🎚️', key: 'temposB',       tiers: TEMPO_COLLECT, tierNames: LADDER_10, fmt: v => v + ' tempos', desc: 'Tempos scored B+ (of 41).' },
    { id: 'sharp',      name: 'Sharpshooter',     icon: '🎯', key: 'temposS',       tiers: TEMPO_COLLECT, tierNames: LADDER_10, fmt: v => v + ' tempos', desc: 'Tempos scored S+ (of 41).' },
    { id: 'untouch',    name: 'Untouchable',      icon: '💎', key: 'temposSS',      tiers: [1, 3, 5, 8, 12, 16, 21, 27, 34, 41], tierNames: LADDER_10, fmt: v => v + ' tempos', desc: 'Tempos scored SS (of 41).' },
    { id: 'first',      name: 'First Blood',      icon: '✅', key: 'total',         tiers: [1],  fmt: v => v + (v === 1 ? ' run' : ' runs'),    desc: 'Complete your first run.' },
    { id: 'perfect',    name: 'Perfectionist',    icon: '✨', key: 'flawless',      tiers: [10], fmt: v => v + (v === 1 ? ' run' : ' runs'), desc: 'Land ten 100%-green runs.' },
    { id: 'coord',      name: 'Coordinated',      icon: '🤹', key: 'instruments',   tiers: [2],  fmt: v => v + (v === 1 ? ' drum' : ' drums'),  desc: 'Log runs on both Kick and Snare.' },
    { id: 'marathon',   name: 'Marathon',         icon: '⏱️', key: 'longestRun',    tiers: [600],fmt: v => fmtMMSS(v),                           desc: 'A single run of 10+ minutes.' },
    { id: 'grandslam',  name: 'Grand Slam',       icon: '🏅', key: 'grandSlam',     tiers: [1],  desc: 'Earn SS on both Kick and Snare.' },
    { id: 'gauntChamp', name: 'Gauntlet Champion',icon: '👑', key: 'gauntletLevels',tiers: [6],  fmt: v => v + ' levels',                        desc: 'Clear every Gauntlet level.' },
  ];

  function fmtMMSS(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function deriveMetrics(runs) {
    const days = [...new Set(runs.map(r => (r.created_at || '').slice(0, 10)).filter(Boolean))].sort();
    const ge = (r, min) => (RANK_ORDER[r.rank] ?? -1) >= RANK_ORDER[min];
    // Distinct free-mode tempos played at a given rank-or-better (either drum).
    const temposAt = (min) => new Set(runs.filter(r => r.bpm && ge(r, min)).map(r => r.bpm)).size;
    // Speed Demon: highest BPM EARNED with an A+ run, per drum.
    const speedBpm = (instr) => runs.reduce((m, r) =>
      (r.bpm && (r.instrument || 'kick') === instr && ge(r, 'A')) ? Math.max(m, r.bpm) : m, 0);
    return {
      total: runs.length,
      kickSpeedBpm: speedBpm('kick'),
      snareSpeedBpm: speedBpm('snare'),
      bestSurvival: runs.reduce((m, r) => Math.max(m, r.survival_sec || 0), 0),
      // Time practiced: actual survival for Sudden Death, else the run's duration.
      totalSeconds: runs.reduce((s, r) => s + (r.mode === 'suddendeath' ? (r.survival_sec || 0) : (r.duration_sec || 0)), 0),
      dayStreak: longestDayStreak(days),
      gauntletClears: runs.filter(r => r.mode === 'gauntlet' && r.cleared).length,
      gauntletLevels: new Set(runs.filter(r => r.mode === 'gauntlet' && r.cleared).map(r => r.level)).size,
      temposB: temposAt('B'),
      temposS: temposAt('S'),
      temposSS: temposAt('SS'),
      flawless: runs.filter(r => (r.green_pct || 0) >= 100).length,
      instruments: new Set(runs.map(r => r.instrument || 'kick')).size,
      longestRun: runs.reduce((m, r) => Math.max(m, r.duration_sec || 0), 0),
      grandSlam: (runs.some(r => (r.instrument || 'kick') === 'kick' && r.rank === 'SS') &&
                  runs.some(r => r.instrument === 'snare' && r.rank === 'SS')) ? 1 : 0,
    };
  }

  function fmtHours(sec) {
    return sec >= 3600 ? Math.round(sec / 3600) + 'h' : Math.round(sec / 60) + 'm';
  }

  function longestDayStreak(days) {
    let best = 0, cur = 0, prev = null;
    for (const d of days) {
      const t = Date.parse(d + 'T00:00:00');
      if (prev !== null && t - prev === 86400000) cur++; else cur = 1;
      prev = t;
      if (cur > best) best = cur;
    }
    return best;
  }

  // Tier display name for a given reached count ('Unlocked' for single-tier trophies).
  function tierName(ach, reached) {
    if (ach.tiers.length <= 1) return reached > 0 ? 'Unlocked' : 'Locked';
    if (reached <= 0) return 'Locked';
    const names = ach.tierNames || TIER_NAMES;
    return names[reached] || ('Tier ' + reached);
  }

  function evaluate(ach, metrics) {
    const value = metrics[ach.key] || 0;
    const reached = ach.tiers.filter(t => value >= t).length;
    const maxed = reached >= ach.tiers.length;
    const earned = reached > 0;
    const next = maxed ? null : ach.tiers[reached];
    const tierColorIdx = reached;   // 0=locked, 1..10 → tier colour classes
    const showVal = ach.fmt ? ach.fmt : (v => v + (ach.unit || ''));
    const tierLabel = tierName(ach, reached);

    let prog, pct;
    if (ach.tiers.length === 1) {
      // Single-tier: show STATUS / progress here — never the desc (it prints on
      // its own line below, so reusing it would just duplicate the same text).
      if (earned) { prog = '★ Unlocked'; pct = 100; }
      else { prog = showVal(value) + ' / ' + showVal(ach.tiers[0]); pct = Math.min(100, value / ach.tiers[0] * 100); }
    }
    else if (maxed) { prog = '★ Maxed · ' + showVal(ach.tiers[ach.tiers.length - 1]); pct = 100; }
    else { prog = showVal(value) + '  →  next ' + showVal(next); pct = Math.min(100, value / next * 100); }

    return { value, reached, maxed, earned, next, pct, tierColorIdx, tierLabel, prog, showVal };
  }

  // { id: reachedTierCount } for the whole list — used to diff before/after a run.
  function reachedMap(runs) {
    const m = deriveMetrics(runs);
    const out = {};
    LIST.forEach(a => { out[a.id] = evaluate(a, m).reached; });
    return out;
  }

  // Newly-raised tiers between two reachedMaps (handles tier-ups, not just unlocks).
  function diff(before, after) {
    const res = [];
    LIST.forEach(a => {
      const b = (before && before[a.id]) || 0;
      const c = (after && after[a.id]) || 0;
      if (c > b) res.push({ ach: a, reached: c });
    });
    return res;
  }

  // Hexagon badge markup (same look as the grid). compact = smaller, for the popup.
  // Badge frame class: single-tier trophies get a distinct 'solo' look when earned
  // (so they don't read as low-tier "Iron"); tiered trophies use tier-1..10.
  function tierClass(ach, reached) {
    if (ach.tiers.length === 1) return reached > 0 ? 'tier-solo' : 'tier-0';
    return 'tier-' + reached;
  }

  function badgeHtml(ach, reached, compact) {
    const lock = reached <= 0 ? '<span class="trophy-lock">🔒</span>' : '';
    // Art badge (trophy-<id>.png). If the art is missing, onerror reverts to the
    // emoji + hexagon fill. Tier is conveyed by the CSS glow (Option A), not by
    // recolouring the art.
    const art = '<img class="trophy-art" src="trophy-' + ach.id + '.png?v=1" alt="" ' +
      'onerror="this.parentNode.classList.remove(\'has-art\');' +
      'this.outerHTML=\'<span class=&quot;trophy-icon&quot;>' + ach.icon + '</span>\';">';
    return '<div class="trophy-badge has-art' + (compact ? ' sm' : '') + ' ' + tierClass(ach, reached) + '">' +
      art + lock + '</div>';
  }

  return { LIST, TIER_NAMES, LADDER_10, deriveMetrics, evaluate, reachedMap, diff, badgeHtml, tierClass, tierName, fmtMMSS };
})();
if (typeof window !== 'undefined') window.Achievements = Achievements;

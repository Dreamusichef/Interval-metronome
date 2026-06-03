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
  const TIER_NAMES = ['', 'Bronze', 'Silver', 'Gold', 'Platinum'];

  const LIST = [
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

  function fmtMMSS(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

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

  function evaluate(ach, metrics) {
    const value = metrics[ach.key] || 0;
    const reached = ach.tiers.filter(t => value >= t).length;
    const maxed = reached >= ach.tiers.length;
    const earned = reached > 0;
    const next = maxed ? null : ach.tiers[reached];
    const tierColorIdx = Math.min(reached, 4);
    const showVal = ach.fmt ? ach.fmt : (v => v + (ach.unit || ''));

    let tierLabel;
    if (ach.tiers.length > 1) tierLabel = earned ? (TIER_NAMES[Math.min(reached, 4)] || ('Tier ' + reached)) : 'Locked';
    else tierLabel = earned ? 'Unlocked' : 'Locked';

    let prog, pct;
    if (maxed) { prog = '★ Maxed · ' + showVal(ach.tiers[ach.tiers.length - 1]); pct = 100; }
    else if (ach.tiers.length === 1) { prog = ach.desc || ('Reach ' + showVal(ach.tiers[0])); pct = Math.min(100, value / ach.tiers[0] * 100); }
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
  function badgeHtml(ach, reached, compact) {
    const tierIdx = Math.min(reached, 4);
    return '<div class="trophy-badge' + (compact ? ' sm' : '') + ' tier-' + tierIdx + '">' +
      '<span class="trophy-icon">' + ach.icon + '</span></div>';
  }

  return { LIST, TIER_NAMES, deriveMetrics, evaluate, reachedMap, diff, badgeHtml, fmtMMSS };
})();
if (typeof window !== 'undefined') window.Achievements = Achievements;

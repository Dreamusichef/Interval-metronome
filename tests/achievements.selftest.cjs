'use strict';

/*
  Self-test for trophy metric derivation, tier evaluation, and retroactive diffing
  in achievements.js.

  Covers: deriveMetrics maths, day-streak counting, tier ladders, progress %,
  reachedMap snapshots, and diff() for new unlocks / multi-tier jumps / history sync.

  Run:  node tests/achievements.selftest.cjs
*/

const A = require('../assets/js/achievements.js');
const { LIST, deriveMetrics, evaluate, reachedMap, diff, tierName, tierClass, fmtMMSS } = A;

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✓ ' + msg); }
  else { console.error('  ✗ ' + msg); failures++; }
}
function byId(id) { return LIST.find(t => t.id === id); }

// Minimal run row factory — mirrors Supabase `runs` columns used by deriveMetrics.
function run(overrides) {
  return Object.assign({
    created_at: '2026-06-01T12:00:00Z',
    mode: 'timetrial',
    rank: 'B',
    bpm: 100,
    instrument: 'kick',
    duration_sec: 120,
    survival_sec: 0,
    green_pct: 80,
    cleared: false,
    level: 1,
  }, overrides);
}

console.log('\n[1] deriveMetrics — core counters and per-drum speed');
{
  const runs = [
    run({ rank: 'A', bpm: 150, instrument: 'kick', duration_sec: 60 }),
    run({ rank: 'S', bpm: 180, instrument: 'kick', duration_sec: 90, green_pct: 100 }),
    run({ rank: 'A', bpm: 140, instrument: 'snare', duration_sec: 45 }),
    run({ rank: 'B', bpm: 200, instrument: 'kick' }),          // B rank — no speed credit
    run({ mode: 'suddendeath', survival_sec: 95, duration_sec: 0 }),
    run({ mode: 'gauntlet', cleared: true, level: 2 }),
    run({ mode: 'gauntlet', cleared: true, level: 4 }),
    run({ mode: 'gauntlet', cleared: false, level: 6 }),        // not cleared
  ];
  const m = deriveMetrics(runs);
  assert(m.total === 8, 'total = run count');
  assert(m.kickSpeedBpm === 180, 'kick speed = highest A+ BPM on kick');
  assert(m.snareSpeedBpm === 140, 'snare speed = highest A+ BPM on snare');
  assert(m.bestSurvival === 95, 'bestSurvival = max survival_sec');
  assert(m.totalSeconds === 60 + 90 + 45 + 120 + 95 + 120 + 120 + 120,
    'totalSeconds sums duration (non-SD) + survival (SD)');
  assert(m.gauntletClears === 2, 'gauntletClears counts cleared gauntlet runs only');
  assert(m.gauntletLevels === 2, 'gauntletLevels = distinct cleared levels');
  assert(m.flawless === 1, 'flawless = runs with green_pct >= 100');
  assert(m.instruments === 2, 'instruments = distinct kick + snare');
  assert(m.longestRun === 120, 'longestRun = max duration_sec');
}

console.log('\n[2] deriveMetrics — tempo collection & grand slam');
{
  const runs = [
    run({ bpm: 80, rank: 'B' }),
    run({ bpm: 100, rank: 'B' }),
    run({ bpm: 120, rank: 'A' }),   // A counts for B-tier collection
    run({ bpm: 140, rank: 'S' }),
    run({ bpm: 160, rank: 'SS', instrument: 'kick' }),
    run({ bpm: 180, rank: 'SS', instrument: 'snare' }),
  ];
  const m = deriveMetrics(runs);
  assert(m.temposB === 6, 'temposB = all six distinct BPMs are B+ or better');
  assert(m.temposS === 3, 'temposS = distinct BPMs at S+ (140, 160, 180)');
  assert(m.temposSS === 2, 'temposSS = distinct BPMs at SS (160 kick, 180 snare)');
  assert(m.grandSlam === 1, 'grandSlam when kick SS and snare SS both exist');
}

console.log('\n[3] deriveMetrics — grand slam requires BOTH drums at SS');
{
  const kickOnly = [run({ rank: 'SS', instrument: 'kick' })];
  const snareOnly = [run({ rank: 'SS', instrument: 'snare' })];
  assert(deriveMetrics(kickOnly).grandSlam === 0, 'kick-only SS is not a grand slam');
  assert(deriveMetrics(snareOnly).grandSlam === 0, 'snare-only SS is not a grand slam');
}

console.log('\n[4] longestDayStreak — consecutive calendar days');
{
  const m0 = deriveMetrics([]);
  assert(m0.dayStreak === 0, 'no runs → streak 0');

  const m1 = deriveMetrics([run({ created_at: '2026-06-05T08:00:00Z' })]);
  assert(m1.dayStreak === 1, 'single day → streak 1');

  const m3 = deriveMetrics([
    run({ created_at: '2026-06-01T10:00:00Z' }),
    run({ created_at: '2026-06-02T22:00:00Z' }),
    run({ created_at: '2026-06-03T06:00:00Z' }),
  ]);
  assert(m3.dayStreak === 3, 'three consecutive days → streak 3');

  const mGap = deriveMetrics([
    run({ created_at: '2026-06-01T10:00:00Z' }),
    run({ created_at: '2026-06-02T10:00:00Z' }),
    run({ created_at: '2026-06-04T10:00:00Z' }),   // gap on 06-03
    run({ created_at: '2026-06-05T10:00:00Z' }),
  ]);
  assert(mGap.dayStreak === 2, 'gap resets streak; best segment is 2');
}

console.log('\n[5] evaluate — tier ladder & progress maths');
{
  const mileage = byId('mileage');
  let e = evaluate(mileage, { total: 0 });
  assert(e.reached === 0 && !e.earned && e.next === 5, '0 runs → locked, next tier 5');
  assert(Math.abs(e.pct - 0) < 1e-9, 'locked progress % toward first tier');

  e = evaluate(mileage, { total: 7 });
  assert(e.reached === 1 && e.earned && e.next === 10 && !e.maxed, '7 runs → Iron (tier 1), next 10');
  assert(Math.abs(e.pct - 70) < 1e-9, '7/10 → 70% toward next tier');

  e = evaluate(mileage, { total: 1000 });
  assert(e.maxed && e.reached === mileage.tiers.length && e.next === null, '1000 runs → maxed');
  assert(e.pct === 100, 'maxed → 100%');

  const first = byId('first');
  e = evaluate(first, { total: 1 });
  assert(e.reached === 1 && e.tierLabel === 'Unlocked', 'single-tier trophy shows Unlocked');
  e = evaluate(first, { total: 0 });
  assert(e.reached === 0 && e.tierLabel === 'Locked', 'single-tier locked label');
  assert(Math.abs(e.pct - 0) < 1e-9, 'single-tier 0 progress');

  const speed = byId('speedKick');
  e = evaluate(speed, { kickSpeedBpm: 165 });
  assert(e.reached === 5, '165 BPM → Emerald (5th speed tier)');
  assert(tierName(speed, e.reached) === 'Emerald', 'tierName matches ladder');
}

console.log('\n[6] evaluate — speed demon requires A+ rank in deriveMetrics');
{
  const runs = [
    run({ rank: 'B', bpm: 240, instrument: 'kick' }),  // high BPM but not A+
    run({ rank: 'A', bpm: 130, instrument: 'kick' }),
  ];
  const m = deriveMetrics(runs);
  const e = evaluate(byId('speedKick'), m);
  assert(m.kickSpeedBpm === 130, 'B-rank 240 ignored for speed metric');
  assert(e.reached === 2, '130 BPM → 2 speed tiers (120, 130)');
}

console.log('\n[7] reachedMap — snapshot for every trophy id');
{
  const runs = [run({ rank: 'SS', instrument: 'kick' }), run({ rank: 'SS', instrument: 'snare' })];
  const map = reachedMap(runs);
  assert(LIST.every(t => typeof map[t.id] === 'number'), 'every LIST id has a reached count');
  assert(map.grandslam === 1, 'reachedMap picks up grand slam');
  assert(map.first === 1, 'reachedMap picks up first blood from total');
}

console.log('\n[8] diff — new unlock after a single run');
{
  const before = reachedMap([]);
  const after = reachedMap([run({ rank: 'C', duration_sec: 30 })]);
  const d = diff(before, after);
  const ids = d.map(x => x.ach.id);
  assert(ids.includes('first'), 'first run unlocks First Blood');
  assert(!ids.includes('mileage'), 'first run alone does not reach Mileage tier 1 (needs 5)');
  assert(d.find(x => x.ach.id === 'first').reached === 1, 'diff reports reached tier count');
}

console.log('\n[9] diff — tier-up (not just first unlock)');
{
  const four = Array.from({ length: 4 }, () => run({ duration_sec: 10 }));
  const before = reachedMap(four);
  const after = reachedMap([...four, run({ duration_sec: 10 })]);
  const d = diff(before, after);
  const mileage = d.find(x => x.ach.id === 'mileage');
  assert(mileage && mileage.reached === 1, '5th run raises Mileage to tier 1');
  assert(!d.find(x => x.ach.id === 'first'), 'First Blood unchanged — not in diff');
}

console.log('\n[10] diff — multi-tier jump in one diff entry');
{
  const before = { speedKick: 0 };
  const afterMap = reachedMap([
    run({ rank: 'SS', bpm: 210, instrument: 'kick' }),
  ]);
  const d = diff(before, afterMap);
  const sk = d.find(x => x.ach.id === 'speedKick');
  assert(sk && sk.reached === 8, '210 BPM SS run jumps to tier 8 in one diff (not 8 separate rows)');
  assert(d.filter(x => x.ach.id === 'speedKick').length === 1, 'one diff row per trophy');
}

console.log('\n[11] diff — retroactive history sync (new runs reveal old tiers)');
{
  // Player had 3 runs locally; cloud later returns 12 historical runs.
  const local = Array.from({ length: 3 }, (_, i) =>
    run({ created_at: `2026-06-0${i + 1}T12:00:00Z`, duration_sec: 60 }));
  const before = reachedMap(local);

  const synced = [
    ...local,
    ...Array.from({ length: 9 }, (_, i) =>
      run({ created_at: `2026-05-${String(10 + i).padStart(2, '0')}T12:00:00Z`, duration_sec: 60 })),
  ];
  const after = reachedMap(synced);
  const d = diff(before, after);

  assert(after.mileage >= 2, 'synced history crosses second Mileage tier');
  const mileage = d.find(x => x.ach.id === 'mileage');
  assert(mileage && mileage.reached >= 2, 'diff surfaces retroactive Mileage tier-up');
  assert(d.every(x => x.reached > (before[x.ach.id] || 0)), 'every diff entry strictly increases reached');
}

console.log('\n[12] diff — no false positives when nothing changed');
{
  const runs = [run({ rank: 'A', bpm: 100 }), run({ rank: 'B', bpm: 120 })];
  const map = reachedMap(runs);
  assert(diff(map, map).length === 0, 'identical maps → empty diff');
  assert(diff(null, map).length === LIST.filter(t => reachedMap(runs)[t.id] > 0).length,
    'null before treats all earned tiers as new');
}

console.log('\n[13] fmtMMSS & tierClass smoke checks');
{
  assert(fmtMMSS(125) === '2:05', 'fmtMMSS pads seconds');
  assert(fmtMMSS(-5) === '0:00', 'fmtMMSS clamps negative');
  const solo = byId('first');
  assert(tierClass(solo, 0) === 'tier-0' && tierClass(solo, 1) === 'tier-solo', 'single-tier class');
  assert(tierClass(byId('mileage'), 3) === 'tier-3', 'tiered trophy class');
}

console.log('\n' + (failures === 0
  ? 'ALL ACHIEVEMENT CHECKS PASSED'
  : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);

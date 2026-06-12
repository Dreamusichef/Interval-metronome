'use strict';

/*
  Unit tests for trophy metric derivation, tier evaluation, and retroactive diffing
  in achievements.js.

  Covers: deriveMetrics maths, day-streak counting, tier ladders, progress %,
  reachedMap snapshots, and diff() for new unlocks / multi-tier jumps / history sync.

  Run:  npm test   (or:  node --test tests/achievements.test.cjs)
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('../assets/js/achievements.js');
const { LIST, deriveMetrics, evaluate, reachedMap, diff, tierName, tierClass, fmtMMSS } = A;

function byId(id) { return LIST.find(t => t.id === id); }

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

describe('deriveMetrics — core counters and per-drum speed', () => {
  test('aggregates run counts, speeds, survival, gauntlet, and totals', () => {
    const runs = [
      run({ rank: 'A', bpm: 150, instrument: 'kick', duration_sec: 60 }),
      run({ rank: 'S', bpm: 180, instrument: 'kick', duration_sec: 90, green_pct: 100 }),
      run({ rank: 'A', bpm: 140, instrument: 'snare', duration_sec: 45 }),
      run({ rank: 'B', bpm: 200, instrument: 'kick' }),
      run({ mode: 'suddendeath', survival_sec: 95, duration_sec: 0 }),
      run({ mode: 'gauntlet', cleared: true, level: 2 }),
      run({ mode: 'gauntlet', cleared: true, level: 4 }),
      run({ mode: 'gauntlet', cleared: false, level: 6 }),
    ];
    const m = deriveMetrics(runs);
    assert.equal(m.total, 8);
    assert.equal(m.kickSpeedBpm, 180);
    assert.equal(m.snareSpeedBpm, 140);
    assert.equal(m.bestSurvival, 95);
    assert.equal(m.totalSeconds, 60 + 90 + 45 + 120 + 95 + 120 + 120 + 120);
    assert.equal(m.gauntletClears, 2);
    assert.equal(m.gauntletLevels, 2);
    assert.equal(m.flawless, 1);
    assert.equal(m.instruments, 2);
    assert.equal(m.longestRun, 120);
  });
});

describe('deriveMetrics — tempo collection & grand slam', () => {
  test('counts distinct tempos at each rank tier', () => {
    const runs = [
      run({ bpm: 80, rank: 'B' }),
      run({ bpm: 100, rank: 'B' }),
      run({ bpm: 120, rank: 'A' }),
      run({ bpm: 140, rank: 'S' }),
      run({ bpm: 160, rank: 'SS', instrument: 'kick' }),
      run({ bpm: 180, rank: 'SS', instrument: 'snare' }),
    ];
    const m = deriveMetrics(runs);
    assert.equal(m.temposB, 6);
    assert.equal(m.temposS, 3);
    assert.equal(m.temposSS, 2);
    assert.equal(m.grandSlam, 1);
  });
});

describe('deriveMetrics — grand slam requires BOTH drums at SS', () => {
  test('kick-only SS is not a grand slam', () => {
    assert.equal(deriveMetrics([run({ rank: 'SS', instrument: 'kick' })]).grandSlam, 0);
  });

  test('snare-only SS is not a grand slam', () => {
    assert.equal(deriveMetrics([run({ rank: 'SS', instrument: 'snare' })]).grandSlam, 0);
  });
});

describe('longestDayStreak', () => {
  test('no runs → streak 0', () => {
    assert.equal(deriveMetrics([]).dayStreak, 0);
  });

  test('single day → streak 1', () => {
    assert.equal(deriveMetrics([run({ created_at: '2026-06-05T08:00:00Z' })]).dayStreak, 1);
  });

  test('three consecutive days → streak 3', () => {
    const m = deriveMetrics([
      run({ created_at: '2026-06-01T10:00:00Z' }),
      run({ created_at: '2026-06-02T22:00:00Z' }),
      run({ created_at: '2026-06-03T06:00:00Z' }),
    ]);
    assert.equal(m.dayStreak, 3);
  });

  test('gap resets streak; best segment is 2', () => {
    const m = deriveMetrics([
      run({ created_at: '2026-06-01T10:00:00Z' }),
      run({ created_at: '2026-06-02T10:00:00Z' }),
      run({ created_at: '2026-06-04T10:00:00Z' }),
      run({ created_at: '2026-06-05T10:00:00Z' }),
    ]);
    assert.equal(m.dayStreak, 2);
  });
});

describe('evaluate — tier ladder & progress', () => {
  test('0 runs → locked, next tier 5', () => {
    const mileage = byId('mileage');
    const e = evaluate(mileage, { total: 0 });
    assert.equal(e.reached, 0);
    assert.equal(e.earned, false);
    assert.equal(e.next, 5);
    assert.ok(Math.abs(e.pct - 0) < 1e-9);
  });

  test('7 runs → Iron (tier 1), 70% toward next', () => {
    const mileage = byId('mileage');
    const e = evaluate(mileage, { total: 7 });
    assert.equal(e.reached, 1);
    assert.equal(e.earned, true);
    assert.equal(e.next, 10);
    assert.equal(e.maxed, false);
    assert.ok(Math.abs(e.pct - 70) < 1e-9);
  });

  test('1000 runs → maxed at top tier', () => {
    const mileage = byId('mileage');
    const e = evaluate(mileage, { total: 1000 });
    assert.equal(e.maxed, true);
    assert.equal(e.reached, mileage.tiers.length);
    assert.equal(e.next, null);
    assert.equal(e.pct, 100);
  });

  test('single-tier trophy locked / unlocked labels', () => {
    const first = byId('first');
    let e = evaluate(first, { total: 1 });
    assert.equal(e.reached, 1);
    assert.equal(e.tierLabel, 'Unlocked');
    e = evaluate(first, { total: 0 });
    assert.equal(e.reached, 0);
    assert.equal(e.tierLabel, 'Locked');
    assert.ok(Math.abs(e.pct - 0) < 1e-9);
  });

  test('speed kick tier name matches ladder', () => {
    const speed = byId('speedKick');
    const e = evaluate(speed, { kickSpeedBpm: 165 });
    assert.equal(e.reached, 5);
    assert.equal(tierName(speed, e.reached), 'Emerald');
  });
});

describe('evaluate — speed demon requires A+ rank', () => {
  test('B-rank high BPM ignored; A-rank sets speed metric', () => {
    const runs = [
      run({ rank: 'B', bpm: 240, instrument: 'kick' }),
      run({ rank: 'A', bpm: 130, instrument: 'kick' }),
    ];
    const m = deriveMetrics(runs);
    const e = evaluate(byId('speedKick'), m);
    assert.equal(m.kickSpeedBpm, 130);
    assert.equal(e.reached, 2);
  });
});

describe('reachedMap', () => {
  test('snapshot covers every trophy id', () => {
    const runs = [run({ rank: 'SS', instrument: 'kick' }), run({ rank: 'SS', instrument: 'snare' })];
    const map = reachedMap(runs);
    assert.ok(LIST.every(t => typeof map[t.id] === 'number'));
    assert.equal(map.grandslam, 1);
    assert.equal(map.first, 1);
  });
});

describe('diff — new unlock', () => {
  test('first run unlocks First Blood only', () => {
    const before = reachedMap([]);
    const after = reachedMap([run({ rank: 'C', duration_sec: 30 })]);
    const d = diff(before, after);
    const ids = d.map(x => x.ach.id);
    assert.ok(ids.includes('first'));
    assert.ok(!ids.includes('mileage'));
    assert.equal(d.find(x => x.ach.id === 'first').reached, 1);
  });
});

describe('diff — tier-up', () => {
  test('5th run raises Mileage to tier 1', () => {
    const four = Array.from({ length: 4 }, () => run({ duration_sec: 10 }));
    const before = reachedMap(four);
    const after = reachedMap([...four, run({ duration_sec: 10 })]);
    const d = diff(before, after);
    const mileage = d.find(x => x.ach.id === 'mileage');
    assert.ok(mileage);
    assert.equal(mileage.reached, 1);
    assert.equal(d.find(x => x.ach.id === 'first'), undefined);
  });
});

describe('diff — multi-tier jump', () => {
  test('210 BPM SS run jumps to tier 8 in one diff row', () => {
    const before = { speedKick: 0 };
    const afterMap = reachedMap([run({ rank: 'SS', bpm: 210, instrument: 'kick' })]);
    const d = diff(before, afterMap);
    const sk = d.find(x => x.ach.id === 'speedKick');
    assert.ok(sk);
    assert.equal(sk.reached, 8);
    assert.equal(d.filter(x => x.ach.id === 'speedKick').length, 1);
  });
});

describe('diff — retroactive history sync', () => {
  test('synced cloud history surfaces tier-ups', () => {
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
    assert.ok(after.mileage >= 2);
    const mileage = d.find(x => x.ach.id === 'mileage');
    assert.ok(mileage);
    assert.ok(mileage.reached >= 2);
    assert.ok(d.every(x => x.reached > (before[x.ach.id] || 0)));
  });
});

describe('diff — no false positives', () => {
  test('identical maps → empty diff', () => {
    const runs = [run({ rank: 'A', bpm: 100 }), run({ rank: 'B', bpm: 120 })];
    const map = reachedMap(runs);
    assert.equal(diff(map, map).length, 0);
  });

  test('null before treats all earned tiers as new', () => {
    const runs = [run({ rank: 'A', bpm: 100 }), run({ rank: 'B', bpm: 120 })];
    const map = reachedMap(runs);
    assert.equal(diff(null, map).length, LIST.filter(t => reachedMap(runs)[t.id] > 0).length);
  });
});

describe('fmtMMSS & tierClass', () => {
  test('fmtMMSS pads seconds and clamps negative', () => {
    assert.equal(fmtMMSS(125), '2:05');
    assert.equal(fmtMMSS(-5), '0:00');
  });

  test('tierClass for single-tier and tiered trophies', () => {
    const solo = byId('first');
    assert.equal(tierClass(solo, 0), 'tier-0');
    assert.equal(tierClass(solo, 1), 'tier-solo');
    assert.equal(tierClass(byId('mileage'), 3), 'tier-3');
  });
});

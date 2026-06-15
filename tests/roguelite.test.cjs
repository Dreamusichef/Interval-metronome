'use strict';

/*
  Unit tests for the pure timing math in roguelite.js.

  Executable form of the §6 / §11-step-1 verification: clock-reconciliation
  conversions are exact, calibration recovers systematic offset and spread, and a
  constant clock-origin error is absorbed into meanOffset (the "masking" property
  §6 warns about) while sd — the thing we show the player — is invariant.

  MIDI hardware is verified live (roguelite.js logs raw kick offsets on the first
  calibration hits). This file covers the formulas only.

  Run:  npm test   (or:  node --test tests/roguelite.test.cjs)
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/js/roguelite.js');
const {
  audioToPerfMs, perfMsToAudio, computeCalibration, classifyHit, classifySlot, classifyFirstSlot,
  rankFor, endurancePct, accuracyPct, runResultPct, liveGaugePct,
} = M;

function approx(a, b, tol, msg) {
  assert.ok(Math.abs(a - b) <= tol, `${msg} (${a} vs ${b}, tol ${tol})`);
}

// Deterministic pseudo-random + approx-normal (sum of 12 uniforms − 6 → ~N(0,1)).
let seed = 1234567;
function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function gauss(mean, sd) {
  let s = 0; for (let i = 0; i < 12; i++) s += rand();
  return mean + (s - 6) * sd;
}

describe('clock reconciliation', () => {
  const sync = { a0: 12.3456, p0: 987654.321 };

  for (const audioSec of [12.3456, 13.0, 20.5, 100.25]) {
    test(`audio ${audioSec}s → perf → audio round-trips`, () => {
      const perf = audioToPerfMs(audioSec, sync);
      const back = perfMsToAudio(perf, sync);
      approx(back, audioSec, 1e-9, 'round-trip');
    });
  }

  test('0.5s ahead maps to +500ms perf', () => {
    approx(audioToPerfMs(sync.a0 + 0.5, sync), sync.p0 + 500, 1e-9, '0.5s ahead == +500ms');
  });
});

describe('calibration', { concurrency: 1 }, () => {
  const SYSTEMATIC = 18.0;
  const SPREAD = 9.0;
  let calA;

  test('recovers systematic offset (mean) and spread (sd)', () => {
    const expected = [];
    const events = [];
    for (let i = 0; i < 56; i++) {
      const clickPerf = 100000 + i * 600;
      expected.push(clickPerf);
      events.push(clickPerf + gauss(SYSTEMATIC, SPREAD));
    }
    calA = computeCalibration(expected, events, 150);
    assert.equal(calA.sampleCount, 56, 'all 56 clicks matched a kick');
    approx(calA.meanOffset, SYSTEMATIC, 2.5, 'meanOffset ≈ systematic offset');
    approx(calA.sd, SPREAD, 2.5, 'sd ≈ player spread');
  });

  test('constant clock-origin error is absorbed by mean; sd is invariant (§6)', () => {
    const BOGUS = 250.0;
    seed = 1234567;
    const expected = [];
    const events = [];
    for (let i = 0; i < 56; i++) {
      const clickPerf = 100000 + i * 600;
      expected.push(clickPerf);
      events.push(clickPerf + gauss(SYSTEMATIC, SPREAD) + BOGUS);
    }
    const calB = computeCalibration(expected, events, 150 + BOGUS);
    approx(calB.meanOffset, calA.meanOffset + BOGUS, 0.001, 'meanOffset absorbs the constant exactly');
    approx(calB.sd, calA.sd, 0.001, 'sd is unchanged by the constant (skill measure is safe)');
  });
});

describe('hit classification', () => {
  const meanOffset = 18.0;
  const windowMs = 25;
  const search = 150;
  const expected = 200000;
  const centre = expected + meanOffset;

  test('within window → clear', () => {
    const r = classifyHit(expected, meanOffset, windowMs, [{ t: centre + 10, consumed: false }], search);
    assert.equal(r.result, 'clear');
    approx(r.offset, 10, 1e-9, 'clear reports +10ms (corrected)');
  });

  test('beyond window but nearby → out', () => {
    const r = classifyHit(expected, meanOffset, windowMs, [{ t: centre + 60, consumed: false }], search);
    assert.equal(r.result, 'out');
    approx(r.offset, 60, 1e-9, 'out reports +60ms');
  });

  test('nothing in search window → miss', () => {
    const r = classifyHit(expected, meanOffset, windowMs, [{ t: centre + 5000, consumed: false }], search);
    assert.equal(r.result, 'miss');
  });

  test('no events at all → miss', () => {
    const r = classifyHit(expected, meanOffset, windowMs, [], search);
    assert.equal(r.result, 'miss');
  });

  test('early hit reports negative offset', () => {
    const r = classifyHit(expected, meanOffset, windowMs, [{ t: centre - 12, consumed: false }], search);
    approx(r.offset, -12, 1e-9, 'early hit reports negative (rushing)');
  });

  test('consumed event skipped → matches the next one', () => {
    const evs = [{ t: centre, consumed: true }, { t: centre + 10, consumed: false }];
    const r = classifyHit(expected, meanOffset, windowMs, evs, search);
    assert.equal(r.eventIndex, 1);
    assert.equal(r.result, 'clear');
  });
});

describe('continuity-game presence slots', () => {
  const FACTOR = 0.5;

  for (const bpm of [80, 200]) {
    test(`${bpm} BPM 16ths tile cleanly at factor 0.5`, () => {
      const spacing = 60000 / bpm / 4;
      const slotWidth = 2 * (spacing * FACTOR);
      assert.ok(Math.abs(slotWidth - spacing) < 1e-9,
        `slot width ${slotWidth.toFixed(1)}ms == spacing ${spacing.toFixed(1)}ms`);
    });
  }
});

describe('slot gate', () => {
  const centre = 1000;
  const h = 40;
  const mean = 0;
  const E = (...ts) => ts.map(t => ({ t, consumed: false }));

  test('empty slot → drop', () => {
    const r = classifySlot(centre, mean, h, E());
    assert.equal(r.result, 'drop');
    assert.equal(r.count, 0);
  });

  test('one kick in slot → clear', () => {
    const r = classifySlot(centre, mean, h, E(1012));
    assert.equal(r.result, 'clear');
    assert.equal(r.count, 1);
  });

  test('two kicks in one slot → cram', () => {
    const r = classifySlot(centre, mean, h, E(985, 1015));
    assert.equal(r.result, 'cram');
    assert.equal(r.count, 2);
  });

  test('only the in-slot kick counts (neighbours ignored)', () => {
    const r = classifySlot(centre, mean, h, E(900, 1005, 1100));
    assert.equal(r.result, 'clear');
    assert.equal(r.indices[0], 1);
  });

  test('left edge (centre−h) is inside the slot', () => {
    const r = classifySlot(centre, mean, h, E(960));
    assert.equal(r.result, 'clear');
  });

  test('right edge (centre+h) belongs to the NEXT slot', () => {
    const r = classifySlot(centre, mean, h, E(1040));
    assert.equal(r.result, 'drop');
  });

  test('meanOffset shifts the slot centre', () => {
    const r = classifySlot(centre, 100, h, E(1100));
    assert.equal(r.result, 'clear');
  });

  test('consumed kicks are skipped', () => {
    const evs = [{ t: 1005, consumed: true }, { t: 1020, consumed: false }];
    const r = classifySlot(centre, mean, h, evs);
    assert.equal(r.result, 'clear');
    assert.equal(r.count, 1);
  });
});

describe('first-slot leniency', () => {
  const centre = 1000;
  const h = 40;
  const mean = 0;
  const early = 120;
  const E = (...ts) => ts.map(t => ({ t, consumed: false }));

  test('normal slot drops a 90ms-early start; first slot clears it', () => {
    const normal = classifySlot(centre, mean, h, E(910));
    assert.equal(normal.result, 'drop');
    const r = classifyFirstSlot(centre, mean, h, E(910), early);
    assert.equal(r.result, 'clear');
    assert.equal(r.offset, -90);
  });

  test('first slot still drops when nothing is played', () => {
    const r = classifyFirstSlot(centre, mean, h, E(), early);
    assert.equal(r.result, 'drop');
  });

  test('kick past the normal late edge is left for the next slot', () => {
    const r = classifyFirstSlot(centre, mean, h, E(1041), early);
    assert.equal(r.result, 'drop');
  });

  test('kick earlier than the grace window is not counted', () => {
    const r = classifyFirstSlot(centre, mean, h, E(870), early);
    assert.equal(r.result, 'drop');
  });

  test('on-time start clears', () => {
    const r = classifyFirstSlot(centre, mean, h, E(1005), early);
    assert.equal(r.result, 'clear');
  });
});

describe('run scoring', () => {
  test('gauntlet fail: endurance pct = slots cleared ÷ full-run slots', () => {
    const tally = { good: 50, neutral: 0, bad: 1 };
    const r = runResultPct({
      mode: 'gauntlet', status: 'failed', hitsCleared: 200, totalRunBeats: 450, tally,
    });
    assert.equal(r.pct, 11);   // 200 / (450×4) ≈ 11%
    assert.equal(r.rank, 'E');
    assert.notEqual(r.pct, accuracyPct(tally));   // not 50/51 ≈ 98%
  });

  test('gauntlet complete is always SS / 100%', () => {
    const r = runResultPct({
      mode: 'gauntlet', status: 'complete', hitsCleared: 0, totalRunBeats: 450, tally: {},
    });
    assert.equal(r.pct, 100);
    assert.equal(r.rank, 'SS');
  });

  test('sudden death fail uses the same endurance formula', () => {
    const r = runResultPct({
      mode: 'suddendeath', status: 'failed', hitsCleared: 480, totalRunBeats: 360, tally: { good: 119, neutral: 1, bad: 1 },
    });
    assert.equal(r.pct, 33);   // 480 / 1440
    assert.equal(r.rank, 'D');
  });

  test('time trial grades accuracy of beats played', () => {
    const tally = { good: 90, neutral: 5, bad: 5 };
    const r = runResultPct({
      mode: 'timetrial', status: 'complete', hitsCleared: 400, totalRunBeats: 360, tally,
    });
    assert.equal(r.pct, 90);
    assert.equal(r.rank, 'A');
  });

  test('liveGaugePct matches endurance scoring during gauntlet runs', () => {
    const tally = { good: 80, neutral: 20, bad: 0 };
    const g = liveGaugePct({
      mode: 'gauntlet', hitsCleared: 400, totalRunBeats: 450, tally,
    });
    assert.equal(g, 22);
    assert.notEqual(g, Math.round(tally.good / 450 * 100));
  });

  test('liveGaugePct for time trial uses good quarter-beats vs full target', () => {
    const tally = { good: 80, neutral: 20, bad: 0 };
    const g = liveGaugePct({
      mode: 'timetrial', hitsCleared: 400, totalRunBeats: 360, tally,
    });
    assert.equal(g, 22);   // 80 / 360
  });

  test('rankFor bands', () => {
    assert.equal(rankFor(100), 'SS');
    assert.equal(rankFor(99), 'SS');
    assert.equal(rankFor(91), 'S');
    assert.equal(rankFor(25), 'E');
  });
});

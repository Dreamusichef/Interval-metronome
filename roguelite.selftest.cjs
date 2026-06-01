'use strict';

/*
  Self-test for the pure timing math in roguelite.js.

  This is the executable form of the §6 / §11-step-1 verification: it proves the
  clock-reconciliation conversions are exact, that calibration recovers the
  systematic offset and the spread, and that a constant clock-origin error is
  absorbed into meanOffset (the "masking" property §6 warns about) while the sd —
  the thing we show the player — is invariant to it.

  It can't exercise real MIDI hardware; that part is verified live (roguelite.js
  logs raw kick offsets on the first calibration hits — they must read as tens of
  ms, not thousands). This covers the formulas.

  Run:  node roguelite.selftest.cjs
*/

const M = require('./roguelite.js');
const { audioToPerfMs, perfMsToAudio, computeCalibration, classifyHit } = M;

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✓ ' + msg); }
  else { console.error('  ✗ ' + msg); failures++; }
}
function approx(a, b, tol, msg) { assert(Math.abs(a - b) <= tol, msg + ` (${a} vs ${b}, tol ${tol})`); }

// Deterministic pseudo-random + approx-normal (sum of 12 uniforms − 6 → ~N(0,1)).
let seed = 1234567;
function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function gauss(mean, sd) {
  let s = 0; for (let i = 0; i < 12; i++) s += rand();
  return mean + (s - 6) * sd;
}
function stdev(arr) {
  const m = arr.reduce((s, x) => s + x, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) * (x - m), 0) / arr.length);
}

console.log('\n[1] Clock reconciliation — round-trip exactness');
{
  const sync = { a0: 12.3456, p0: 987654.321 };       // arbitrary audio/perf sample
  for (const audioSec of [12.3456, 13.0, 20.5, 100.25]) {
    const perf = audioToPerfMs(audioSec, sync);
    const back = perfMsToAudio(perf, sync);
    approx(back, audioSec, 1e-9, `audio ${audioSec}s → perf → audio round-trips`);
  }
  // A tick 0.5s after the sync point must map 500ms after the sync perf time.
  approx(audioToPerfMs(sync.a0 + 0.5, sync), sync.p0 + 500, 1e-9, '0.5s ahead == +500ms');
}

console.log('\n[2] Calibration — recovers systematic offset (mean) and spread (sd)');
let calA;
{
  const SYSTEMATIC = 18.0;   // ms: hardware latency + habitual bias, constant
  const SPREAD = 9.0;        // ms: player jitter (the skill component)
  const expected = [];
  const events = [];
  for (let i = 0; i < 56; i++) {                // 14 measured bars × 4 quarters @100bpm
    const clickPerf = 100000 + i * 600;         // 600ms between quarter notes
    expected.push(clickPerf);
    events.push(clickPerf + gauss(SYSTEMATIC, SPREAD));
  }
  calA = computeCalibration(expected, events, 150);
  assert(calA.sampleCount === 56, 'all 56 clicks matched a kick');
  approx(calA.meanOffset, SYSTEMATIC, 2.5, 'meanOffset ≈ systematic offset');
  approx(calA.sd, SPREAD, 2.5, 'sd ≈ player spread');
}

console.log('\n[3] Constant clock-origin error is ABSORBED by mean; sd is invariant (§6)');
{
  // Same hits, but every event shifted by a bogus constant (e.g. wrong timeStamp
  // origin). meanOffset must shift by exactly that constant; sd must not move.
  const BOGUS = 250.0;
  const SYSTEMATIC = 18.0, SPREAD = 9.0;
  seed = 1234567; // reset RNG to reproduce the same jitter sequence as [2]
  const expected = [], events = [];
  for (let i = 0; i < 56; i++) {
    const clickPerf = 100000 + i * 600;
    expected.push(clickPerf);
    events.push(clickPerf + gauss(SYSTEMATIC, SPREAD) + BOGUS);
  }
  const calB = computeCalibration(expected, events, 150 + BOGUS); // widen capture so they still match
  approx(calB.meanOffset, calA.meanOffset + BOGUS, 0.001, 'meanOffset absorbs the constant exactly');
  approx(calB.sd, calA.sd, 0.001, 'sd is unchanged by the constant (skill measure is safe)');
}

console.log('\n[4] Hit classification — clear / out / miss after offset subtraction');
{
  const meanOffset = 18.0, windowMs = 25, search = 150;
  const expected = 200000;
  const centre = expected + meanOffset;

  // clear: within ±25ms of the corrected centre
  let r = classifyHit(expected, meanOffset, windowMs, [{ t: centre + 10, consumed: false }], search);
  assert(r.result === 'clear', 'within window → clear');
  approx(r.offset, 10, 1e-9, 'clear reports +10ms (corrected)');

  // out: real hit but beyond the window (still within search)
  r = classifyHit(expected, meanOffset, windowMs, [{ t: centre + 60, consumed: false }], search);
  assert(r.result === 'out', 'beyond window but nearby → out (fails)');
  approx(r.offset, 60, 1e-9, 'out reports +60ms');

  // miss: nothing anywhere near
  r = classifyHit(expected, meanOffset, windowMs, [{ t: centre + 5000, consumed: false }], search);
  assert(r.result === 'miss', 'nothing in search window → miss (fails)');

  // miss: empty buffer
  r = classifyHit(expected, meanOffset, windowMs, [], search);
  assert(r.result === 'miss', 'no events at all → miss');

  // early hit reports negative offset
  r = classifyHit(expected, meanOffset, windowMs, [{ t: centre - 12, consumed: false }], search);
  approx(r.offset, -12, 1e-9, 'early hit reports negative (rushing)');

  // consumed events are skipped (prevents one kick satisfying two subdivisions):
  // the nearer event is already consumed, so it matches the next unconsumed one.
  const evs = [{ t: centre, consumed: true }, { t: centre + 10, consumed: false }];
  r = classifyHit(expected, meanOffset, windowMs, evs, search);
  assert(r.eventIndex === 1 && r.result === 'clear', 'consumed event skipped → matches the next one');
}

console.log('\n[5] High-tempo non-overlap sanity (Level 6 top = 200 BPM 16ths, ±15ms)');
{
  // 16th-note spacing at 200 BPM = 75ms; ±15ms windows (30ms wide) can't overlap.
  const spacing = 60000 / 200 / 4;
  assert(spacing > 2 * 15, `subdivision spacing ${spacing.toFixed(1)}ms > window width 30ms — no overlap`);
}

console.log('\n' + (failures === 0
  ? 'ALL TIMING-MATH CHECKS PASSED'
  : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);

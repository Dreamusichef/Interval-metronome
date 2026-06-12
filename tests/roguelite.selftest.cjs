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

  Run:  node tests/roguelite.selftest.cjs
 */

const M = require('../assets/js/roguelite.js');
const { audioToPerfMs, perfMsToAudio, computeCalibration, classifyHit, classifySlot, classifyFirstSlot } = M;

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

console.log('\n[5] Continuity-game presence slots tile the timeline (factor 0.5)');
{
  // The run gates PRESENCE: each 16th owns a slot of ±(0.5 × spacing). At factor
  // 0.5 the slots tile exactly — a kick lands in exactly one slot (no gaps, no
  // double-claim) and a dropped 16th leaves a real, detectable hole. Verify the
  // tiling identity holds at both the slowest and fastest run tempos.
  const FACTOR = 0.5;
  for (const bpm of [80, 200]) {
    const spacing = 60000 / bpm / 4;
    const slotWidth = 2 * (spacing * FACTOR);
    assert(Math.abs(slotWidth - spacing) < 1e-9,
      `${bpm} BPM 16ths: slot width ${slotWidth.toFixed(1)}ms == spacing ${spacing.toFixed(1)}ms — tiles cleanly`);
  }
}

console.log('\n[6] Slot gate — exactly one kick per slot (drop / clear / cram)');
{
  const centre = 1000, h = 40, mean = 0;   // slot = [960, 1040)
  const E = (...ts) => ts.map(t => ({ t, consumed: false }));

  let r = classifySlot(centre, mean, h, E());
  assert(r.result === 'drop' && r.count === 0, 'empty slot → drop (a skipped 16th)');

  r = classifySlot(centre, mean, h, E(1012));
  assert(r.result === 'clear' && r.count === 1, 'one kick in slot → clear');

  r = classifySlot(centre, mean, h, E(985, 1015));
  assert(r.result === 'cram' && r.count === 2, 'two kicks in one slot → cram (over-rush)');

  // Neighbours outside the slot don't count; the matched index is returned.
  r = classifySlot(centre, mean, h, E(900, 1005, 1100));
  assert(r.result === 'clear' && r.indices[0] === 1, 'only the in-slot kick counts (neighbours ignored)');

  // Half-open boundary: centre-h is IN, centre+h is OUT (goes to the next slot).
  r = classifySlot(centre, mean, h, E(960));
  assert(r.result === 'clear', 'left edge (centre−h) is inside the slot');
  r = classifySlot(centre, mean, h, E(1040));
  assert(r.result === 'drop', 'right edge (centre+h) belongs to the NEXT slot');

  // meanOffset shifts the slot centre.
  r = classifySlot(centre, 100, h, E(1100));
  assert(r.result === 'clear', 'meanOffset shifts the slot (kick at centre+offset → clear)');

  // Consumed events are ignored (already claimed by an earlier slot).
  const evs = [{ t: 1005, consumed: true }, { t: 1020, consumed: false }];
  r = classifySlot(centre, mean, h, evs);
  assert(r.result === 'clear' && r.count === 1, 'consumed kicks are skipped');
}

console.log('\n[7] First-slot leniency — generous early grace, normal late edge');
{
  const centre = 1000, h = 40, mean = 0, early = 120;   // window = [880, 1040)
  const E = (...ts) => ts.map(t => ({ t, consumed: false }));

  // A rushed start that the NORMAL slot would orphan is now caught.
  const normal = classifySlot(centre, mean, h, E(910));     // 90ms early
  assert(normal.result === 'drop', 'normal slot drops a 90ms-early start (the bug)');
  let r = classifyFirstSlot(centre, mean, h, E(910), early);
  assert(r.result === 'clear' && r.offset === -90, 'first slot CLEARS the same 90ms-early start');

  // Still requires a note — a total no-show first beat fails.
  r = classifyFirstSlot(centre, mean, h, E(), early);
  assert(r.result === 'drop', 'first slot still drops when nothing is played');

  // Late edge stays normal so it can't steal the next slot's kick.
  r = classifyFirstSlot(centre, mean, h, E(1041), early);
  assert(r.result === 'drop', 'a kick past the normal late edge is left for the next slot');

  // Too-early (beyond the grace) is not grabbed.
  r = classifyFirstSlot(centre, mean, h, E(870), early);   // 130ms early > 120 grace
  assert(r.result === 'drop', 'a kick earlier than the grace window is not counted');

  // On-time start still clears normally.
  r = classifyFirstSlot(centre, mean, h, E(1005), early);
  assert(r.result === 'clear', 'an on-time start clears');
}

console.log('\n' + (failures === 0
  ? 'ALL TIMING-MATH CHECKS PASSED'
  : failures + ' CHECK(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);

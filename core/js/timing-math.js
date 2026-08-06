'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   TIMING MATH — pure clock sync, calibration stats, hit/slot classifiers, ranks.
   No DOM, no MIDI, no engine. Unit-tested in tests/roguelite.test.cjs.
   ════════════════════════════════════════════════════════════════════════════ */

function audioToPerfMs(audioSec, sync) {
  return (audioSec - sync.a0) * 1000 + sync.p0;
}
function perfMsToAudio(perfMs, sync) {
  return (perfMs - sync.p0) / 1000 + sync.a0;
}

function computeCalibration(expectedPerfTimes, eventPerfTimes, captureWindowMs) {
  const offsets = [];
  for (const expected of expectedPerfTimes) {
    let best = null;
    let bestAbs = Infinity;
    for (const ev of eventPerfTimes) {
      const d = ev - expected;
      const a = Math.abs(d);
      if (a < bestAbs) { bestAbs = a; best = d; }
    }
    if (best !== null && bestAbs <= captureWindowMs) offsets.push(best);
  }
  const sampleCount = offsets.length;
  if (sampleCount === 0) return { meanOffset: 0, sd: 0, sampleCount: 0 };
  const mean = offsets.reduce((s, x) => s + x, 0) / sampleCount;
  const variance = offsets.reduce((s, x) => s + (x - mean) * (x - mean), 0) / sampleCount;
  return { meanOffset: mean, sd: Math.sqrt(variance), sampleCount };
}

function classifyHit(expectedPerf, meanOffset, windowMs, events, searchWindowMs) {
  const centre = expectedPerf + meanOffset;
  let bestIdx = -1;
  let bestAbs = Infinity;
  let bestSigned = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].consumed) continue;
    const d = events[i].t - centre;
    const a = Math.abs(d);
    if (a < bestAbs) { bestAbs = a; bestIdx = i; bestSigned = d; }
  }
  if (bestIdx === -1 || bestAbs > searchWindowMs) {
    return { result: 'miss', offset: null, eventIndex: -1 };
  }
  if (bestAbs <= windowMs) {
    return { result: 'clear', offset: bestSigned, eventIndex: bestIdx };
  }
  return { result: 'out', offset: bestSigned, eventIndex: bestIdx };
}

function classifySlot(expectedPerf, meanOffset, halfWindowMs, events) {
  const centre = expectedPerf + meanOffset;
  const indices = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].consumed) continue;
    const d = events[i].t - centre;
    if (d >= -halfWindowMs && d < halfWindowMs) indices.push(i);
  }
  if (indices.length === 0) return { result: 'drop', count: 0, indices, offset: null };
  if (indices.length === 1) {
    return { result: 'clear', count: 1, indices, offset: events[indices[0]].t - centre };
  }
  return { result: 'cram', count: indices.length, indices, offset: null };
}

function classifyFirstSlot(expectedPerf, meanOffset, halfWindowMs, events, earlyReachMs) {
  const centre = expectedPerf + meanOffset;
  let bestIdx = -1, bestAbs = Infinity, bestSigned = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].consumed) continue;
    const d = events[i].t - centre;
    if (d >= -earlyReachMs && d < halfWindowMs) {
      const a = Math.abs(d);
      if (a < bestAbs) { bestAbs = a; bestIdx = i; bestSigned = d; }
    }
  }
  if (bestIdx === -1) return { result: 'drop', count: 0, indices: [], offset: null };
  return { result: 'clear', count: 1, indices: [bestIdx], offset: bestSigned };
}

function rankFor(pct) {
  if (pct >= 99) return 'SS';
  if (pct >= 91) return 'S';
  if (pct >= 81) return 'A';
  if (pct >= 66) return 'B';
  if (pct >= 50) return 'C';
  if (pct >= 26) return 'D';
  return 'E';
}

function endurancePct(hitsCleared, totalRunBeats, ticksPerBeat = 4) {
  const totalSlots = (totalRunBeats || 0) * ticksPerBeat;
  if (!totalSlots) return 0;
  return Math.round(Math.min(100, hitsCleared / totalSlots * 100));
}

function accuracyPct(tally) {
  const total = (tally.good || 0) + (tally.neutral || 0) + (tally.bad || 0);
  return total ? Math.round(tally.good / total * 100) : 0;
}

const ENDURANCE_DURATION_WEIGHT = 0.70;
const ENDURANCE_ACCURACY_WEIGHT = 0.30;

function enduranceScorePct(hitsCleared, totalRunBeats, tally, ticksPerBeat = 4) {
  const duration = endurancePct(hitsCleared, totalRunBeats, ticksPerBeat);
  const accuracy = accuracyPct(tally);
  return Math.round(Math.min(100,
    ENDURANCE_DURATION_WEIGHT * duration + ENDURANCE_ACCURACY_WEIGHT * accuracy));
}

function runResultPct({ mode, status, hitsCleared, totalRunBeats, tally, ticksPerBeat = 4 }) {
  if (mode === 'suddendeath' || mode === 'gauntlet') {
    const pct = enduranceScorePct(hitsCleared, totalRunBeats, tally, ticksPerBeat);
    return { rank: rankFor(pct), pct };
  }
  const pct = accuracyPct(tally);
  return { rank: rankFor(pct), pct };
}

function liveGaugePct({ mode, hitsCleared, totalRunBeats, tally, ticksPerBeat = 4 }) {
  if (mode === 'suddendeath' || mode === 'gauntlet') {
    return enduranceScorePct(hitsCleared, totalRunBeats, tally, ticksPerBeat);
  }
  const good = (tally && tally.good) || 0;
  return Math.max(0, Math.min(100, Math.round(good / (totalRunBeats || 1) * 100)));
}

const TimingMath = {
  audioToPerfMs, perfMsToAudio, computeCalibration, classifyHit, classifySlot, classifyFirstSlot,
  rankFor, endurancePct, accuracyPct, enduranceScorePct, runResultPct, liveGaugePct,
};

// Alias kept for game app / tests that still use RL_TimingMath name.
const RL_TimingMath = TimingMath;

if (typeof window !== 'undefined') {
  window.TimingMath = TimingMath;
  window.RL_TimingMath = RL_TimingMath;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TimingMath;
}

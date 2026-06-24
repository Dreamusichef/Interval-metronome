'use strict';

/*
  Funnel Watch analysis — PURE. Dojo (public JSON). Built so new sources drop in with
  no rework (Art of Double Bass 3.0, Game Metronome are future entries, not wired here).
  "Speak only on meaningful movement": every weekly run writes one funnel_pulse row per
  source, but a brief signal fires only on real movement.

  dojoPulse returns { row, signal } where:
    row    — funnel_pulse shape minus captured_at (module stamps it):
             { source, metrics, delta_note, needs_attention }
    signal — a brief signal, or null when movement is not meaningful.
*/

function n(v) {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

function crossedMilestone(prev, cur, milestones) {
  if (prev == null || cur == null) return null;
  for (const m of milestones) {
    if (cur >= m && prev < m) return m;
  }
  return null;
}

/**
 * Dojo pulse from dojo-data.public.json (PII-free, published nightly).
 * @param {object} current   { ninjas, activeNinjas, totalClips }
 * @param {object|null} previous  prior metrics (from watermark)
 * @param {object} [opts]
 * @param {number} [opts.ninjaGrowthThreshold=5]
 */
function dojoPulse(current, previous, opts = {}) {
  const { ninjaGrowthThreshold = 5 } = opts;
  const cur = current || {};
  const prev = previous || null;

  const ninjas = n(cur.ninjas);
  const active = n(cur.activeNinjas);
  const clips = n(cur.totalClips);

  const metrics = { ninjas, activeNinjas: active, totalClips: clips };
  if (clips != null) {
    metrics.nextClipMilestone = Math.floor(clips / 1000 + 1) * 1000;
    metrics.clipsToNextMilestone = metrics.nextClipMilestone - clips;
  }

  let needsAttention = false;
  const notes = [];

  if (prev) {
    const ninjaDelta = ninjas != null && n(prev.ninjas) != null ? ninjas - prev.ninjas : null;
    if (ninjaDelta != null) {
      notes.push(`${ninjaDelta >= 0 ? '+' : ''}${ninjaDelta} ninjas`);
      if (Math.abs(ninjaDelta) >= ninjaGrowthThreshold) needsAttention = true;
    }
    const clipMs = crossedMilestone(n(prev.totalClips), clips, milestoneSeq(clips));
    if (clipMs != null) {
      notes.push(`crossed ${clipMs} clips`);
      needsAttention = true;
    }
  } else {
    notes.push('baseline (first reading)');
  }

  const delta_note = notes.join('; ') || 'no change';
  const row = { source: 'dojo', metrics, delta_note, needs_attention: needsAttention };
  const signal = needsAttention
    ? { source: 'funnel', severity: 'notice', needsAttention: true, title: `Dojo: ${delta_note}`, detail: delta_note }
    : null;
  return { row, signal };
}

// 1000-clip milestones up to just past the current count.
function milestoneSeq(clips) {
  const top = clips != null ? Math.floor(clips / 1000 + 1) * 1000 : 1000;
  const out = [];
  for (let m = 1000; m <= top; m += 1000) out.push(m);
  return out;
}

module.exports = { dojoPulse, crossedMilestone, milestoneSeq };

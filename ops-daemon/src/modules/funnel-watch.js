'use strict';

/*
  Funnel Watch — "Gates & Tides" → funnel_pulse (Dojo only, for now).

  Weekly (self-gated via a watermark, so it participates in the day's Brief when it
  runs). Built to accept a LIST of sources so new funnels drop in with no rework —
  Art of Double Bass 3.0 and the Game Metronome are future entries behind this same
  toggle, NOT wired in this build. (First Stroke was removed — no longer in development.)
  No Haiku.

  Source:
   - Dojo: fetch DOJO_PUBLIC_JSON_URL (published nightly, PII-free, zero setup).
*/

const config = require('../config');
const logger = require('../lib/logger');
const cockpit = require('../lib/cockpit');
const { fetchJson } = require('../lib/http');
const { getWatermark, setWatermark, getWatermarkUpdatedAt } = require('../lib/watermark');
const { dojoPulse } = require('../domain/funnel-analysis');

const WM_LASTRUN = 'funnel:lastrun';
const WEEKLY_MS = 7 * 86400000;

/** Weekly gate: due if never run or the last run was >= ~7 days ago (1h slack). */
function isDue(now = Date.now()) {
  const last = getWatermarkUpdatedAt(WM_LASTRUN);
  if (!last) return true;
  const lastMs = Date.parse(last);
  if (isNaN(lastMs)) return true;
  return now - lastMs >= WEEKLY_MS - 3600000;
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null) return Number(obj[k]);
  }
  return null;
}

async function fetchDojo() {
  const data = await fetchJson(
    config.dojo.publicJsonUrl,
    { method: 'GET' },
    { label: 'funnel:dojo' }
  );
  return {
    ninjas: pick(data, ['ninjas', 'ninjaCount', 'totalNinjas']),
    activeNinjas: pick(data, ['activeNinjas', 'active', 'activeCount']),
    totalClips: pick(data, ['totalClips', 'clips', 'clipCount']),
  };
}

const SOURCES = [
  { key: 'dojo', wm: 'funnel:dojo', fetch: fetchDojo, pulse: dojoPulse },
  // Future drop-ins behind this same toggle — add a { key, wm, fetch, pulse } entry,
  // no other rework needed:
  //   { key: 'adb3', ... }        — Art of Double Bass 3.0
  //   { key: 'metronome', ... }   — Game Metronome (deferred pending Azurek)
];

async function run() {
  const rows = [];
  const signals = [];
  const capturedAt = new Date().toISOString();

  for (const src of SOURCES) {
    try {
      const cur = await src.fetch();
      if (cur == null) continue; // source unavailable — skip without a meaningless row
      const prevRaw = getWatermark(src.wm);
      let prev = null;
      if (prevRaw) {
        try {
          prev = JSON.parse(prevRaw);
        } catch {
          prev = null;
        }
      }
      const { row, signal } = src.pulse(cur, prev);
      rows.push({ ...row, captured_at: capturedAt });
      if (signal) signals.push(signal);
      setWatermark(src.wm, JSON.stringify(cur));
    } catch (err) {
      // Per-source isolation inside the module — one bad source can't sink the rest.
      logger.warn('funnel source failed', { source: src.key, error: String(err && err.message || err) });
    }
  }

  if (rows.length > 0) {
    await cockpit.ingest('funnel_pulse', rows);
  }
  setWatermark(WM_LASTRUN, capturedAt);

  return { signals, detail: { sources: rows.length } };
}

module.exports = { run, isDue, SOURCES };

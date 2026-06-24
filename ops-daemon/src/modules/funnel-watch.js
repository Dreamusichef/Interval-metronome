'use strict';

/*
  Funnel Watch — "Gates & Tides" → funnel_pulse (Dojo + First Stroke only).

  Weekly (self-gated via a watermark, so it participates in the day's Brief when it
  runs). Built to accept a LIST of sources; Metronome is a future drop-in entry behind
  the existing toggle — NOT wired in this build. No Haiku.

  Sources:
   - Dojo: fetch DOJO_PUBLIC_JSON_URL (published nightly, PII-free, zero setup).
   - First Stroke: read the preorder counter. The read method is owner-confirmed —
     set FIRSTSTROKE_PREORDER_PATH (a path under FIRSTSTROKE_SUPABASE_URL returning
     JSON) and FIRSTSTROKE_PREORDER_KEY (dotted key to the number). If unset/unreadable,
     the source is skipped (logged) rather than guessed.
*/

const config = require('../config');
const logger = require('../lib/logger');
const cockpit = require('../lib/cockpit');
const { fetchJson } = require('../lib/http');
const { getWatermark, setWatermark, getWatermarkUpdatedAt } = require('../lib/watermark');
const { dojoPulse, firstStrokePulse } = require('../domain/funnel-analysis');

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

function dottedGet(obj, path) {
  return String(path)
    .split('.')
    .reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

async function fetchFirstStroke() {
  const { supabaseUrl, anonKey } = config.firstStroke;
  const path = process.env.FIRSTSTROKE_PREORDER_PATH;
  const key = process.env.FIRSTSTROKE_PREORDER_KEY || 'preorders';
  if (!supabaseUrl || !anonKey || !path) {
    logger.warn('funnel: First Stroke read not configured — skipping source (confirm method with owner)');
    return null;
  }
  const url = supabaseUrl.replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path);
  const data = await fetchJson(
    url,
    { method: 'GET', headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` } },
    { label: 'funnel:firststroke' }
  );
  const raw = dottedGet(data, key);
  const preorders = typeof raw === 'number' ? raw : Number(raw);
  if (!isFinite(preorders)) {
    logger.warn('funnel: First Stroke value not numeric — skipping', { key });
    return null;
  }
  return { preorders };
}

const SOURCES = [
  { key: 'dojo', wm: 'funnel:dojo', fetch: fetchDojo, pulse: dojoPulse },
  { key: 'firststroke', wm: 'funnel:firststroke', fetch: fetchFirstStroke, pulse: firstStrokePulse },
  // Future: { key: 'metronome', ... } — drop-in behind the existing toggle, no rework.
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

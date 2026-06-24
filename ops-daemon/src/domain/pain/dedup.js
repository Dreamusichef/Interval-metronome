'use strict';

/*
  Canonical pain-point accumulation — PURE. The daemon keeps its own canonical
  mirror locally (it cannot read pain_points back from /daemon-read), so these
  functions own the merge math: increment frequency, append verbatim quotes (cap
  ~10 distinct), refresh last_seen, track source hashes for idempotency, and keep a
  running intensity average.

  Idempotency: a message's source_hash is the dedupe key. If a hash is already on a
  canonical row, re-processing it is a no-op — reruns never double-count.

  The local mirror row carries two internal-only fields (`key`, `intensity_sum`)
  used for bucketing and average math; `toCockpitRow()` strips them to the
  pain_points payload shape.
*/

const QUOTE_CAP = 10;

function slug(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Stable canonical key from category + label (used to address local mirror rows). */
function canonicalKey(category, label) {
  return `${slug(category)}::${slug(label)}`;
}

/**
 * Create a fresh canonical row from the first observation.
 * @param {object} p { category, label, key, quote, intensity, sourceHash, now }
 */
function newCanonicalRow(p) {
  const intensity = clampIntensity(p.intensity);
  return {
    key: p.key,
    label: p.label,
    category: p.category,
    frequency: 1,
    intensity_sum: intensity,
    intensity_avg: intensity,
    first_seen: p.now,
    last_seen: p.now,
    example_quotes: p.quote ? [p.quote] : [],
    source_hashes: p.sourceHash ? [p.sourceHash] : [],
    status: 'open',
  };
}

/**
 * Merge a message observation into an existing canonical row (mutates and returns it).
 *
 * frequency counts MESSAGES (every merged observation increments it). `sourceHash`
 * is the salted AUTHOR hash — added to source_hashes as a SET (distinct contributors,
 * PII-free provenance), never as a per-message counter. Idempotency against reruns is
 * the caller's responsibility (intake rows are processed-once, committed atomically),
 * so this always increments.
 * @returns {{ row: object }}
 */
function mergeObservation(row, p) {
  row.frequency += 1;
  const intensity = clampIntensity(p.intensity);
  row.intensity_sum += intensity;
  row.intensity_avg = round2(row.intensity_sum / row.frequency);
  row.last_seen = p.now;

  // Distinct author hashes only — provenance, not a message count.
  if (p.sourceHash && !row.source_hashes.includes(p.sourceHash)) {
    row.source_hashes.push(p.sourceHash);
  }

  if (p.quote && row.example_quotes.length < QUOTE_CAP && !row.example_quotes.includes(p.quote)) {
    row.example_quotes.push(p.quote);
  }
  return { row };
}

/** Strip internal-only fields → the pain_points ingest payload shape. */
function toCockpitRow(row) {
  return {
    label: row.label,
    category: row.category,
    intensity_avg: row.intensity_avg,
    frequency: row.frequency,
    first_seen: row.first_seen,
    last_seen: row.last_seen,
    example_quotes: row.example_quotes,
    source_hashes: row.source_hashes,
    status: row.status,
  };
}

function clampIntensity(v) {
  const i = parseInt(v, 10);
  if (i >= 1 && i <= 3) return i;
  return 1;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = {
  QUOTE_CAP,
  slug,
  canonicalKey,
  newCanonicalRow,
  mergeObservation,
  toCockpitRow,
};

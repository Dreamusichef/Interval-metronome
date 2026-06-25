'use strict';

/*
  Pain-Point Miner — "Forge Echoes" → pain_points.

  Daily, via the Haiku Batch API. Reads ops.db.discord_intake where processed=0
  (NEVER Discord directly — Pulse owns Discord; the daemon reads the handoff). For
  each message Haiku decides: is it a struggle? If yes → category + canonical label +
  intensity 1-3. A second cheap Haiku "match-or-new" pass dedupes against existing
  canonical labels (no vector store at this scale).

  Privacy: a Discord handle never reaches the cockpit — only its salted hash goes into
  source_hashes (distinct contributors). The verbatim quote is the student's RAW message
  text (never the model's paraphrase) — phrasing is the asset and is stored exactly.

  Idempotency: the daemon keeps its own canonical mirror locally (it can't read
  pain_points back from /daemon-read). Each run recomputes from (persisted mirror +
  unprocessed intake); the cockpit upsert happens BEFORE the local commit, and the
  mirror-update + intake-mark-processed commit atomically in one transaction. A crash
  before commit replays deterministically — reruns never double-count.
*/

const config = require('../config');
const logger = require('../lib/logger');
const cockpit = require('../lib/cockpit');
const { getDb } = require('../lib/db');
const { getWatermark, setWatermark } = require('../lib/watermark');
const { hashHandle } = require('../lib/hash');
// Namespace import (not destructured) so the Haiku calls are injectable in tests:
// integration tests override haiku.runBatch with a canned classifier.
const haiku = require('../lib/haiku');
const {
  CLASSIFY_SYSTEM_PREFIX,
  DEDUP_SYSTEM_PREFIX,
  buildClassifyUserContent,
  buildDedupUserContent,
  parseClassifyResult,
  parseDedupResult,
} = require('../domain/pain/taxonomy');
const {
  canonicalKey,
  newCanonicalRow,
  mergeObservation,
  toCockpitRow,
} = require('../domain/pain/dedup');

const MIRROR_WM = 'painpoints:canonical';
const MAX_BATCH = 1000; // cap messages classified per run
const INTAKE_KEEP_PROCESSED_DAYS = 14;
const INTAKE_KEEP_UNPROCESSED_DAYS = 60;

function loadMirror() {
  const raw = getWatermark(MIRROR_WM);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && parsed.rows ? parsed.rows : {};
  } catch {
    logger.warn('painpoints: canonical mirror unparseable — starting fresh');
    return {};
  }
}

async function run() {
  const db = getDb();

  const intake = db
    .prepare('SELECT id, author, content FROM discord_intake WHERE processed = 0 ORDER BY id ASC LIMIT ?')
    .all(MAX_BATCH);

  if (intake.length === 0) {
    pruneIntake(db);
    return { signals: [], detail: { considered: 0, struggles: 0 } };
  }

  const mirror = loadMirror();
  const model = config.anthropic.model;

  // --- Pass 1: classify (batch) ---
  const classifyReqs = intake.map((r) => ({
    custom_id: `c:${r.id}`,
    params: {
      model,
      max_tokens: 200,
      system: haiku.cachedSystem(CLASSIFY_SYSTEM_PREFIX),
      messages: [{ role: 'user', content: buildClassifyUserContent(r.content) }],
    },
  }));
  const classifyResults = await haiku.runBatch(classifyReqs);

  const consideredIds = [];
  const struggles = [];
  for (const r of intake) {
    const res = classifyResults.get(`c:${r.id}`);
    if (!res) continue; // no result for this id → leave processed=0 for a retry next run
    consideredIds.push(r.id);
    if (!res.ok) continue;
    const parsed = parseClassifyResult(res.text);
    if (parsed.isStruggle) {
      struggles.push({ intakeId: r.id, author: r.author, content: r.content, ...parsed });
    }
  }

  // --- Pass 2: match-or-new dedup (batch), only where needed ---
  for (const s of struggles) s.key = canonicalKey(s.category, s.label);

  const byCategoryLabels = {};
  for (const row of Object.values(mirror)) {
    (byCategoryLabels[row.category] || (byCategoryLabels[row.category] = [])).push(row.label);
  }

  const dedupReqs = [];
  const dedupExisting = new Map();
  for (const s of struggles) {
    if (mirror[s.key]) continue; // already an exact bucket — no fuzzy match needed
    const existing = byCategoryLabels[s.category] || [];
    if (existing.length === 0) continue; // nothing to match against → NEW
    dedupExisting.set(s.intakeId, existing);
    dedupReqs.push({
      custom_id: `d:${s.intakeId}`,
      params: {
        model,
        max_tokens: 60,
        system: haiku.cachedSystem(DEDUP_SYSTEM_PREFIX),
        messages: [{ role: 'user', content: buildDedupUserContent(s.label, existing) }],
      },
    });
  }
  const dedupResults = dedupReqs.length ? await haiku.runBatch(dedupReqs) : new Map();

  for (const s of struggles) {
    if (mirror[s.key]) continue;
    const dr = dedupResults.get(`d:${s.intakeId}`);
    if (dr && dr.ok) {
      const matched = parseDedupResult(dr.text, dedupExisting.get(s.intakeId) || []);
      if (matched) {
        const matchRow = Object.values(mirror).find((r) => r.category === s.category && r.label === matched);
        if (matchRow) s.key = matchRow.key;
      }
    }
  }

  // --- Merge into the local canonical mirror ---
  const now = new Date().toISOString();
  const touched = new Set();
  const addedThisRun = {};
  for (const s of struggles) {
    const authorHash = hashHandle(s.author, config.hashSalt);
    const quote = String(s.content == null ? '' : s.content).trim();
    if (!mirror[s.key]) {
      mirror[s.key] = newCanonicalRow({
        category: s.category,
        label: s.label,
        key: s.key,
        quote,
        intensity: s.intensity,
        sourceHash: authorHash,
        now,
      });
    } else {
      mergeObservation(mirror[s.key], { quote, intensity: s.intensity, sourceHash: authorHash, now });
    }
    touched.add(s.key);
    addedThisRun[s.key] = (addedThisRun[s.key] || 0) + 1;
  }

  // --- Upsert changed canonical rows to the cockpit (BEFORE local commit) ---
  const changedRows = [...touched].map((k) => toCockpitRow(mirror[k]));
  if (changedRows.length > 0) {
    await cockpit.ingest('pain_points', changedRows);
  }

  // --- Atomically persist mirror + mark intake processed ---
  const markStmt = db.prepare('UPDATE discord_intake SET processed = 1 WHERE id = ?');
  const commit = db.transaction(() => {
    setWatermark(MIRROR_WM, JSON.stringify({ rows: mirror }));
    for (const id of consideredIds) markStmt.run(id);
  });
  commit();

  pruneIntake(db);

  const signals = buildSignals(mirror, addedThisRun);
  return {
    signals,
    detail: { considered: consideredIds.length, struggles: struggles.length, buckets: touched.size },
  };
}

// Sharpest rising pains: buckets that grew this run, ranked by new observations.
function buildSignals(mirror, addedThisRun) {
  const entries = Object.keys(addedThisRun)
    .map((k) => ({ row: mirror[k], added: addedThisRun[k] }))
    .filter((e) => e.row)
    .sort((a, b) => b.added - a.added || b.row.intensity_avg - a.row.intensity_avg)
    .slice(0, 3);

  return entries.map(({ row, added }) => {
    const hot = row.intensity_avg >= 2 && (added >= 2 || row.frequency >= 3);
    return {
      source: 'pain',
      severity: row.intensity_avg >= 2.5 ? 'warn' : 'notice',
      needsAttention: hot,
      score: added,
      title: `Rising pain: ${row.label} (+${added} today, ${row.frequency}× total, intensity ${row.intensity_avg})`,
      detail: row.example_quotes.slice(0, 2).map((q) => `“${q}”`).join('  ·  '),
    };
  });
}

function pruneIntake(db) {
  const procCutoff = new Date(Date.now() - INTAKE_KEEP_PROCESSED_DAYS * 86400000).toISOString();
  const unprocCutoff = new Date(Date.now() - INTAKE_KEEP_UNPROCESSED_DAYS * 86400000).toISOString();
  try {
    db.prepare("DELETE FROM discord_intake WHERE processed = 1 AND COALESCE(ts, '') < ?").run(procCutoff);
    db.prepare("DELETE FROM discord_intake WHERE processed = 0 AND COALESCE(ts, '') <> '' AND ts < ?").run(unprocCutoff);
  } catch (err) {
    logger.warn('painpoints: prune failed', { error: String(err && err.message || err) });
  }
}

module.exports = { run };

'use strict';

/*
  Cockpit client — the daemon's entire interface to Arcane Sanctum (Lovable Cloud).

  POST /daemon-ingest  — upsert refined signal into one of six whitelisted tables.
  GET  /daemon-read    — pull the reconciled money snapshot + apprentices-due +
                         stale quests (the two things the daemon must NOT duplicate).

  Both authenticate with the x-daemon-key header (shared DAEMON_API_KEY). The daemon
  never touches the owner's Supabase dashboard.
*/

const config = require('../config');
const logger = require('./logger');
const { fetchWithRetry } = require('./http');

// Whitelist enforced client-side too (defence in depth — the endpoint also checks).
const INGEST_TABLES = new Set([
  'pain_points',
  'email_health',
  'money_alerts',
  'funnel_pulse',
  'review_alerts',
  'daily_brief',
]);

/**
 * Upsert rows into a cockpit table.
 * @param {string} table  one of the six whitelisted names
 * @param {object[]} rows
 * @returns {Promise<{ok: boolean, count: number}>}
 */
async function ingest(table, rows) {
  if (!INGEST_TABLES.has(table)) {
    throw new Error(`cockpit.ingest: refusing unknown table "${table}"`);
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: true, count: 0 };
  }
  if (!config.arcane.ingestUrl || !config.arcane.apiKey) {
    throw new Error('cockpit.ingest: ARCANE_INGEST_URL / DAEMON_API_KEY not configured');
  }

  const body = JSON.stringify({ table, op: 'upsert', rows });
  const res = await fetchWithRetry(
    config.arcane.ingestUrl,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-daemon-key': config.arcane.apiKey,
      },
      body,
    },
    { label: `cockpit:ingest:${table}` }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`cockpit.ingest ${table}: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  logger.debug('cockpit ingest ok', { table, count: rows.length });
  return { ok: true, count: rows.length };
}

/**
 * Read the cockpit bundle the daemon depends on but must not recompute.
 * @returns {Promise<{snapshot: object, apprenticesDue: object[], staleQuests: object[]}>}
 */
async function read() {
  if (!config.arcane.readUrl || !config.arcane.apiKey) {
    throw new Error('cockpit.read: ARCANE_READ_URL / DAEMON_API_KEY not configured');
  }
  const res = await fetchWithRetry(
    config.arcane.readUrl,
    {
      method: 'GET',
      headers: { 'x-daemon-key': config.arcane.apiKey },
    },
    { label: 'cockpit:read' }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`cockpit.read: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return {
    snapshot: data.snapshot || {},
    apprenticesDue: Array.isArray(data.apprenticesDue) ? data.apprenticesDue : [],
    staleQuests: Array.isArray(data.staleQuests) ? data.staleQuests : [],
  };
}

module.exports = { ingest, read, INGEST_TABLES };

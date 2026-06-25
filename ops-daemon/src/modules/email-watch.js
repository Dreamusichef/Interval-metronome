'use strict';

/*
  Email Watch — "The Sendings" → email_health.

  Daily. Reads the Kit API (read-only) and writes ONE email_health row per run
  summarizing list state and flags. Proposes a non-responder cull (needs_attention)
  but NEVER deletes subscribers — the owner approves out-of-band.

  No Haiku (rules + counts; the analysis lives in domain/email-analysis.js).

  Kit account specifics vary; the field mapping below is best-effort and degrades
  gracefully (a sub-fetch that fails leaves that signal empty, the row still writes).
  Confirm/tune the mapping and thresholds with the owner (build step 7). Set the
  optional KIT_COLD_TAG env to the name of your "cold/non-responder" tag to enable
  the cull proposal.
*/

const config = require('../config');
const logger = require('../lib/logger');
const cockpit = require('../lib/cockpit');
const { fetchJson } = require('../lib/http');
const { analyzeEmail } = require('../domain/email-analysis');

const KIT_BASE = 'https://api.kit.com/v4';

function kitHeaders() {
  return { 'X-Kit-Api-Key': config.kit.apiKey, accept: 'application/json' };
}

async function kitGet(pathAndQuery) {
  return fetchJson(
    `${KIT_BASE}${pathAndQuery}`,
    { method: 'GET', headers: kitHeaders() },
    { label: `kit:${pathAndQuery}` }
  );
}

// Each sub-fetch is wrapped so one failing endpoint can't fail the whole module.
async function safe(label, fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    logger.warn('email-watch sub-fetch failed', { label, error: String(err && err.message || err) });
    return fallback;
  }
}

/** Build the aggregated input shape that analyzeEmail consumes. */
async function fetchKitAggregate() {
  if (!config.kit.apiKey) throw new Error('email-watch: KIT_API_KEY not set');

  // Active subscriber count (Kit returns pagination.total_count for the query).
  const subs = await safe(
    'subscribers',
    () => kitGet('/subscribers?status=active&per_page=1'),
    null
  );
  const totalSubscribers =
    (subs && subs.pagination && Number(subs.pagination.total_count)) || 0;

  // Sequences (a stalled-count field is account-specific; default to 0 when absent).
  const seqResp = await safe('sequences', () => kitGet('/sequences'), { sequences: [] });
  const sequences = (seqResp.sequences || []).map((s) => ({
    id: s.id,
    name: s.name,
    stalledCount: Number(s.stalled_count || s.stalledCount || 0),
  }));

  // Recent broadcasts with open/click stats.
  const bcResp = await safe('broadcasts', () => kitGet('/broadcasts?per_page=20'), { broadcasts: [] });
  const broadcasts = [];
  for (const b of bcResp.broadcasts || []) {
    const stats = await safe(`broadcast-stats:${b.id}`, () => kitGet(`/broadcasts/${b.id}/stats`), null);
    const st = stats && stats.broadcast && stats.broadcast.stats;
    broadcasts.push({
      id: b.id,
      subject: b.subject,
      sentAt: b.published_at || b.send_at || null,
      recipients: st ? Number(st.recipients || 0) : null,
      openRate: st && st.open_rate != null ? Number(st.open_rate) : null,
      clickRate: st && st.click_rate != null ? Number(st.click_rate) : null,
    });
  }

  // Non-responder cull candidates: only when a cold tag is configured.
  let nonResponders = [];
  const coldTag = process.env.KIT_COLD_TAG;
  if (coldTag) {
    const tagsResp = await safe('tags', () => kitGet('/tags'), { tags: [] });
    const tag = (tagsResp.tags || []).find((t) => t.name === coldTag);
    if (tag) {
      const cold = await safe(
        'cold-subscribers',
        () => kitGet(`/tags/${tag.id}/subscribers?per_page=200`),
        { subscribers: [] }
      );
      nonResponders = (cold.subscribers || []).map((s) => ({
        id: s.id,
        email: s.email_address || s.email,
        lastEngagedAt: s.last_engaged_at || s.created_at || null,
      }));
    } else {
      logger.warn('email-watch: KIT_COLD_TAG set but no matching tag found', { coldTag });
    }
  }

  return { totalSubscribers, sequences, broadcasts, nonResponders, expectedTagFirings: [] };
}

async function run(ctx = {}) {
  // ctx.aggregate lets tests inject the Kit aggregate (no network); production fetches it.
  const aggregate = ctx.aggregate || (await fetchKitAggregate());
  const analysis = analyzeEmail(aggregate);

  const row = {
    captured_at: new Date().toISOString(),
    summary: analysis.summary,
    flags: analysis.flags,
    proposed_cull: analysis.proposed_cull,
    needs_attention: analysis.needs_attention,
  };

  await cockpit.ingest('email_health', [row]);

  return {
    signals: analysis._signal ? [analysis._signal] : [],
    detail: {
      subscribers: aggregate.totalSubscribers,
      flags: analysis.flags.length,
      cull: analysis.proposed_cull ? analysis.proposed_cull.count : 0,
    },
  };
}

module.exports = { run, fetchKitAggregate };

'use strict';

/*
  The Morning Brief — "The Dawn Auspex" → daily_brief. Keystone; runs last.

  After all enabled modules complete, composes the three-to-five things that genuinely
  need Wei today from this cycle's signals + apprentices due. Exception-based: a quiet
  day yields a short brief. Writes ONE daily_brief row, POSTs a compact version to the
  Discord webhook (the push layer the PWA otherwise lacks), and sets posted_webhook.

  The daemon has no Discord credentials — delivery is a passive HTTPS POST to a webhook,
  not a second bot. Idempotency: a local watermark records the last posted brief_date so
  the brief never double-posts even if the cycle runs twice in a day.
*/

const config = require('../config');
const logger = require('../lib/logger');
const cockpit = require('../lib/cockpit');
const { fetchWithRetry } = require('../lib/http');
const { getWatermark, setWatermark } = require('../lib/watermark');
const { composeBrief } = require('../domain/brief-compose');

const WM_POSTED = 'brief:posted';
const MAX_APPRENTICES = 3;

/** Local date (YYYY-MM-DD) in the daemon's timezone. */
function localDate(tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Derive apprentice-due signals from the cockpit read bundle. */
function apprenticeSignals(bundle) {
  const due = Array.isArray(bundle && bundle.apprenticesDue) ? bundle.apprenticesDue : [];
  return due.slice(0, MAX_APPRENTICES).map((a) => ({
    source: 'apprentice',
    severity: 'notice',
    needsAttention: true,
    title: `Apprentice due: ${a.name}`,
    detail: `last lesson ${a.lastLesson || 'unknown'}${a.status ? ` — ${a.status}` : ''}`,
  }));
}

function toDiscordContent(brief) {
  const lines = [`**The Dawn Auspex — ${brief.brief_date}**`, brief.summary];
  if (brief.items.length > 0) lines.push('');
  for (const it of brief.items) {
    lines.push(`• ${it.title}`);
    if (it.detail) lines.push(`  ${String(it.detail).slice(0, 280)}`);
  }
  return lines.join('\n').slice(0, 1900); // Discord content cap is 2000
}

async function postToDiscord(brief) {
  if (!config.discord.briefWebhookUrl) {
    logger.warn('brief: DISCORD_BRIEF_WEBHOOK_URL not set — not posting');
    return false;
  }
  const res = await fetchWithRetry(
    config.discord.briefWebhookUrl,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: toDiscordContent(brief) }),
    },
    { label: 'discord:brief' }
  );
  if (!res.ok) {
    logger.error('brief: webhook post failed', { status: res.status });
    return false;
  }
  return true;
}

/**
 * @param {object} ctx
 * @param {object[]} ctx.signals  all signals collected from this cycle's modules
 * @param {object} ctx.bundle     the cockpit read bundle (for apprentices due)
 */
async function run(ctx = {}) {
  const signals = Array.isArray(ctx.signals) ? ctx.signals.slice() : [];
  signals.push(...apprenticeSignals(ctx.bundle || {}));

  const briefDate = localDate(config.tz);
  const brief = composeBrief(signals, { date: briefDate });

  const alreadyPostedToday = getWatermark(WM_POSTED) === briefDate;

  let posted = false;
  if (!alreadyPostedToday) {
    posted = await postToDiscord(brief);
    // Guard re-posting even if the cockpit ingest below fails.
    if (posted) setWatermark(WM_POSTED, briefDate);
  }

  const row = {
    brief_date: briefDate,
    items: brief.items,
    summary: brief.summary,
    posted_webhook: posted || alreadyPostedToday,
  };
  await cockpit.ingest('daily_brief', [row]);

  return {
    signals: [],
    detail: { items: brief.items.length, posted: row.posted_webhook, alreadyPostedToday },
  };
}

module.exports = { run, toDiscordContent, localDate };

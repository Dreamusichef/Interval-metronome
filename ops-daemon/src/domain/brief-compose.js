'use strict';

/*
  The Morning Brief composer — PURE and rendering-agnostic, so it's unit-testable
  and ports cleanly. Modules emit normalized "signals"; this picks the three-to-five
  things that genuinely need Wei today. Exception-based: a quiet day yields a short
  brief (we never pad to a minimum).

  Signal shape:
    {
      source: 'email'|'money'|'funnel'|'review'|'pain'|'quest'|'apprentice',
      severity: 'info'|'notice'|'warn'|'critical',
      needsAttention: boolean,
      title: string,
      detail: string,
      score?: number   // optional within-source tiebreaker (higher = more urgent)
    }
*/

const SEVERITY_RANK = { info: 0, notice: 1, warn: 2, critical: 3 };

function rankOf(severity) {
  return SEVERITY_RANK[severity] != null ? SEVERITY_RANK[severity] : 0;
}

/** A signal crosses the attention threshold if flagged, or severity >= notice. */
function crossesThreshold(sig) {
  return Boolean(sig && (sig.needsAttention || rankOf(sig.severity) >= 1));
}

function priorityScore(sig) {
  return rankOf(sig.severity) * 100 + (sig.needsAttention ? 50 : 0) + (Number(sig.score) || 0);
}

/**
 * Compose the brief from this cycle's signals.
 * @param {object[]} signals
 * @param {object} [opts]
 * @param {string} [opts.date]   brief_date (YYYY-MM-DD); caller supplies for determinism
 * @param {number} [opts.max=5]
 * @returns {{ brief_date: string, items: object[], summary: string }}
 */
function composeBrief(signals, opts = {}) {
  const max = opts.max || 5;
  const briefDate = opts.date || new Date().toISOString().slice(0, 10);

  const candidates = (Array.isArray(signals) ? signals : []).filter(crossesThreshold);

  // Stable sort: highest priority first; ties keep input order (Array.sort is stable).
  const ranked = candidates
    .map((sig, i) => ({ sig, i }))
    .sort((a, b) => priorityScore(b.sig) - priorityScore(a.sig) || a.i - b.i)
    .slice(0, max)
    .map(({ sig }) => ({
      source: sig.source,
      severity: sig.severity || 'notice',
      title: sig.title,
      detail: sig.detail || '',
    }));

  const summary = buildSummary(ranked, candidates.length);
  return { brief_date: briefDate, items: ranked, summary };
}

function buildSummary(items, totalCandidates) {
  if (items.length === 0) {
    return 'Quiet day — nothing crossed the line. Go teach.';
  }
  const lead = items.length === 1 ? '1 thing needs you today' : `${items.length} things need you today`;
  const more =
    totalCandidates > items.length
      ? ` (+${totalCandidates - items.length} more below the fold)`
      : '';
  const headline = items.map((it) => it.title).join('; ');
  return `${lead}${more}: ${headline}`;
}

module.exports = { composeBrief, crossesThreshold, priorityScore, SEVERITY_RANK };

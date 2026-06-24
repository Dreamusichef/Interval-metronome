'use strict';

/*
  Email Watch analysis — PURE (rules + counts, no Haiku). Summarizes the Kit list
  state and proposes (never executes) a non-responder cull. The owner approves the
  cull out-of-band; the daemon only ever proposes.

  Expected aggregated input (Email Watch builds this from the read-only Kit API):
    {
      totalSubscribers: number,
      sequences: [{ id, name, subscribed, stalledCount }],
      broadcasts: [{ id, subject, sentAt, recipients, openRate, clickRate }],
      nonResponders: [{ id, email, lastEngagedAt }],   // candidates for cull
      expectedTagFirings: [{ tag, expected, actual }]   // tags that should have fired
    }

  Returns email_health shape minus captured_at (module stamps it):
    { summary, flags, proposed_cull, needs_attention }
*/

function num(v, d = 0) {
  return typeof v === 'number' && isFinite(v) ? v : d;
}

/**
 * @param {object} input
 * @param {object} [opts]
 * @param {number} [opts.lowClickRate=0.01]    broadcast clickRate below this → underperforming CTA
 * @param {number} [opts.cullAfterDays=180]     non-responder older than this → cull candidate
 * @param {number} [opts.cullSampleCap=50]      cap proposed_cull list size
 * @param {string} [opts.now]                   ISO now (for deterministic age math in tests)
 */
function analyzeEmail(input, opts = {}) {
  const {
    lowClickRate = 0.01,
    cullAfterDays = 180,
    cullSampleCap = 50,
    now,
  } = opts;
  const nowMs = now ? Date.parse(now) : Date.now();
  const data = input || {};

  const flags = [];
  let needsAttention = false;

  // --- Subscribers stalled mid-sequence ---
  const sequences = Array.isArray(data.sequences) ? data.sequences : [];
  const totalStalled = sequences.reduce((acc, s) => acc + num(s.stalledCount), 0);
  if (totalStalled > 0) {
    const worst = sequences
      .filter((s) => num(s.stalledCount) > 0)
      .sort((a, b) => num(b.stalledCount) - num(a.stalledCount))[0];
    flags.push({
      type: 'stalled_in_sequence',
      count: totalStalled,
      detail: worst ? `${totalStalled} stalled; worst: "${worst.name}" (${num(worst.stalledCount)})` : `${totalStalled} stalled`,
    });
  }

  // --- Underperforming CTAs (low click rate broadcasts) ---
  const broadcasts = Array.isArray(data.broadcasts) ? data.broadcasts : [];
  const weakCtas = broadcasts.filter(
    (b) => typeof b.clickRate === 'number' && b.clickRate < lowClickRate
  );
  if (weakCtas.length > 0) {
    flags.push({
      type: 'weak_cta',
      count: weakCtas.length,
      detail: `${weakCtas.length} broadcast(s) under ${(lowClickRate * 100).toFixed(1)}% click rate`,
      examples: weakCtas.slice(0, 3).map((b) => ({ subject: b.subject, clickRate: b.clickRate })),
    });
  }

  // --- Tags that should have fired but didn't ---
  const expectedTags = Array.isArray(data.expectedTagFirings) ? data.expectedTagFirings : [];
  const misfires = expectedTags.filter((t) => num(t.actual) < num(t.expected));
  if (misfires.length > 0) {
    flags.push({
      type: 'tag_misfire',
      count: misfires.length,
      detail: `${misfires.length} tag automation(s) under-fired`,
      examples: misfires.slice(0, 5).map((t) => ({ tag: t.tag, expected: t.expected, actual: t.actual })),
    });
    needsAttention = true;
  }

  // --- Growing non-responder count + proposed cull ---
  const nonResponders = Array.isArray(data.nonResponders) ? data.nonResponders : [];
  const cutoffMs = nowMs - cullAfterDays * 86400000;
  const cullCandidates = nonResponders.filter((r) => {
    const t = r.lastEngagedAt ? Date.parse(r.lastEngagedAt) : NaN;
    return !isNaN(t) && t < cutoffMs;
  });
  let proposedCull = null;
  if (cullCandidates.length > 0) {
    flags.push({
      type: 'non_responders',
      count: cullCandidates.length,
      detail: `${cullCandidates.length} subscriber(s) cold for >${cullAfterDays}d`,
    });
    proposedCull = {
      criterion: `no engagement in >${cullAfterDays} days`,
      count: cullCandidates.length,
      // Proposal only — NEVER executed by the daemon. Owner approves out-of-band.
      sample: cullCandidates.slice(0, cullSampleCap).map((r) => ({
        id: r.id,
        email: r.email,
        lastEngagedAt: r.lastEngagedAt,
      })),
      executed: false,
    };
    needsAttention = true;
  }

  const summary = buildSummary({
    totalSubscribers: num(data.totalSubscribers),
    totalStalled,
    weakCtas: weakCtas.length,
    misfires: misfires.length,
    cull: cullCandidates.length,
  });

  return {
    summary,
    flags,
    proposed_cull: proposedCull,
    needs_attention: needsAttention,
    // Convenience for the Brief; not part of the email_health row.
    _signal: needsAttention
      ? { source: 'email', severity: 'notice', needsAttention: true, title: summary, detail: flags.map((f) => f.detail).join(' · ') }
      : null,
  };
}

function buildSummary(c) {
  const parts = [`${c.totalSubscribers} subs`];
  if (c.totalStalled) parts.push(`${c.totalStalled} stalled`);
  if (c.weakCtas) parts.push(`${c.weakCtas} weak CTA`);
  if (c.misfires) parts.push(`${c.misfires} tag misfire`);
  if (c.cull) parts.push(`${c.cull} cull candidates`);
  if (parts.length === 1) parts.push('nominal');
  return parts.join(', ');
}

module.exports = { analyzeEmail };

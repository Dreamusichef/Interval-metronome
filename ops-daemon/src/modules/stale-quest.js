'use strict';

/*
  Stale-Quest Resurfacing — productivity, NO own table.

  Daily. Reads `staleQuests` from /daemon-read (Great Trials / Errands going cold) and
  surfaces the coldest few in the Brief only. Does NOT create a table and does NOT
  touch organizeBraindump (the in-app voice→quest organizer) — read-only resurfacing.

  The cockpit read bundle is fetched once per cycle by the orchestrator and passed in.
*/

const cockpit = require('../lib/cockpit');

const MAX_SURFACED = 3;

async function run(ctx = {}) {
  const bundle = ctx.bundle || (await cockpit.read());
  const quests = Array.isArray(bundle.staleQuests) ? bundle.staleQuests : [];

  // Coldest first (oldest lastTouched). Unknown/empty timestamps sort last.
  const ranked = [...quests]
    .map((q, i) => ({ q, i, t: q.lastTouched ? Date.parse(q.lastTouched) : NaN }))
    .sort((a, b) => {
      const at = isNaN(a.t) ? Infinity : a.t;
      const bt = isNaN(b.t) ? Infinity : b.t;
      return at - bt || a.i - b.i;
    })
    .slice(0, MAX_SURFACED)
    .map(({ q }) => q);

  const signals = ranked.map((q) => ({
    source: 'quest',
    severity: 'notice',
    needsAttention: true,
    title: `Quest going cold: ${q.title}`,
    detail: `${q.category || 'uncategorized'} — last touched ${q.lastTouched || 'unknown'}`,
  }));

  return { signals, detail: { stale: quests.length, surfaced: signals.length } };
}

module.exports = { run };

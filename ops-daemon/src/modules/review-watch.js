'use strict';

/*
  Review Watch — "The Testaments" → review_alerts. SCAFFOLD, SHIPPED DISABLED.

  This module is present, isolated, and OFF (MODULE_REVIEW_ENABLED=false). It cannot
  run until a review app (Judge.me / Loox) is live and collecting reviews. When that
  exists, it will flag new reviews (especially negatives) needing a reply. Flipping the
  flag is the ONLY step to activate it later.

  The run() body is intentionally a no-op stub: even if the flag were flipped without a
  review source wired, it writes nothing and surfaces nothing. Wire `fetchReviews()`
  to the chosen review app's API, then map to the review_alerts shape below.
*/

const logger = require('../lib/logger');
// const cockpit = require('../lib/cockpit'); // enable when a review source is wired

/**
 * review_alerts row shape (for whoever wires this later):
 *   { captured_at, source, rating, excerpt, needs_reply }
 */

// Placeholder — returns no reviews until a review app is integrated.
async function fetchReviews() {
  return [];
}

async function run() {
  const reviews = await fetchReviews();
  if (reviews.length === 0) {
    logger.info('review-watch: no review source wired (scaffold)');
    return { signals: [], detail: { reviews: 0, scaffold: true } };
  }

  // Reference implementation for when a source exists:
  // const capturedAt = new Date().toISOString();
  // const rows = reviews.map((r) => ({
  //   captured_at: capturedAt,
  //   source: r.source,
  //   rating: r.rating,
  //   excerpt: String(r.body || '').slice(0, 280),
  //   needs_reply: r.rating <= 3 && !r.replied,
  // }));
  // await cockpit.ingest('review_alerts', rows);
  // const signals = rows
  //   .filter((r) => r.needs_reply)
  //   .map((r) => ({ source: 'review', severity: r.rating <= 2 ? 'warn' : 'notice',
  //                  needsAttention: true, title: `New ${r.rating}★ review needs a reply`,
  //                  detail: r.excerpt }));
  // return { signals, detail: { reviews: rows.length } };

  return { signals: [], detail: { reviews: 0, scaffold: true } };
}

module.exports = { run, fetchReviews };

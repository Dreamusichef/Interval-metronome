'use strict';

/*
  Module acceptance criteria that the full-cycle test can't reach (Email needs the Kit
  API; Review is shipped disabled):
   - Email Watch: writes exactly ONE email_health row per run, and PROPOSES a cull
     (needs_attention) but never executes it.
   - Review Watch: present, isolated, OFF — runs as a no-op and writes nothing.
*/

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeHarness } = require('./_harness.cjs');

describe('email + review modules → cockpit stub', () => {
  let h, emailWatch, reviewWatch;
  before(async () => {
    h = await makeHarness();
    emailWatch = require('../../src/modules/email-watch');
    reviewWatch = require('../../src/modules/review-watch');
  });
  after(async () => h && h.cleanup());

  test('email-watch writes one row/run and proposes (never executes) a cull', async () => {
    const aggregate = {
      totalSubscribers: 500,
      sequences: [],
      broadcasts: [],
      nonResponders: [{ id: 1, email: 'cold@example.com', lastEngagedAt: '2025-01-01T00:00:00Z' }],
      expectedTagFirings: [],
    };

    await emailWatch.run({ aggregate });

    const rows = h.rows('email_health');
    assert.equal(rows.length, 1, 'one email_health row');
    assert.ok(rows[0].proposed_cull, 'a cull is proposed');
    assert.equal(rows[0].proposed_cull.executed, false, 'cull is NOT executed');
    assert.equal(rows[0].proposed_cull.count, 1);
    assert.equal(rows[0].needs_attention, true);

    // Exactly one row per run (email_health appends — a second run adds one more).
    await emailWatch.run({ aggregate });
    assert.equal(h.rows('email_health').length, 2);
  });

  test('review-watch is a no-op scaffold: writes nothing, surfaces nothing', async () => {
    const r = await reviewWatch.run();
    assert.deepEqual(r.signals, []);
    assert.equal(r.detail.scaffold, true);
    assert.equal(h.rows('review_alerts').length, 0, 'no review_alerts written');
  });
});

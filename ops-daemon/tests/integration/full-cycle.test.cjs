'use strict';

/*
  Keystone end-to-end test: a real daily cycle against the in-process cockpit stub.
  Exercises Money + Funnel + Stale-Quest + the Brief, then verifies idempotency on rerun.
*/

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeHarness } = require('./_harness.cjs');

const ANOMALY_BUNDLE = {
  snapshot: {
    asOf: '2026-06-24T00:00:00Z',
    refunds: { amount: 300, trailingWeeklyAvgAmount: 100 }, // 3x → refund_spike
    payments: { failed: 2, disputed: 1 }, // failed + disputed(critical)
    revenue: { weekToDateAmount: 1200, trailingWeeklyAvgAmount: 1150 }, // normal
    launch: { label: 'Art of Double Bass 3.0', value: 0 },
  },
  apprenticesDue: [{ name: 'Wei Jr', lastLesson: '2026-05-01', status: 'overdue' }],
  staleQuests: [{ title: 'Edit lesson 12', category: 'content', lastTouched: '2026-04-01' }],
};

describe('full cycle → cockpit stub', () => {
  let h;
  before(async () => {
    h = await makeHarness({
      MODULE_MONEY_ENABLED: 'true',
      MODULE_FUNNEL_ENABLED: 'true',
      MODULE_STALEQUEST_ENABLED: 'true',
    });
    h.stub.setBundle(ANOMALY_BUNDLE);
  });
  after(async () => h && h.cleanup());

  test('first cycle: modules write to the cockpit and the brief posts once', async () => {
    await h.runDailyCycle();

    // Money: refund_spike + failed_payments + disputed_payments (3 rows).
    const money = h.rows('money_alerts');
    assert.equal(money.length, 3, 'three money alerts');
    assert.ok(money.find((r) => r.type === 'disputed_payments' && r.severity === 'critical'));
    assert.ok(money.every((r) => typeof r.captured_at === 'string'), 'rows are stamped');

    // Funnel: one dojo pulse row (baseline on first read).
    const funnel = h.rows('funnel_pulse');
    assert.equal(funnel.length, 1);
    assert.equal(funnel[0].source, 'dojo');

    // Brief: exactly one daily_brief row, posted, with the critical item ranked first.
    const briefs = h.rows('daily_brief');
    assert.equal(briefs.length, 1);
    assert.equal(briefs[0].posted_webhook, true);
    assert.ok(briefs[0].items.length >= 3);
    assert.equal(briefs[0].items[0].severity, 'critical');
    // Apprentice + stale-quest signals reached the brief.
    const titles = briefs[0].items.map((i) => i.title).join(' | ');
    assert.match(titles, /Apprentice due: Wei Jr|Quest going cold|disputed/);

    // Webhook posted exactly once, content carries the brief.
    assert.equal(h.posts().length, 1);
    assert.match(h.posts()[0].content, /Dawn Auspex/);

    // The read bundle was fetched ONCE and shared across money/stale/brief.
    assert.equal(h.stub.state.reads, 1, 'single /daemon-read per cycle');
  });

  test('rerun same day: no double-post, brief upserted, funnel weekly-gated', async () => {
    await h.runDailyCycle();

    // Brief never double-posts; daily_brief stays one row (upsert by brief_date).
    assert.equal(h.posts().length, 1, 'webhook still posted once');
    assert.equal(h.rows('daily_brief').length, 1, 'one brief row for the day');

    // Funnel just ran, so the weekly self-gate skips it → still one pulse row.
    assert.equal(h.rows('funnel_pulse').length, 1, 'funnel weekly-gated on rerun');

    // money_alerts is a time series (no conflict key) → it appends (3 more).
    assert.equal(h.rows('money_alerts').length, 6);
  });
});

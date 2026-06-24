'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { detectMoneyAlerts } = require('../src/domain/money-analysis');

describe('money-analysis — anomalies', () => {
  test('quiet snapshot emits nothing', () => {
    const { rows } = detectMoneyAlerts({
      refunds: { amount: 10, trailingWeeklyAvgAmount: 12 },
      payments: { failed: 0, disputed: 0 },
      revenue: { weekToDateAmount: 1000, trailingWeeklyAvgAmount: 1000 },
    });
    assert.equal(rows.length, 0);
  });

  test('refund spike flagged at >= 2x trailing avg', () => {
    const { rows } = detectMoneyAlerts({ refunds: { amount: 300, trailingWeeklyAvgAmount: 100 } });
    const r = rows.find((x) => x.type === 'refund_spike');
    assert.ok(r);
    assert.equal(r.needs_attention, true);
    assert.equal(r.severity, 'warn');
  });

  test('failed and disputed payments flagged; disputes are critical', () => {
    const { rows } = detectMoneyAlerts({ payments: { failed: 2, disputed: 1 } });
    assert.ok(rows.find((x) => x.type === 'failed_payments'));
    const d = rows.find((x) => x.type === 'disputed_payments');
    assert.equal(d.severity, 'critical');
  });

  test('revenue dip and spike', () => {
    const dip = detectMoneyAlerts({ revenue: { weekToDateAmount: 300, trailingWeeklyAvgAmount: 1000 } });
    assert.ok(dip.rows.find((x) => x.type === 'revenue_dip'));
    const spike = detectMoneyAlerts({ revenue: { weekToDateAmount: 2000, trailingWeeklyAvgAmount: 1000 } });
    assert.ok(spike.rows.find((x) => x.type === 'revenue_spike'));
  });
});

describe('money-analysis — milestones are idempotent', () => {
  test('fires only on a genuine crossing', () => {
    const crossing = detectMoneyAlerts({ firstStroke: { preorders: 101 } }, { lastPreorders: 98 });
    const m = crossing.rows.find((x) => x.type === 'milestone');
    assert.ok(m);
    assert.match(m.detail, /crossed 100/);
  });

  test('does not re-fire once already above', () => {
    const noFire = detectMoneyAlerts({ firstStroke: { preorders: 120 } }, { lastPreorders: 110 });
    assert.equal(noFire.rows.find((x) => x.type === 'milestone'), undefined);
  });

  test('does not fire on first observation (no prior count)', () => {
    const first = detectMoneyAlerts({ firstStroke: { preorders: 500 } }, { lastPreorders: null });
    assert.equal(first.rows.find((x) => x.type === 'milestone'), undefined);
  });
});

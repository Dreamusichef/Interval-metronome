'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeEmail } = require('../src/domain/email-analysis');

const NOW = '2026-06-24T00:00:00Z';

describe('email-analysis — cull is proposed, never executed', () => {
  test('old non-responders become a proposed cull with needs_attention', () => {
    const out = analyzeEmail(
      {
        totalSubscribers: 1000,
        nonResponders: [
          { id: 1, email: 'a@x.com', lastEngagedAt: '2025-01-01T00:00:00Z' }, // >180d
          { id: 2, email: 'b@x.com', lastEngagedAt: '2026-06-01T00:00:00Z' }, // recent
        ],
      },
      { now: NOW, cullAfterDays: 180 }
    );
    assert.ok(out.proposed_cull);
    assert.equal(out.proposed_cull.count, 1);
    assert.equal(out.proposed_cull.executed, false);
    assert.equal(out.proposed_cull.sample[0].id, 1);
    assert.equal(out.needs_attention, true);
    assert.ok(out._signal);
  });

  test('no cull when nobody is cold', () => {
    const out = analyzeEmail(
      { totalSubscribers: 10, nonResponders: [{ id: 1, email: 'a@x.com', lastEngagedAt: NOW }] },
      { now: NOW }
    );
    assert.equal(out.proposed_cull, null);
  });
});

describe('email-analysis — flags', () => {
  test('weak CTA detection', () => {
    const out = analyzeEmail(
      { totalSubscribers: 10, broadcasts: [{ id: 1, subject: 'x', clickRate: 0.001 }] },
      { now: NOW, lowClickRate: 0.01 }
    );
    assert.ok(out.flags.find((f) => f.type === 'weak_cta'));
  });

  test('tag misfire sets needs_attention', () => {
    const out = analyzeEmail(
      { totalSubscribers: 10, expectedTagFirings: [{ tag: 't', expected: 5, actual: 1 }] },
      { now: NOW }
    );
    assert.ok(out.flags.find((f) => f.type === 'tag_misfire'));
    assert.equal(out.needs_attention, true);
  });

  test('stalled-in-sequence counts aggregate', () => {
    const out = analyzeEmail(
      { totalSubscribers: 10, sequences: [{ id: 1, name: 'Onboard', stalledCount: 7 }] },
      { now: NOW }
    );
    const f = out.flags.find((x) => x.type === 'stalled_in_sequence');
    assert.ok(f);
    assert.equal(f.count, 7);
  });

  test('summary always reports subscriber count', () => {
    const out = analyzeEmail({ totalSubscribers: 1234 }, { now: NOW });
    assert.match(out.summary, /1234 subs/);
    assert.equal(out.needs_attention, false);
  });
});

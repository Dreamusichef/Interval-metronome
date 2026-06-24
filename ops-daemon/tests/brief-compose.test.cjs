'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { composeBrief, crossesThreshold, priorityScore } = require('../src/domain/brief-compose');

function sig(o) {
  return Object.assign({ source: 'money', severity: 'info', needsAttention: false, title: 't', detail: '' }, o);
}

describe('brief-compose — threshold', () => {
  test('quiet day yields empty items and a quiet summary', () => {
    const b = composeBrief([sig({ severity: 'info', needsAttention: false })], { date: '2026-06-24' });
    assert.equal(b.items.length, 0);
    assert.match(b.summary, /Quiet day/);
    assert.equal(b.brief_date, '2026-06-24');
  });

  test('info severity is below threshold unless flagged', () => {
    assert.equal(crossesThreshold(sig({ severity: 'info', needsAttention: false })), false);
    assert.equal(crossesThreshold(sig({ severity: 'info', needsAttention: true })), true);
    assert.equal(crossesThreshold(sig({ severity: 'notice', needsAttention: false })), true);
  });
});

describe('brief-compose — ranking and cap', () => {
  test('orders by severity then needsAttention, caps at max', () => {
    const signals = [
      sig({ severity: 'notice', title: 'a' }),
      sig({ severity: 'critical', title: 'b' }),
      sig({ severity: 'warn', needsAttention: true, title: 'c' }),
      sig({ severity: 'warn', needsAttention: false, title: 'd' }),
      sig({ severity: 'notice', needsAttention: true, title: 'e' }),
      sig({ severity: 'notice', title: 'f' }),
    ];
    const b = composeBrief(signals, { date: '2026-06-24', max: 5 });
    assert.equal(b.items.length, 5);
    assert.equal(b.items[0].title, 'b'); // critical first
    assert.equal(b.items[1].title, 'c'); // warn + needsAttention beats plain warn
    assert.equal(b.items[2].title, 'd');
    assert.match(b.summary, /5 things need you today/);
    assert.match(b.summary, /\+1 more below the fold/);
  });

  test('priorityScore: needsAttention breaks severity ties', () => {
    assert.ok(
      priorityScore(sig({ severity: 'notice', needsAttention: true })) >
        priorityScore(sig({ severity: 'notice', needsAttention: false }))
    );
  });

  test('singular summary phrasing for one item', () => {
    const b = composeBrief([sig({ severity: 'warn', title: 'only' })], { date: '2026-06-24' });
    assert.equal(b.items.length, 1);
    assert.match(b.summary, /1 thing needs you today/);
  });
});

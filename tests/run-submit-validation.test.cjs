'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { GRACE_SEC, validateRunSubmit, maxPlayedSec } = require('../lib/run-submit-validation.cjs');

describe('run submit validation', () => {
  const nowMs = Date.parse('2026-06-18T15:00:00.000Z');
  const base = {
    run_id: '11111111-1111-1111-1111-111111111111',
    started_at: '2026-06-18T15:00:00.000Z',
    played_sec: 120,
    mode: 'timetrial',
    duration_sec: 120,
  };

  test('passes when no previous run', () => {
    const r = validateRunSubmit(null, base, nowMs + 120000);
    assert.equal(r.valid, true);
    assert.equal(r.reject_reason, null);
  });

  test('rejects impossible back-to-back timing', () => {
    const prev = {
      created_at: '2026-06-18T15:00:00.000Z',
      started_at: '2026-06-18T14:58:00.000Z',
      played_sec: 60,
    };
    const r = validateRunSubmit(prev, {
      ...base,
      started_at: '2026-06-18T15:01:00.000Z',
      played_sec: 120,
    }, nowMs + 60000);
    assert.equal(r.valid, false);
    assert.equal(r.reject_reason, 'impossible_timing');
  });

  test('rejects overlapping started_at chain', () => {
    const prev = {
      created_at: '2026-06-18T14:59:00.000Z',
      started_at: '2026-06-18T14:58:00.000Z',
      played_sec: 120,
    };
    const r = validateRunSubmit(prev, {
      ...base,
      started_at: '2026-06-18T14:59:30.000Z',
      played_sec: 60,
    }, nowMs + 180000);
    assert.equal(r.valid, false);
    assert.equal(r.reject_reason, 'overlapping_run');
  });

  test('allows submission after enough elapsed time', () => {
    const prev = {
      created_at: '2026-06-18T14:58:00.000Z',
      started_at: '2026-06-18T14:57:00.000Z',
      played_sec: 60,
    };
    const r = validateRunSubmit(prev, {
      ...base,
      started_at: '2026-06-18T15:00:00.000Z',
      played_sec: 90,
    }, nowMs);
    assert.equal(r.valid, true);
  });

  test('rejects played_sec above mode max', () => {
    const r = validateRunSubmit(null, { ...base, played_sec: maxPlayedSec('timetrial', 120) + 1 }, nowMs);
    assert.equal(r.valid, false);
    assert.equal(r.reject_reason, 'invalid_played_sec');
  });

  test('grace constant is 25 seconds', () => {
    assert.equal(GRACE_SEC, 25);
  });
});

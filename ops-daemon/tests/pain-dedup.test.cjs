'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalKey,
  newCanonicalRow,
  mergeObservation,
  toCockpitRow,
  QUOTE_CAP,
} = require('../src/domain/pain/dedup');

const NOW = '2026-06-24T00:00:00Z';
const LATER = '2026-06-25T00:00:00Z';

describe('pain dedup — canonical key', () => {
  test('stable and slug-normalized', () => {
    assert.equal(canonicalKey('speed_bpm_ceiling', 'Double Bass Plateau'), 'speed-bpm-ceiling::double-bass-plateau');
    assert.equal(
      canonicalKey('speed_bpm_ceiling', 'Double  Bass  Plateau'),
      canonicalKey('speed_bpm_ceiling', 'double bass plateau')
    );
  });
});

describe('pain dedup — accumulation', () => {
  test('new row then merge increments frequency and averages intensity', () => {
    const row = newCanonicalRow({
      category: 'speed_bpm_ceiling',
      label: 'double bass plateau',
      key: canonicalKey('speed_bpm_ceiling', 'double bass plateau'),
      quote: 'stuck at 180bpm',
      intensity: 2,
      sourceHash: 'h:aaa',
      now: NOW,
    });
    assert.equal(row.frequency, 1);
    assert.equal(row.intensity_avg, 2);

    mergeObservation(row, { quote: 'cannot break 190', intensity: 3, sourceHash: 'h:bbb', now: LATER });
    assert.equal(row.frequency, 2);
    assert.equal(row.intensity_avg, 2.5);
    assert.equal(row.last_seen, LATER);
    assert.deepEqual(row.example_quotes, ['stuck at 180bpm', 'cannot break 190']);
    assert.deepEqual(row.source_hashes, ['h:aaa', 'h:bbb']);
  });

  test('source_hashes is a set of distinct authors; frequency still counts messages', () => {
    const row = newCanonicalRow({
      category: 'timing_consistency',
      label: 'rushing fills',
      key: 'k',
      quote: 'q1',
      intensity: 1,
      sourceHash: 'h:same',
      now: NOW,
    });
    mergeObservation(row, { quote: 'q2', intensity: 1, sourceHash: 'h:same', now: LATER });
    assert.equal(row.frequency, 2); // two messages
    assert.deepEqual(row.source_hashes, ['h:same']); // one distinct author
  });

  test('example_quotes are capped and deduped', () => {
    const row = newCanonicalRow({ category: 'other', label: 'x', key: 'k', quote: 'q0', intensity: 1, sourceHash: 'h:0', now: NOW });
    for (let i = 1; i < QUOTE_CAP + 5; i++) {
      mergeObservation(row, { quote: `q${i}`, intensity: 1, sourceHash: `h:${i}`, now: LATER });
    }
    assert.equal(row.example_quotes.length, QUOTE_CAP);
    // duplicate quote is not added twice
    const before = row.example_quotes.length;
    mergeObservation(row, { quote: 'q0', intensity: 1, sourceHash: 'h:dup', now: LATER });
    assert.equal(row.example_quotes.length, before);
  });

  test('toCockpitRow strips internal-only fields', () => {
    const row = newCanonicalRow({ category: 'other', label: 'x', key: 'k', quote: 'q', intensity: 2, sourceHash: 'h:0', now: NOW });
    const out = toCockpitRow(row);
    assert.equal(out.key, undefined);
    assert.equal(out.intensity_sum, undefined);
    assert.equal(out.label, 'x');
    assert.equal(out.intensity_avg, 2);
    assert.ok(Array.isArray(out.source_hashes));
  });
});

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseClassifyResult,
  parseDedupResult,
  extractJson,
  TAXONOMY_KEYS,
} = require('../src/domain/pain/taxonomy');

describe('pain taxonomy — classify parser', () => {
  test('parses a valid struggle', () => {
    const out = parseClassifyResult(
      '{"is_struggle": true, "category": "speed_bpm_ceiling", "label": "double bass plateau", "intensity": 3}'
    );
    assert.equal(out.isStruggle, true);
    assert.equal(out.category, 'speed_bpm_ceiling');
    assert.equal(out.label, 'double bass plateau');
    assert.equal(out.intensity, 3);
  });

  test('non-struggle returns isStruggle false', () => {
    assert.equal(parseClassifyResult('{"is_struggle": false}').isStruggle, false);
    assert.equal(parseClassifyResult('not json at all').isStruggle, false);
  });

  test('unknown category falls back to other; intensity clamps', () => {
    const out = parseClassifyResult('{"is_struggle": true, "category": "nonsense", "label": "x", "intensity": 9}');
    assert.equal(out.category, 'other');
    assert.ok(TAXONOMY_KEYS.has(out.category));
    assert.equal(out.intensity, 1);
  });

  test('missing label falls back to category label', () => {
    const out = parseClassifyResult('{"is_struggle": true, "category": "gear_setup", "label": "", "intensity": 2}');
    assert.equal(out.label, 'Gear & setup');
  });

  test('extractJson ignores surrounding prose', () => {
    const obj = extractJson('Sure! Here you go: {"is_struggle": true, "category":"other","label":"a","intensity":1} done');
    assert.equal(obj.is_struggle, true);
  });
});

describe('pain taxonomy — dedup parser', () => {
  const existing = ['double bass plateau', 'heel-toe control'];

  test('returns a match only if it names an existing label', () => {
    assert.equal(parseDedupResult('{"match":"double bass plateau"}', existing), 'double bass plateau');
    assert.equal(parseDedupResult('{"match":"hallucinated label"}', existing), null);
    assert.equal(parseDedupResult('{"match":""}', existing), null);
    assert.equal(parseDedupResult('garbage', existing), null);
  });
});

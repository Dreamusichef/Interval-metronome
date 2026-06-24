'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { hashHandle } = require('../src/lib/hash');

describe('hash — salted handle hashing', () => {
  test('deterministic for the same handle + salt', () => {
    assert.equal(hashHandle('weilung', 's3cret'), hashHandle('weilung', 's3cret'));
  });

  test('normalizes case and surrounding whitespace', () => {
    assert.equal(hashHandle('  WeiLung ', 's3cret'), hashHandle('weilung', 's3cret'));
  });

  test('different salt → different hash (rotating re-buckets)', () => {
    assert.notEqual(hashHandle('weilung', 'saltA'), hashHandle('weilung', 'saltB'));
  });

  test('prefixed and does not leak the raw handle', () => {
    const h = hashHandle('SuperSecretHandle#1234', 's3cret');
    assert.match(h, /^h:[0-9a-f]{32}$/);
    assert.ok(!h.includes('SuperSecret'));
  });

  test('throws without a salt', () => {
    assert.throws(() => hashHandle('x', ''), /salt is required/);
  });
});

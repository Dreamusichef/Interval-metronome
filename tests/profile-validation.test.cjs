'use strict';

/*
  Unit tests for public profile field validation in profile-validation.js.

  Run:  npm test   (or:  node --test tests/profile-validation.test.cjs)
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const V = require('../assets/js/profile-validation.js');

describe('ProfileValidation.validateProfileFields', () => {
  test('accepts valid alias and null avatar (hidden)', () => {
    const r = V.validateProfileFields({ display_name: '  StickMaster  ', avatar_url: null });
    assert.equal(r.error, undefined);
    assert.deepEqual(r.value, { display_name: 'StickMaster', avatar_url: null });
  });

  test('accepts https avatar URL', () => {
    const r = V.validateProfileFields({
      display_name: 'Alex',
      avatar_url: 'https://example.com/avatar.png',
    });
    assert.equal(r.error, undefined);
    assert.equal(r.value.avatar_url, 'https://example.com/avatar.png');
  });

  test('rejects alias shorter than 2 characters', () => {
    const r = V.validateProfileFields({ display_name: 'A', avatar_url: null });
    assert.equal(r.error, 'alias-too-short');
  });

  test('rejects alias longer than 32 characters', () => {
    const r = V.validateProfileFields({ display_name: 'x'.repeat(33), avatar_url: null });
    assert.equal(r.error, 'alias-too-long');
  });

  test('strips control characters from alias', () => {
    const r = V.validateProfileFields({ display_name: 'Al\x00ex', avatar_url: null });
    assert.equal(r.error, undefined);
    assert.equal(r.value.display_name, 'Alex');
  });

  test('rejects non-https avatar URL', () => {
    assert.equal(V.validateProfileFields({ display_name: 'Alex', avatar_url: 'http://x.com/a.png' }).error, 'avatar-invalid-url');
    assert.equal(V.validateProfileFields({ display_name: 'Alex', avatar_url: 'javascript:alert(1)' }).error, 'avatar-invalid-url');
    assert.equal(V.validateProfileFields({ display_name: 'Alex', avatar_url: 'data:image/png;base64,abc' }).error, 'avatar-invalid-url');
  });

  test('treats blank avatar URL as hidden', () => {
    const r = V.validateProfileFields({ display_name: 'Alex', avatar_url: '   ' });
    assert.equal(r.error, undefined);
    assert.equal(r.value.avatar_url, null);
  });
});

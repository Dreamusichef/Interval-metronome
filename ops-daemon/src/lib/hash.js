'use strict';

/*
  Salted hashing for student handles. A Discord handle must NEVER leave the VPS;
  only its salted hash reaches the cockpit (matching the Dojo's PII-free public
  projection discipline). Pure aside from node:crypto (a builtin) — unit-testable.
*/

const crypto = require('crypto');

/**
 * Stable salted hash of a handle. Same (handle, salt) → same hash, so reruns
 * never double-count and the cockpit can correlate without seeing the handle.
 * @param {string} handle  raw Discord author handle (never persisted to cockpit)
 * @param {string} salt    DAEMON_HASH_SALT
 * @returns {string} hex sha256, prefixed so it's obviously a hash downstream
 */
function hashHandle(handle, salt) {
  if (!salt) throw new Error('hashHandle: salt is required (DAEMON_HASH_SALT)');
  const normalized = String(handle == null ? '' : handle).trim().toLowerCase();
  const digest = crypto
    .createHmac('sha256', salt)
    .update(normalized)
    .digest('hex');
  return 'h:' + digest.slice(0, 32);
}

module.exports = { hashHandle };

'use strict';

/*
  Native fetch with bounded exponential-backoff retry. Used by every outbound
  HTTP caller (cockpit, Kit, Dojo, Discord webhook). Node 20+ has
  global fetch, so no dependency.
*/

const logger = require('./logger');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch with retry on network errors and 5xx/429 responses.
 * @param {string} url
 * @param {object} options       passed to fetch
 * @param {object} [retryOpts]
 * @param {number} [retryOpts.retries=3]
 * @param {number} [retryOpts.backoffMs=1000]  base; doubles each attempt
 * @param {number} [retryOpts.timeoutMs=20000] per-attempt timeout
 * @param {string} [retryOpts.label]           for log context
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options = {}, retryOpts = {}) {
  const {
    retries = 3,
    backoffMs = 1000,
    timeoutMs = 20000,
    label = 'http',
  } = retryOpts;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      // Retry transient server-side conditions.
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`${label}: HTTP ${res.status}`);
        if (attempt < retries) {
          const wait = backoffMs * 2 ** attempt;
          logger.warn('http retry', { label, status: res.status, attempt, wait });
          await sleep(wait);
          continue;
        }
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) {
        const wait = backoffMs * 2 ** attempt;
        logger.warn('http retry (network)', { label, error: String(err && err.message || err), attempt, wait });
        await sleep(wait);
        continue;
      }
    }
  }
  throw lastErr || new Error(`${label}: request failed`);
}

/** Convenience: fetch + parse JSON, throwing on non-2xx. */
async function fetchJson(url, options = {}, retryOpts = {}) {
  const res = await fetchWithRetry(url, options, retryOpts);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${retryOpts.label || 'http'}: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  return res.json();
}

module.exports = { fetchWithRetry, fetchJson, sleep };

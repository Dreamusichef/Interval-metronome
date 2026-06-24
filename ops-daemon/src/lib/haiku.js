'use strict';

/*
  Haiku runtime client — the ONLY place the daemon calls an LLM.

  Auth: standalone ANTHROPIC_API_KEY read from the environment, via @anthropic-ai/sdk
  calling the Messages API directly. We do NOT shell out to `claude` / `claude -p`,
  the Agent SDK, or any subscription/OAuth path — that is not valid for unattended
  server automation and fails on token expiry.

  Engine: claude-haiku-4-5 via the Batch API (halves cost; the nightly classification
  is not latency-sensitive). The taxonomy prefix is sent as a prompt-cached system
  block so the shared prefix bills at cache-read rates on every request after the
  first — caching only engages once the prefix passes Haiku's ~4096-token minimum;
  below that it is a harmless no-op.

  The SDK is lazy-required so that merely loading the daemon doesn't hard-depend on
  the package being installed when the Pain-Point Miner is disabled.
*/

const config = require('../config');
const logger = require('./logger');
const { sleep } = require('./http');

let _client = null;

function getClient() {
  if (_client) return _client;
  if (!config.anthropic.apiKey) {
    throw new Error('haiku: ANTHROPIC_API_KEY is not set');
  }
  // Lazy require — keeps the dependency optional for non-painpoints deployments.
  const SDK = require('@anthropic-ai/sdk');
  const Anthropic = SDK.Anthropic || SDK.default || SDK;
  _client = new Anthropic({
    apiKey: config.anthropic.apiKey,
    maxRetries: 4, // SDK retries 429/5xx/connection errors with exponential backoff
  });
  return _client;
}

/** Build a prompt-cached system block array from a stable prefix string. */
function cachedSystem(prefixText) {
  return [
    {
      type: 'text',
      text: prefixText,
      cache_control: { type: 'ephemeral' },
    },
  ];
}

/**
 * Run a batch of classification requests through Haiku and collect results by custom_id.
 *
 * @param {Array<{custom_id: string, params: object}>} requests
 *   Each `params` is a Messages API non-streaming body (model/max_tokens/system/messages).
 *   Callers should reuse the SAME cached system block across requests so the prefix caches.
 * @param {object} [opts]
 * @param {number} [opts.pollIntervalMs=15000]
 * @param {number} [opts.maxWaitMs=3600000]  give up after this long (default 1h)
 * @returns {Promise<Map<string, {ok: boolean, text?: string, error?: string}>>}
 */
async function runBatch(requests, opts = {}) {
  const out = new Map();
  if (!Array.isArray(requests) || requests.length === 0) return out;

  const { pollIntervalMs = 15000, maxWaitMs = 3600000 } = opts;
  const client = getClient();

  const batch = await client.messages.batches.create({ requests });
  logger.info('haiku batch created', { id: batch.id, count: requests.length });

  // Poll until the batch ends or we exceed the wait budget.
  const startedAt = Date.now();
  let status = batch;
  while (status.processing_status !== 'ended') {
    if (Date.now() - startedAt > maxWaitMs) {
      throw new Error(`haiku: batch ${batch.id} did not end within ${maxWaitMs}ms`);
    }
    await sleep(pollIntervalMs);
    status = await client.messages.batches.retrieve(batch.id);
    logger.debug('haiku batch poll', {
      id: batch.id,
      status: status.processing_status,
      counts: status.request_counts,
    });
  }

  // Results arrive in ANY order — key strictly by custom_id, never by position.
  for await (const entry of await client.messages.batches.results(batch.id)) {
    const id = entry.custom_id;
    const r = entry.result;
    if (r && r.type === 'succeeded') {
      const text = (r.message.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      out.set(id, { ok: true, text });
    } else {
      const errType = r && (r.type || (r.error && r.error.type)) || 'unknown';
      out.set(id, { ok: false, error: String(errType) });
    }
  }
  logger.info('haiku batch done', { id: batch.id, results: out.size });
  return out;
}

module.exports = { getClient, cachedSystem, runBatch };

'use strict';

/*
  Module isolation wrapper — the hard requirement that keeps the daemon resilient.

  Each module is run through here: gated by its MODULE_*_ENABLED flag, wrapped in
  try/catch, and given its own run_log row. One module failing or erroring must not
  stop the others or the Brief — runModule never throws; it returns a structured
  result, and the cycle composes the Brief from whatever succeeded.
*/

const logger = require('./logger');
const { startRun, finishRun } = require('./runlog');

/**
 * @typedef {Object} ModuleResult
 * @property {string} module
 * @property {'ok'|'error'|'skipped'} status
 * @property {Array<object>} signals   normalized brief signals (see domain/brief-compose)
 * @property {object} [detail]         module-specific summary for run_log / debugging
 * @property {string} [error]
 */

/**
 * Run one module in isolation.
 * @param {string} name       module name (also the run_log + watermark key)
 * @param {boolean} enabled   its MODULE_*_ENABLED flag
 * @param {() => Promise<{signals?: object[], detail?: object}>} fn
 * @returns {Promise<ModuleResult>}
 */
async function runModule(name, enabled, fn) {
  if (!enabled) {
    logger.info('module skipped (disabled)', { module: name });
    // Record the skip in run_log too, so the table reflects every cycle's full roster.
    const skipId = startRun(name);
    finishRun(skipId, 'skipped', 'disabled by MODULE_*_ENABLED flag');
    return { module: name, status: 'skipped', signals: [] };
  }

  const runId = startRun(name);
  try {
    const result = (await fn()) || {};
    const signals = Array.isArray(result.signals) ? result.signals : [];
    const detail = result.detail || { signals: signals.length };
    finishRun(runId, 'ok', detail);
    logger.info('module ok', { module: name, signals: signals.length });
    return { module: name, status: 'ok', signals, detail };
  } catch (err) {
    const message = String((err && err.message) || err);
    finishRun(runId, 'error', message);
    logger.error('module failed', { module: name, error: message });
    return { module: name, status: 'error', signals: [], error: message };
  }
}

module.exports = { runModule };

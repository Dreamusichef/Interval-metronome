'use strict';

/*
  The daily cycle — orchestration only, no process side effects on require (so it's
  testable). index.js wires this to the node-cron scheduler and the --once entry.

  Each module runs in isolation (try/catch, MODULE_*_ENABLED gate, its own run_log row).
  One module failing never stops the others or the Brief — the Brief composes from
  whatever succeeded this cycle.
*/

const config = require('./config');
const logger = require('./lib/logger');
const cockpit = require('./lib/cockpit');
const { runModule } = require('./lib/runner');
const { pruneRunLog } = require('./lib/runlog');

const emailWatch = require('./modules/email-watch');
const moneyWatch = require('./modules/money-watch');
const funnelWatch = require('./modules/funnel-watch');
const painMiner = require('./modules/painpoint-miner');
const reviewWatch = require('./modules/review-watch');
const staleQuest = require('./modules/stale-quest');
const brief = require('./modules/brief');

let cycleRunning = false;

async function runDailyCycle() {
  if (cycleRunning) {
    logger.warn('cycle already running — skipping overlapping trigger');
    return { skipped: true, results: [] };
  }
  cycleRunning = true;
  const startedAt = Date.now();
  logger.info('daily cycle: start');

  try {
    // Fetch the cockpit read bundle once; degrade to empty on failure so the rest runs.
    let bundle = { snapshot: {}, apprenticesDue: [], staleQuests: [] };
    try {
      bundle = await cockpit.read();
    } catch (err) {
      logger.error('cockpit read failed — continuing with empty bundle', {
        error: String((err && err.message) || err),
      });
    }

    const results = [];
    // Each runModule is isolated and never throws.
    results.push(await runModule('email-watch', config.modules.email, () => emailWatch.run()));
    results.push(await runModule('money-watch', config.modules.money, () => moneyWatch.run({ bundle })));

    // Funnel self-gates to weekly; guard the gate check so a DB hiccup in isDue()
    // can never abort the cycle (module isolation is a hard requirement).
    let funnelDue = false;
    if (config.modules.funnel) {
      try {
        funnelDue = funnelWatch.isDue();
      } catch (err) {
        logger.error('funnel isDue check failed — treating as not due', {
          error: String((err && err.message) || err),
        });
      }
    }
    results.push(await runModule('funnel-watch', funnelDue, () => funnelWatch.run()));

    results.push(await runModule('painpoint-miner', config.modules.painpoints, () => painMiner.run()));
    results.push(await runModule('review-watch', config.modules.review, () => reviewWatch.run()));
    results.push(await runModule('stale-quest', config.modules.stalequest, () => staleQuest.run({ bundle })));

    // Compose + post the Brief from whatever succeeded this cycle.
    const signals = results.flatMap((r) => r.signals || []);
    const briefResult = await runModule('brief', true, () => brief.run({ signals, bundle }));
    results.push(briefResult);

    pruneRunLog(30);

    const summary = results.map((r) => `${r.module}:${r.status}`).join(' ');
    logger.info('daily cycle: done', {
      ms: Date.now() - startedAt,
      modules: summary,
      signals: signals.length,
    });
    return { skipped: false, results, signals: signals.length };
  } finally {
    cycleRunning = false;
  }
}

module.exports = { runDailyCycle };

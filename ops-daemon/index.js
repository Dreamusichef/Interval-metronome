'use strict';

/*
  The Ops Daemon — entry point.

  A single Node process (its own PM2 app). node-cron fires one daily cycle just after
  Pulse's nightly intake completes (~22:55 SGT; the Dojo day boundary is 23:00 SGT /
  15:00 UTC), so the day's messages are present in ops.db. Funnel Watch self-gates to
  weekly within the cycle.

  Each module runs in isolation (try/catch, MODULE_*_ENABLED gate, its own run_log row).
  One module failing never stops the others or the Brief — the Brief composes from
  whatever succeeded this cycle.

  Usage:
    node index.js          # start the scheduler (PM2 runs this)
    node index.js --once   # run one cycle now and exit (verification / manual trigger)
*/

const cron = require('node-cron');

const config = require('./src/config');
const logger = require('./src/lib/logger');
const cockpit = require('./src/lib/cockpit');
const { closeDb } = require('./src/lib/db');
const { runModule } = require('./src/lib/runner');
const { pruneRunLog } = require('./src/lib/runlog');

const emailWatch = require('./src/modules/email-watch');
const moneyWatch = require('./src/modules/money-watch');
const funnelWatch = require('./src/modules/funnel-watch');
const painMiner = require('./src/modules/painpoint-miner');
const reviewWatch = require('./src/modules/review-watch');
const staleQuest = require('./src/modules/stale-quest');
const brief = require('./src/modules/brief');

let cycleRunning = false;

async function runDailyCycle() {
  if (cycleRunning) {
    logger.warn('cycle already running — skipping overlapping trigger');
    return;
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
  } finally {
    cycleRunning = false;
  }
}

function startScheduler() {
  const warnings = config.validate();
  for (const w of warnings) logger.warn('config', { warning: w });

  if (!cron.validate(config.dailyCron)) {
    logger.error('invalid DAILY_CRON — refusing to start', { cron: config.dailyCron });
    process.exit(1);
  }

  cron.schedule(config.dailyCron, () => {
    runDailyCycle().catch((err) =>
      logger.error('cycle crashed', { error: String((err && err.message) || err) })
    );
  }, { timezone: config.tz });

  logger.info('ops-daemon scheduled', {
    cron: config.dailyCron,
    tz: config.tz,
    modules: config.modules,
  });

  const shutdown = (sig) => {
    logger.info('shutting down', { signal: sig });
    try {
      closeDb();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

async function main() {
  if (process.argv.includes('--once')) {
    const warnings = config.validate();
    for (const w of warnings) logger.warn('config', { warning: w });
    await runDailyCycle();
    closeDb();
    return;
  }
  startScheduler();
}

main().catch((err) => {
  logger.error('fatal', { error: String((err && err.stack) || err) });
  process.exit(1);
});

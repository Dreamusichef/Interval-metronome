'use strict';

/*
  The Ops Daemon — entry point.

  A single Node process (its own PM2 app). node-cron fires one daily cycle just after
  Pulse's nightly intake completes (~22:55 SGT; the Dojo day boundary is 23:00 SGT /
  15:00 UTC), so the day's messages are present in ops.db. The cycle orchestration lives
  in src/cycle.js (testable, no side effects on require); this file only schedules it.

  Usage:
    node index.js          # start the scheduler (PM2 runs this)
    node index.js --once   # run one cycle now and exit (verification / manual trigger)
*/

const cron = require('node-cron');

const config = require('./src/config');
const logger = require('./src/lib/logger');
const { closeDb } = require('./src/lib/db');
const { runDailyCycle } = require('./src/cycle');

function startScheduler() {
  const warnings = config.validate();
  for (const w of warnings) logger.warn('config', { warning: w });

  if (!cron.validate(config.dailyCron)) {
    logger.error('invalid DAILY_CRON — refusing to start', { cron: config.dailyCron });
    process.exit(1);
  }

  cron.schedule(
    config.dailyCron,
    () => {
      runDailyCycle().catch((err) =>
        logger.error('cycle crashed', { error: String((err && err.message) || err) })
      );
    },
    { timezone: config.tz }
  );

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

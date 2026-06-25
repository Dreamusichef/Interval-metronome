'use strict';

/*
  Local demo: start the cockpit stub in-process, run ONE real daily cycle against it with
  a seeded anomaly snapshot, and print what landed in each cockpit table + the webhook.
  No credentials, no network, no real Haiku (Pain-Point Miner is left off — it needs the
  Anthropic API). Run with: npm run demo

  This is the "see it work end to end" artifact, and the same shape you'd use to verify the
  real Lovable endpoints once they're live (point the env at them instead of the stub).
*/

const os = require('os');
const path = require('path');
const { startStub } = require('./stub-cockpit');

const ANOMALY_BUNDLE = {
  snapshot: {
    asOf: new Date().toISOString(),
    refunds: { amount: 320, trailingWeeklyAvgAmount: 100 },
    payments: { failed: 1, disputed: 1 },
    revenue: { weekToDateAmount: 400, trailingWeeklyAvgAmount: 1200 }, // dip
    launch: { label: 'Art of Double Bass 3.0', value: 0 },
  },
  apprenticesDue: [{ name: 'Jordan', lastLesson: '2026-05-10', status: 'overdue' }],
  staleQuests: [{ title: 'Finish the kick-technique module', category: 'content', lastTouched: '2026-03-15' }],
};

(async () => {
  const stub = await startStub({ apiKey: 'demo-key' });
  stub.setBundle(ANOMALY_BUNDLE);

  Object.assign(process.env, {
    OPS_ENV_FILE: path.join(os.tmpdir(), 'ops-demo-nonexistent.env'),
    OPS_DB_PATH: path.join(os.tmpdir(), `ops-demo-${process.pid}.db`),
    ARCANE_INGEST_URL: stub.ingestUrl,
    ARCANE_READ_URL: stub.readUrl,
    DISCORD_BRIEF_WEBHOOK_URL: stub.webhookUrl,
    DOJO_PUBLIC_JSON_URL: stub.dojoUrl,
    DAEMON_API_KEY: stub.apiKey,
    DAEMON_HASH_SALT: 'demo-salt',
    DAEMON_TZ: 'Asia/Singapore',
    MODULE_EMAIL_ENABLED: 'false', // needs the Kit API
    MODULE_MONEY_ENABLED: 'true',
    MODULE_FUNNEL_ENABLED: 'true',
    MODULE_PAINPOINTS_ENABLED: 'false', // needs the Anthropic API
    MODULE_STALEQUEST_ENABLED: 'true',
    MODULE_REVIEW_ENABLED: 'false',
  });

  const { runDailyCycle } = require('../src/cycle');
  const { closeDb } = require('../src/lib/db');

  await runDailyCycle();

  /* eslint-disable no-console */
  console.log('\n=== Rows ingested to the cockpit stub ===');
  console.log(JSON.stringify(stub.state.ingested, null, 2));
  console.log('\n=== Discord webhook posts ===');
  for (const p of stub.state.posts) console.log(p.content);
  console.log('\n=== /daemon-read calls ===', stub.state.reads);

  closeDb();
  await stub.close();
})().catch((err) => {
  /* eslint-disable no-console */
  console.error(err);
  process.exit(1);
});

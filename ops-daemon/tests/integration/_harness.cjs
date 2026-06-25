'use strict';

/*
  Integration-test harness. Starts the in-process cockpit stub, points the daemon's
  config at it via env (set BEFORE requiring config — config reads env once at load),
  and gives back the live modules so a test can run a real cycle and assert on what the
  stub received.

  node --test runs each test FILE in its own process, so config is loaded fresh per file.
  Call makeHarness() once per file (in before()) with the toggles that file needs.
*/

const fs = require('fs');
const os = require('os');
const path = require('path');
const { startStub } = require('../../tools/stub-cockpit');

let counter = 0;

async function makeHarness(envOverrides = {}) {
  const stub = await startStub({ apiKey: 'test-daemon-key' });
  const dbPath = path.join(os.tmpdir(), `ops-it-${process.pid}-${counter++}.db`);

  Object.assign(process.env, {
    // Never pick up a stray .env from cwd.
    OPS_ENV_FILE: path.join(os.tmpdir(), 'ops-nonexistent.env'),
    OPS_DB_PATH: dbPath,
    ARCANE_INGEST_URL: stub.ingestUrl,
    ARCANE_READ_URL: stub.readUrl,
    DISCORD_BRIEF_WEBHOOK_URL: stub.webhookUrl,
    DOJO_PUBLIC_JSON_URL: stub.dojoUrl,
    DAEMON_API_KEY: stub.apiKey,
    DAEMON_HASH_SALT: 'integration-test-salt',
    ANTHROPIC_API_KEY: 'sk-test-dummy',
    DAEMON_TZ: 'Asia/Singapore',
    // Fast HTTP retries so fault-injection tests don't wait on production backoff.
    OPS_HTTP_RETRIES: '2',
    OPS_HTTP_BACKOFF_MS: '1',
    // Conservative defaults; each file overrides what it exercises.
    MODULE_EMAIL_ENABLED: 'false',
    MODULE_MONEY_ENABLED: 'false',
    MODULE_FUNNEL_ENABLED: 'false',
    MODULE_PAINPOINTS_ENABLED: 'false',
    MODULE_STALEQUEST_ENABLED: 'false',
    MODULE_REVIEW_ENABLED: 'false',
    ...envOverrides,
  });

  // Require AFTER env is set so the config singleton captures the stub URLs.
  const config = require('../../src/config');
  const db = require('../../src/lib/db');
  const cockpit = require('../../src/lib/cockpit');
  const haiku = require('../../src/lib/haiku');
  const { runDailyCycle } = require('../../src/cycle');

  // Ensure schema exists (so tests can seed discord_intake before the first cycle).
  db.getDb();

  return {
    stub,
    dbPath,
    config,
    db,
    cockpit,
    haiku,
    runDailyCycle,
    rows: (table) => stub.state.ingested[table] || [],
    posts: () => stub.state.posts,
    async cleanup() {
      try {
        db.closeDb();
      } catch {
        /* ignore */
      }
      await stub.close();
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          fs.unlinkSync(dbPath + suffix);
        } catch {
          /* ignore */
        }
      }
    },
  };
}

/** Seed discord_intake rows (id auto, processed=0). Returns the inserted ids. */
function seedIntake(db, messages) {
  const stmt = db
    .getDb()
    .prepare('INSERT INTO discord_intake (channel, author, content, ts, processed) VALUES (?, ?, ?, ?, 0)');
  const ids = [];
  for (const m of messages) {
    const info = stmt.run(m.channel || 'lounge', m.author, m.content, m.ts || new Date().toISOString());
    ids.push(Number(info.lastInsertRowid));
  }
  return ids;
}

module.exports = { makeHarness, seedIntake };

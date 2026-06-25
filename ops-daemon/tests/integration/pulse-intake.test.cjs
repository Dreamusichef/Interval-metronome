'use strict';

/*
  Pulse intake (pulse-integration/ops-intake.js) end-to-end: the §9 handoff that fills
  ops.db.discord_intake. Uses a temp ops.db and an injected fetcher (no Discord). Verifies
  cursor advance, dedup against the cursor, snowflake boundary skip, and per-channel
  error isolation.
*/

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { runOpsIntake } = require('../../pulse-integration/ops-intake');

const silent = { info() {}, warn() {}, error() {} };
const msg = (id) => ({ id: String(id), author: `user${id}`, content: `message ${id}`, ts: `2026-06-20T00:00:0${id % 10}Z` });

describe('pulse intake → ops.db', () => {
  const dbPath = path.join(os.tmpdir(), `ops-pulse-it-${process.pid}.db`);
  const channels = [{ id: 'c1', name: 'lounge' }];
  const intakeCount = () => {
    const db = new Database(dbPath);
    try {
      return db.prepare('SELECT count(*) n FROM discord_intake').get().n;
    } finally {
      db.close();
    }
  };
  const cursor = (chId) => {
    const db = new Database(dbPath);
    try {
      const row = db.prepare('SELECT cursor FROM watermarks WHERE module = ?').get(`pulse_intake:${chId}`);
      return row ? row.cursor : null;
    } finally {
      db.close();
    }
  };

  before(() => {
    for (const s of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(dbPath + s);
      } catch {
        /* ignore */
      }
    }
  });
  after(() => {
    for (const s of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(dbPath + s);
      } catch {
        /* ignore */
      }
    }
  });

  test('disabled flag is a no-op', async () => {
    const r = await runOpsIntake({ enabled: false, opsDbPath: dbPath, channels, fetchChannelMessages: async () => [msg(1)], logger: silent });
    assert.equal(r.enabled, false);
    assert.equal(r.inserted, 0);
  });

  test('first run inserts all and advances the cursor', async () => {
    const r = await runOpsIntake({
      enabled: true,
      opsDbPath: dbPath,
      channels,
      fetchChannelMessages: async () => [msg(100), msg(101), msg(102)],
      logger: silent,
    });
    assert.equal(r.inserted, 3);
    assert.equal(intakeCount(), 3);
    assert.equal(cursor('c1'), '102');

    // Content + channel landed correctly.
    const db = new Database(dbPath);
    const rows = db.prepare('SELECT channel, author, content FROM discord_intake ORDER BY id').all();
    db.close();
    assert.equal(rows[0].channel, 'lounge');
    assert.equal(rows[0].author, 'user100');
    assert.equal(rows[2].content, 'message 102');
  });

  test('rerun with only already-seen/older messages inserts nothing (dedup vs cursor)', async () => {
    const r = await runOpsIntake({
      enabled: true,
      opsDbPath: dbPath,
      channels,
      fetchChannelMessages: async () => [msg(101), msg(102)], // <= cursor 102
      logger: silent,
    });
    assert.equal(r.inserted, 0);
    assert.equal(intakeCount(), 3);
  });

  test('boundary message is skipped; only strictly-newer ids insert', async () => {
    const r = await runOpsIntake({
      enabled: true,
      opsDbPath: dbPath,
      channels,
      fetchChannelMessages: async () => [msg(102), msg(103), msg(104)], // 102 is the boundary
      logger: silent,
    });
    assert.equal(r.inserted, 2, '102 skipped, 103/104 inserted');
    assert.equal(intakeCount(), 5);
    assert.equal(cursor('c1'), '104');
  });

  test('one failing channel does not sink the others (isolation)', async () => {
    const two = [{ id: 'c1', name: 'lounge' }, { id: 'cbad', name: 'tech' }];
    const r = await runOpsIntake({
      enabled: true,
      opsDbPath: dbPath,
      channels: two,
      fetchChannelMessages: async (chId) => {
        if (chId === 'cbad') throw new Error('429-ish boom');
        return [msg(105)];
      },
      logger: silent,
    });
    assert.equal(r.inserted, 1, 'good channel still inserted');
    assert.equal(r.perChannel.lounge, 1);
    assert.equal(intakeCount(), 6);
  });
});

'use strict';

/*
  Local store accessor — /opt/ops-daemon/ops.db (SQLite, WAL mode).

  VPS-local, gitignored, same trust level as Pulse's dojo-data.json. Chosen over a
  single JSON file to retire the gitignored-JSON resilience risk; back up by copying
  one file. better-sqlite3 is synchronous (fine for a nightly batch daemon).

  Three tables:
    discord_intake  — Pulse INSERTs raw messages here; the Pain-Point Miner reads
                      processed=0, hashes the author on promotion, marks processed,
                      prunes old rows.
    watermarks      — one cursor per module; idempotency.
    run_log         — per-run record for debugging; stays local.
*/

const Database = require('better-sqlite3');
const config = require('../config');

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS discord_intake (
  id        INTEGER PRIMARY KEY,
  channel   TEXT,
  author    TEXT,
  content   TEXT,
  ts        TEXT,
  processed INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_intake_processed ON discord_intake (processed);

CREATE TABLE IF NOT EXISTS watermarks (
  module     TEXT PRIMARY KEY,
  cursor     TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS run_log (
  id          INTEGER PRIMARY KEY,
  module      TEXT,
  started_at  TEXT,
  finished_at TEXT,
  status      TEXT,
  detail      TEXT
);
CREATE INDEX IF NOT EXISTS idx_runlog_module ON run_log (module, id);
`;

let db = null;

/** Open (once) and return the WAL-mode SQLite handle, ensuring the schema exists. */
function getDb() {
  if (db) return db;
  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000'); // tolerate Pulse writing concurrently
  db.exec(SCHEMA_SQL);
  return db;
}

/** Close the handle (used on shutdown). */
function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb, SCHEMA_SQL };

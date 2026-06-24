'use strict';

/*
  Watermark helper — one cursor per module, for idempotency. A cursor is an opaque
  string the module interprets (an ISO timestamp, a last-seen id, a JSON blob...).
*/

const { getDb } = require('./db');

/** Read a module's cursor, or null if never set. */
function getWatermark(module) {
  const row = getDb()
    .prepare('SELECT cursor FROM watermarks WHERE module = ?')
    .get(module);
  return row ? row.cursor : null;
}

/** Upsert a module's cursor with the current timestamp. */
function setWatermark(module, cursor) {
  getDb()
    .prepare(
      `INSERT INTO watermarks (module, cursor, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(module) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at`
    )
    .run(module, cursor == null ? null : String(cursor), new Date().toISOString());
}

/** Read the updated_at timestamp for a module's watermark (ISO string or null). */
function getWatermarkUpdatedAt(module) {
  const row = getDb()
    .prepare('SELECT updated_at FROM watermarks WHERE module = ?')
    .get(module);
  return row ? row.updated_at : null;
}

module.exports = { getWatermark, setWatermark, getWatermarkUpdatedAt };

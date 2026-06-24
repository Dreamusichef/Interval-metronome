'use strict';

/*
  run_log helper — one row per module run, for debugging. Stays local (never
  promoted to the cockpit). Also prunes old rows so the table can't grow forever.
*/

const { getDb } = require('./db');

/** Open a run_log row; returns its id. */
function startRun(module) {
  const info = getDb()
    .prepare(
      `INSERT INTO run_log (module, started_at, status) VALUES (?, ?, 'running')`
    )
    .run(module, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

/** Close a run_log row with a final status ('ok' | 'error' | 'skipped') and detail. */
function finishRun(id, status, detail) {
  let detailStr = detail;
  if (detail && typeof detail === 'object') {
    try {
      detailStr = JSON.stringify(detail);
    } catch {
      detailStr = String(detail);
    }
  }
  getDb()
    .prepare(
      `UPDATE run_log SET finished_at = ?, status = ?, detail = ? WHERE id = ?`
    )
    .run(new Date().toISOString(), status, detailStr == null ? null : String(detailStr), id);
}

/** Prune run_log rows older than keepDays (default 30). */
function pruneRunLog(keepDays = 30) {
  const cutoff = new Date(Date.now() - keepDays * 86400000).toISOString();
  const info = getDb()
    .prepare(`DELETE FROM run_log WHERE started_at < ?`)
    .run(cutoff);
  return info.changes;
}

module.exports = { startRun, finishRun, pruneRunLog };

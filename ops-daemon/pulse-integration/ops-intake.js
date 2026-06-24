'use strict';

/*
  Pulse Bot → Ops Daemon handoff (§9 of the build spec).

  This file is the ONE minimal, isolated addition to the existing Pulse Bot repo
  (github.com/Dreamusichef/aodhq-dojo-dashboard). It is NOT part of the daemon process.
  Drop it in at /opt/dojo-pulse/lib/ops-intake.js and call runOpsIntake() once during
  Pulse's EXISTING nightly window — see pulse-integration/README.md.

  What it does: using Pulse's existing lib/discord-fetch (raw REST, 429-aware — passed
  in as `fetchChannelMessages`), fetch new messages from the DISCUSSION channels
  (#lounge, #qwei, #tech, #starting-bpms — NOT #practice-videos, which is clips) since a
  stored per-channel cursor, and INSERT them into /opt/ops-daemon/ops.db (discord_intake)
  via better-sqlite3 in WAL mode. The daemon reads this handoff; it never touches Discord.

  Isolation (hard requirement): own module file, own flag (OPS_INTAKE_ENABLED), own
  try/catch. If it errors, the rest of Pulse (clip/rank/streak crons) is unaffected — the
  caller wraps this and swallows its failures. No second Discord connection is introduced;
  this consumes Pulse's existing one via the injected fetcher.

  Raw author handles are fine HERE (ops.db is VPS-local + gitignored). They never leave
  the VPS: the daemon's Pain-Point Miner hashes the author before anything reaches the
  cockpit.
*/

const Database = require('better-sqlite3');

// Discussion channels only. #practice-videos is deliberately excluded (it carries clips,
// which Pulse already tracks — not discussion).
const DISCUSSION_CHANNEL_NAMES = ['lounge', 'qwei', 'tech', 'starting-bpms'];

// Minimal schema, mirrored from the daemon, so intake works even if the daemon hasn't
// created ops.db yet. CREATE IF NOT EXISTS is safe to run alongside the daemon.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS discord_intake (
  id        INTEGER PRIMARY KEY,
  channel   TEXT,
  author    TEXT,
  content   TEXT,
  ts        TEXT,
  processed INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS watermarks (
  module     TEXT PRIMARY KEY,
  cursor     TEXT,
  updated_at TEXT
);
`;

function envEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.OPS_INTAKE_ENABLED || ''));
}

// Parse OPS_INTAKE_CHANNELS="id1:lounge,id2:qwei,..." into [{id,name}].
function channelsFromEnv() {
  const raw = process.env.OPS_INTAKE_CHANNELS;
  if (!raw) return null;
  const out = [];
  for (const pair of raw.split(',')) {
    const [id, name] = pair.split(':').map((s) => (s || '').trim());
    if (id) out.push({ id, name: name || id });
  }
  return out.length ? out : null;
}

// Snowflake-safe "max id" (Discord ids are 64-bit; compare as BigInt, not Number).
function maxId(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  try {
    return BigInt(a) >= BigInt(b) ? String(a) : String(b);
  } catch {
    return String(a) >= String(b) ? String(a) : String(b);
  }
}

/**
 * Run the nightly intake. Resolves with a small summary; never throws for per-channel
 * errors (it logs and continues). The CALLER should still wrap it in try/catch.
 *
 * @param {object} opts
 * @param {boolean} [opts.enabled]            defaults to OPS_INTAKE_ENABLED env
 * @param {string}  [opts.opsDbPath]          defaults to OPS_DB_PATH env or /opt/ops-daemon/ops.db
 * @param {Array<{id:string,name?:string}>} [opts.channels]  defaults to OPS_INTAKE_CHANNELS env
 * @param {(channelId:string, afterId:string|null) => Promise<Array<{id:string,author:string,content:string,ts?:string}>>} opts.fetchChannelMessages
 *        REQUIRED. Adapter over Pulse's lib/discord-fetch. Returns messages newer than
 *        afterId (the caller paginates internally if needed).
 * @param {{info?:Function, warn?:Function, error?:Function}} [opts.logger]
 * @returns {Promise<{enabled:boolean, inserted:number, perChannel:object}>}
 */
async function runOpsIntake(opts = {}) {
  const log = opts.logger || console;
  const info = log.info || log.log || (() => {});
  const warn = log.warn || log.log || (() => {});
  const error = log.error || log.log || (() => {});

  const enabled = opts.enabled != null ? opts.enabled : envEnabled();
  if (!enabled) {
    info('[ops-intake] disabled (OPS_INTAKE_ENABLED not set) — skipping');
    return { enabled: false, inserted: 0, perChannel: {} };
  }

  const fetchChannelMessages = opts.fetchChannelMessages;
  if (typeof fetchChannelMessages !== 'function') {
    throw new Error(
      '[ops-intake] fetchChannelMessages is required — wire it to Pulse lib/discord-fetch (see pulse-integration/README.md)'
    );
  }

  const channels = opts.channels || channelsFromEnv();
  if (!channels || channels.length === 0) {
    throw new Error('[ops-intake] no channels configured (set OPS_INTAKE_CHANNELS or pass opts.channels)');
  }

  const opsDbPath = opts.opsDbPath || process.env.OPS_DB_PATH || '/opt/ops-daemon/ops.db';
  const db = new Database(opsDbPath);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.exec(SCHEMA_SQL);

    const getCursor = db.prepare('SELECT cursor FROM watermarks WHERE module = ?');
    const setCursor = db.prepare(
      `INSERT INTO watermarks (module, cursor, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(module) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at`
    );
    const insertMsg = db.prepare(
      'INSERT INTO discord_intake (channel, author, content, ts, processed) VALUES (?, ?, ?, ?, 0)'
    );

    let totalInserted = 0;
    const perChannel = {};

    for (const ch of channels) {
      const wmKey = `pulse_intake:${ch.id}`;
      try {
        const row = getCursor.get(wmKey);
        const afterId = row ? row.cursor : null;

        const messages = (await fetchChannelMessages(ch.id, afterId)) || [];

        // The transaction returns its own counts; we only fold them into the totals
        // AFTER a successful commit, so a rolled-back batch can't inflate the summary.
        const insertBatch = db.transaction((msgs) => {
          let inserted = 0;
          let newest = afterId;
          for (const m of msgs) {
            if (!m || m.id == null) continue;
            // Skip anything not strictly newer than the cursor (defensive against
            // adapters that include the boundary message).
            if (afterId != null) {
              try {
                if (BigInt(m.id) <= BigInt(afterId)) continue;
              } catch {
                /* fall through and insert */
              }
            }
            insertMsg.run(
              ch.name || ch.id,
              m.author == null ? null : String(m.author),
              m.content == null ? '' : String(m.content),
              m.ts || null
            );
            newest = maxId(newest, m.id);
            inserted += 1;
          }
          return { inserted, newest };
        });

        const { inserted, newest } = insertBatch(messages);
        if (inserted > 0) {
          totalInserted += inserted;
          perChannel[ch.name || ch.id] = (perChannel[ch.name || ch.id] || 0) + inserted;
        }
        if (newest && newest !== afterId) {
          setCursor.run(wmKey, String(newest), new Date().toISOString());
        }
      } catch (err) {
        // Per-channel isolation — a bad channel can't sink the rest of the intake.
        warn(`[ops-intake] channel ${ch.name || ch.id} failed: ${String((err && err.message) || err)}`);
      }
    }

    info(`[ops-intake] inserted ${totalInserted} message(s)`, perChannel);
    return { enabled: true, inserted: totalInserted, perChannel };
  } finally {
    db.close();
  }
}

module.exports = { runOpsIntake, DISCUSSION_CHANNEL_NAMES, SCHEMA_SQL };

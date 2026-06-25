'use strict';

/*
  Local cockpit stub — a faithful in-process mirror of the Arcane Sanctum integration
  boundary (§4 of the build spec), for end-to-end verification BEFORE the real Lovable
  endpoints exist (and to re-verify against them once live).

  It implements the same contract the Lovable endpoints must:
    POST /daemon-ingest  — checks x-daemon-key == apiKey; validates body; WHITELISTS the
                           table to the six allowed names; upserts (pain_points by label,
                           daily_brief by brief_date; others append).
    GET  /daemon-read    — checks x-daemon-key; returns the seeded {snapshot, apprenticesDue,
                           staleQuests} bundle.
    POST /webhook        — Discord webhook sink; records the posted body.

  Pure Node http, no deps. Run standalone (`node tools/stub-cockpit.js`) or embed in a
  test via startStub().
*/

const http = require('http');

const INGEST_TABLES = new Set([
  'pain_points',
  'email_health',
  'money_alerts',
  'funnel_pulse',
  'review_alerts',
  'daily_brief',
]);

// Upsert conflict targets — must match what the Lovable /daemon-ingest enforces.
const CONFLICT_KEY = { pain_points: 'label', daily_brief: 'brief_date' };

function defaultBundle() {
  return {
    snapshot: {
      asOf: new Date().toISOString(),
      refunds: { amount: 40, trailingWeeklyAvgAmount: 35 },
      payments: { failed: 0, disputed: 0 },
      revenue: { weekToDateAmount: 1200, trailingWeeklyAvgAmount: 1150 },
      launch: { label: 'Art of Double Bass 3.0', value: 0 },
    },
    apprenticesDue: [],
    staleQuests: [],
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Start the stub on an ephemeral port.
 * @param {object} [opts]
 * @param {string} [opts.apiKey='test-daemon-key']
 * @param {object} [opts.bundle]  the /daemon-read response
 * @returns {Promise<{ baseUrl, ingestUrl, readUrl, webhookUrl, apiKey, state, setBundle, close }>}
 */
function startStub(opts = {}) {
  const apiKey = opts.apiKey || 'test-daemon-key';
  const state = {
    ingested: {}, // table -> rows[]
    posts: [], // webhook bodies
    reads: 0,
    rejected: [], // {reason, table}
    bundle: opts.bundle || defaultBundle(),
    dojo: opts.dojo || { ninjas: 800, activeNinjas: 300, totalClips: 8200 },
    failOnce: new Set(), // tables whose NEXT ingest should 500 (fault injection)
    failTables: new Set(), // tables whose ingest should 500 until cleared (outage sim)
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(obj == null ? '' : JSON.stringify(obj));
    };

    try {
      if (req.method === 'POST' && path === '/webhook') {
        const body = await readBody(req);
        state.posts.push(safeJson(body));
        return send(204, null); // Discord returns 204 on success
      }

      // Stand-in for the Dojo public JSON feed (no auth — it's public).
      if (req.method === 'GET' && path === '/dojo') {
        return send(200, state.dojo);
      }

      const key = req.headers['x-daemon-key'];
      if (path === '/daemon-ingest' || path === '/daemon-read') {
        if (key !== apiKey) {
          state.rejected.push({ reason: 'bad-key', path });
          return send(401, { error: 'unauthorized' });
        }
      }

      if (req.method === 'GET' && path === '/daemon-read') {
        state.reads += 1;
        return send(200, state.bundle);
      }

      if (req.method === 'POST' && path === '/daemon-ingest') {
        const body = safeJson(await readBody(req));
        if (!body || typeof body.table !== 'string' || !Array.isArray(body.rows)) {
          return send(400, { error: 'bad body' });
        }
        if (!INGEST_TABLES.has(body.table)) {
          state.rejected.push({ reason: 'bad-table', table: body.table });
          return send(400, { error: `table not allowed: ${body.table}` });
        }
        if (state.failTables.has(body.table)) {
          return send(500, { error: 'injected outage' });
        }
        if (state.failOnce.has(body.table)) {
          state.failOnce.delete(body.table);
          return send(500, { error: 'injected failure' });
        }
        upsert(state, body.table, body.rows);
        return send(200, { ok: true, count: body.rows.length });
      }

      return send(404, { error: 'not found' });
    } catch (err) {
      return send(500, { error: String((err && err.message) || err) });
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        baseUrl,
        ingestUrl: `${baseUrl}/daemon-ingest`,
        readUrl: `${baseUrl}/daemon-read`,
        webhookUrl: `${baseUrl}/webhook`,
        apiKey,
        state,
        dojoUrl: `${baseUrl}/dojo`,
        setBundle: (b) => {
          state.bundle = b;
        },
        setDojo: (d) => {
          state.dojo = d;
        },
        failIngestOnce: (table) => state.failOnce.add(table),
        failIngest: (table) => state.failTables.add(table),
        clearIngestFail: (table) => state.failTables.delete(table),
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function upsert(state, table, rows) {
  const list = state.ingested[table] || (state.ingested[table] = []);
  const keyField = CONFLICT_KEY[table];
  for (const row of rows) {
    if (keyField && row[keyField] != null) {
      const i = list.findIndex((r) => r[keyField] === row[keyField]);
      if (i >= 0) {
        list[i] = row; // upsert: replace on conflict key
        continue;
      }
    }
    list.push(row);
  }
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// Standalone: `node tools/stub-cockpit.js` prints its URLs and stays up.
if (require.main === module) {
  startStub({ apiKey: process.env.DAEMON_API_KEY || 'test-daemon-key' }).then((stub) => {
    /* eslint-disable no-console */
    console.log('Cockpit stub up:');
    console.log('  ARCANE_INGEST_URL=' + stub.ingestUrl);
    console.log('  ARCANE_READ_URL=' + stub.readUrl);
    console.log('  DISCORD_BRIEF_WEBHOOK_URL=' + stub.webhookUrl);
    console.log('  DAEMON_API_KEY=' + stub.apiKey);
    console.log('Ingested rows + webhook posts are held in memory. Ctrl-C to stop.');
  });
}

module.exports = { startStub, INGEST_TABLES, CONFLICT_KEY, defaultBundle };

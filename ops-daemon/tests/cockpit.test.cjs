'use strict';

// Keep this in the no-native-deps unit tier: ensure the client is "not configured"
// and never loads a stray .env.
process.env.OPS_ENV_FILE = '/nonexistent/ops.env';
delete process.env.ARCANE_INGEST_URL;
delete process.env.ARCANE_READ_URL;
delete process.env.DAEMON_API_KEY;

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const cockpit = require('../src/lib/cockpit');

describe('cockpit client — guards', () => {
  test('rejects an unknown table client-side (whitelist, before any network)', async () => {
    await assert.rejects(() => cockpit.ingest('evil_table', [{ x: 1 }]), /refusing unknown table/);
  });

  test('empty rows is a no-op (no request)', async () => {
    const r = await cockpit.ingest('money_alerts', []);
    assert.deepEqual(r, { ok: true, count: 0 });
  });

  test('ingest throws when endpoints are not configured', async () => {
    await assert.rejects(() => cockpit.ingest('money_alerts', [{ x: 1 }]), /not configured/);
  });

  test('read throws when endpoints are not configured', async () => {
    await assert.rejects(() => cockpit.read(), /not configured/);
  });

  test('exposes exactly the six-table whitelist', () => {
    const six = ['pain_points', 'email_health', 'money_alerts', 'funnel_pulse', 'review_alerts', 'daily_brief'];
    assert.equal(cockpit.INGEST_TABLES.size, 6);
    for (const t of six) assert.ok(cockpit.INGEST_TABLES.has(t), `whitelist has ${t}`);
  });
});

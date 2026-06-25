'use strict';

/*
  Auth boundary: prove the x-daemon-key is actually enforced end-to-end (a wrong key is
  rejected and nothing lands in the cockpit), and that the stub enforces the documented
  contract (bad table → 400, missing key → 401) the real Lovable endpoint must.
*/

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeHarness } = require('./_harness.cjs');

describe('cockpit auth + contract', () => {
  let h;
  before(async () => {
    // Daemon is given the WRONG key; the stub expects 'test-daemon-key'.
    h = await makeHarness({ MODULE_MONEY_ENABLED: 'true', DAEMON_API_KEY: 'wrong-key' });
    h.stub.setBundle({
      snapshot: { payments: { failed: 1, disputed: 1 } },
      apprenticesDue: [],
      staleQuests: [],
    });
  });
  after(async () => h && h.cleanup());

  test('a wrong x-daemon-key is rejected; nothing reaches the cockpit', async () => {
    await h.runDailyCycle();

    const rejected = h.stub.state.rejected;
    assert.ok(rejected.some((r) => r.reason === 'bad-key' && r.path === '/daemon-read'), 'read rejected');
    assert.ok(rejected.some((r) => r.reason === 'bad-key' && r.path === '/daemon-ingest'), 'ingest rejected');

    assert.equal(h.rows('daily_brief').length, 0, 'no brief row landed');
    assert.equal(h.rows('money_alerts').length, 0, 'no money rows landed');
  });

  test('stub enforces the contract: bad table → 400, missing key → 401, valid → 200', async () => {
    const post = (headers, body) =>
      fetch(h.stub.ingestUrl, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

    const good = { 'x-daemon-key': 'test-daemon-key' };

    let r = await post({}, { table: 'money_alerts', op: 'upsert', rows: [{ x: 1 }] });
    assert.equal(r.status, 401, 'missing key → 401');

    r = await post(good, { table: 'not_allowed', op: 'upsert', rows: [{ x: 1 }] });
    assert.equal(r.status, 400, 'bad table → 400');

    r = await post(good, { table: 'money_alerts', op: 'upsert', rows: [{ x: 1 }] });
    assert.equal(r.status, 200, 'valid → 200');
  });
});

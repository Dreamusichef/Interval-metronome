'use strict';

/*
  Pain-Point Miner end-to-end against the cockpit stub, with an INJECTED Haiku (no real
  API call). Verifies: classify → canonical bucket, the dedup match-or-new pass, PII-free
  promotion (hashed authors, verbatim quotes), intake marked processed, and crash-replay
  determinism (a failed cockpit ingest does not double-count on retry).
*/

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeHarness, seedIntake } = require('./_harness.cjs');

function cannedHaiku(classify, dedup) {
  return async (requests) => {
    const out = new Map();
    for (const req of requests) {
      const id = req.custom_id;
      const content = req.params.messages[0].content;
      if (id.startsWith('c:')) out.set(id, { ok: true, text: JSON.stringify(classify(content)) });
      else if (id.startsWith('d:')) out.set(id, { ok: true, text: JSON.stringify(dedup(content)) });
    }
    return out;
  };
}

const STRUGGLE = (label) => ({ is_struggle: true, category: 'speed_bpm_ceiling', label, intensity: 3 });
const NOT = () => ({ is_struggle: false });

describe('pain-point miner → cockpit stub', () => {
  let h, painMiner;
  const processed = (id) => h.db.getDb().prepare('SELECT processed FROM discord_intake WHERE id = ?').get(id).processed;
  const bucket = () => h.rows('pain_points')[0];

  before(async () => {
    h = await makeHarness({ MODULE_PAINPOINTS_ENABLED: 'true' });
    painMiner = require('../../src/modules/painpoint-miner');
  });
  after(async () => h && h.cleanup());

  test('classify → one canonical bucket; PII-free; intake processed', async () => {
    h.haiku.runBatch = cannedHaiku(
      (c) => (c.includes('STRUGGLE') ? STRUGGLE('double bass plateau') : NOT()),
      () => ({ match: '' })
    );
    const ids = seedIntake(h.db, [
      { author: 'alice#1', content: 'STRUGGLE cant get past 180bpm' },
      { author: 'bob#2', content: 'STRUGGLE stuck at 190 for weeks' },
      { author: 'carol#3', content: 'nice weather today' },
    ]);

    await painMiner.run();

    assert.equal(h.rows('pain_points').length, 1, 'one canonical bucket');
    const b = bucket();
    assert.equal(b.label, 'double bass plateau');
    assert.equal(b.frequency, 2, 'two struggle messages counted');
    assert.equal(b.source_hashes.length, 2, 'two distinct author hashes');
    // PII-free: hashes only, no raw handle anywhere in the promoted row.
    assert.ok(b.source_hashes.every((x) => /^h:[0-9a-f]{32}$/.test(x)));
    const blob = JSON.stringify(b);
    assert.ok(!blob.includes('alice') && !blob.includes('bob') && !blob.includes('carol'), 'no raw handles leak');
    // Verbatim quotes are the raw messages, stored exactly.
    assert.ok(b.example_quotes.includes('STRUGGLE cant get past 180bpm'));
    // All three considered rows marked processed.
    for (const id of ids) assert.equal(processed(id), 1);
  });

  test('dedup match folds a differently-worded struggle into the existing bucket', async () => {
    h.haiku.runBatch = cannedHaiku(
      () => STRUGGLE('speed ceiling at 200'), // different label → triggers fuzzy match
      () => ({ match: 'double bass plateau' }) // matches the existing canonical label
    );
    const [id] = seedIntake(h.db, [{ author: 'dave#4', content: 'STRUGGLE2 cannot break 200' }]);

    await painMiner.run();

    assert.equal(h.rows('pain_points').length, 1, 'still one bucket (merged, not new)');
    assert.equal(bucket().frequency, 3);
    assert.equal(bucket().source_hashes.length, 3);
    assert.equal(processed(id), 1);
  });

  test('crash-replay: a failed cockpit ingest does not double-count on retry', async () => {
    h.haiku.runBatch = cannedHaiku(() => STRUGGLE('double bass plateau'), () => ({ match: '' }));
    const [id] = seedIntake(h.db, [{ author: 'erin#5', content: 'STRUGGLE still 195' }]);

    // Cockpit outage: ingest fails every attempt → run() throws, nothing committed.
    h.stub.failIngest('pain_points');
    await assert.rejects(() => painMiner.run());
    assert.equal(processed(id), 0, 'intake left unprocessed for replay');
    assert.equal(bucket().frequency, 3, 'failed ingest did not advance the bucket');

    // Recover: replays from the same persisted mirror + unprocessed intake → freq 4, not 5.
    h.stub.clearIngestFail('pain_points');
    await painMiner.run();
    assert.equal(bucket().frequency, 4, 'deterministic replay — counted exactly once');
    assert.equal(processed(id), 1);
  });
});

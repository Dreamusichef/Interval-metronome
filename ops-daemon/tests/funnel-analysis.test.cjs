'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { dojoPulse, crossedMilestone } = require('../src/domain/funnel-analysis');

describe('funnel-analysis — dojo', () => {
  test('baseline run writes a row but no signal', () => {
    const { row, signal } = dojoPulse({ ninjas: 100, activeNinjas: 40, totalClips: 8200 }, null);
    assert.equal(row.source, 'dojo');
    assert.equal(row.needs_attention, false);
    assert.equal(signal, null);
    assert.equal(row.metrics.nextClipMilestone, 9000);
    assert.equal(row.metrics.clipsToNextMilestone, 800);
  });

  test('ninja growth past threshold fires a signal', () => {
    const { row, signal } = dojoPulse(
      { ninjas: 110, activeNinjas: 40, totalClips: 8200 },
      { ninjas: 100, activeNinjas: 38, totalClips: 8100 }
    );
    assert.equal(row.needs_attention, true);
    assert.ok(signal);
    assert.match(signal.title, /\+10 ninjas/);
  });

  test('crossing a 1000-clip milestone fires a signal', () => {
    const { row } = dojoPulse(
      { ninjas: 101, activeNinjas: 40, totalClips: 9010 },
      { ninjas: 100, activeNinjas: 40, totalClips: 8990 }
    );
    assert.equal(row.needs_attention, true);
    assert.match(row.delta_note, /crossed 9000 clips/);
  });

  test('small movement below threshold: row but no signal', () => {
    const { row, signal } = dojoPulse(
      { ninjas: 102, activeNinjas: 40, totalClips: 8210 },
      { ninjas: 100, activeNinjas: 40, totalClips: 8200 }
    );
    assert.equal(row.needs_attention, false);
    assert.equal(signal, null);
  });
});

describe('funnel-analysis — crossedMilestone helper', () => {
  test('returns the first crossed milestone, else null', () => {
    assert.equal(crossedMilestone(98, 105, [100, 250]), 100);
    assert.equal(crossedMilestone(120, 130, [100, 250]), null);
    assert.equal(crossedMilestone(null, 130, [100, 250]), null);
  });
});

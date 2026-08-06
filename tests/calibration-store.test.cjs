'use strict';

const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const CalibrationStore = require('../core/js/calibration-store.js');

function mockStorage() {
  const data = {};
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v) { data[k] = String(v); },
    _data: data,
  };
}

const SAMPLE_CAL = {
  meanOffset: 18.5,
  sd: 4.2,
  sampleCount: 32,
  grossOffset: 18.5,
  drift: 0,
  refined: false,
};

describe('CalibrationStore', () => {
  let storage;

  beforeEach(() => {
    storage = mockStorage();
  });

  test('save and get by device id', () => {
    CalibrationStore.save('id-a', 'Roland TD-17', SAMPLE_CAL, storage);
    const entry = CalibrationStore.get('id-a', 'Roland TD-17', storage);
    assert.ok(entry);
    assert.equal(entry.deviceId, 'id-a');
    assert.equal(entry.deviceName, 'Roland TD-17');
    assert.equal(entry.calibration.meanOffset, 18.5);
    assert.ok(entry.updatedAt);
  });

  test('get falls back to device name when id changes', () => {
    CalibrationStore.save('old-id', 'Alesis Nitro', SAMPLE_CAL, storage);
    const entry = CalibrationStore.get('new-id', 'Alesis Nitro', storage);
    assert.ok(entry);
    assert.equal(entry.deviceName, 'Alesis Nitro');
    assert.equal(entry.calibration.meanOffset, 18.5);
  });

  test('manual calibration is never saved', () => {
    CalibrationStore.save('id-a', 'Device', { ...SAMPLE_CAL, manual: true }, storage);
    assert.equal(CalibrationStore.get('id-a', 'Device', storage), null);
  });

  test('invalid JSON returns null on get', () => {
    storage.setItem(CalibrationStore.STORAGE_KEY, '{not json');
    assert.equal(CalibrationStore.get('id-a', 'Device', storage), null);
  });

  test('save overwrites prior entry for same device id', () => {
    CalibrationStore.save('id-a', 'Device', SAMPLE_CAL, storage);
    const updated = { ...SAMPLE_CAL, meanOffset: 22, refined: true };
    CalibrationStore.save('id-a', 'Device', updated, storage);
    const entry = CalibrationStore.get('id-a', 'Device', storage);
    assert.equal(entry.calibration.meanOffset, 22);
    assert.equal(entry.calibration.refined, true);
  });
});

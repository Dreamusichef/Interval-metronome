'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   CALIBRATION STORE — per-MIDI-device measured calibration in localStorage.
   Manual offsets are never persisted (session-only override in roguelite.js).
   ════════════════════════════════════════════════════════════════════════════ */

const STORAGE_KEY = 'gm_midi_calibration_v1';

function defaultStorage() {
  return (typeof localStorage !== 'undefined') ? localStorage : null;
}

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

function loadAll(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch (e) {
    return {};
  }
}

function writeAll(storage, map) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch (e) {}
}

function get(deviceId, deviceName, storage) {
  storage = storage || defaultStorage();
  if (!storage) return null;
  const map = loadAll(storage);
  if (deviceId && map[deviceId]) return map[deviceId];
  const norm = normalizeName(deviceName);
  if (!norm) return null;
  for (const entry of Object.values(map)) {
    if (entry && normalizeName(entry.deviceName) === norm) return entry;
  }
  return null;
}

function save(deviceId, deviceName, calibration, storage) {
  if (!deviceId || !calibration || calibration.manual) return;
  storage = storage || defaultStorage();
  if (!storage) return;
  const map = loadAll(storage);
  map[deviceId] = {
    deviceId,
    deviceName: deviceName || deviceId,
    updatedAt: new Date().toISOString(),
    calibration: { ...calibration },
  };
  writeAll(storage, map);
}

const CalibrationStore = { get, save, STORAGE_KEY };

if (typeof window !== 'undefined') window.CalibrationStore = CalibrationStore;
if (typeof module !== 'undefined' && module.exports) module.exports = CalibrationStore;

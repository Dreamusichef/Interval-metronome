'use strict';

// App shell: mounts SessionEngine + SessionControls, keeps stopwatch,
// keyboard shortcuts, and favourite-ramp sync (Cloud) in the product layer.

const ME = (typeof MetronomeEngine !== 'undefined') ? MetronomeEngine : null;
if (!ME) {
  const msg = 'MetronomeEngine failed to load — audio will not work.';
  console.error(msg);
  if (window.__showError) window.__showError(msg);
}

if (typeof SessionEngine === 'undefined' || typeof SessionControls === 'undefined') {
  const msg = 'SessionEngine / SessionControls failed to load.';
  console.error(msg);
  if (window.__showError) window.__showError(msg);
}

const mountRoot = document.querySelector('.metronome-section') ||
  document.querySelector('.app-container') ||
  document.body;

const controls = (typeof SessionControls !== 'undefined')
  ? SessionControls.mount(mountRoot, {
      layout: 'default',
      engine: typeof SessionEngine !== 'undefined' ? SessionEngine : null,
      metronome: ME,
    })
  : null;

// Roguelite + any legacy callers use window.AppRamp.
if (typeof SessionEngine !== 'undefined') {
  window.AppRamp = SessionEngine.publicApi;
}

const els = controls ? controls.els : {};
const setDisplayBpm = controls
  ? controls.setDisplayBpm.bind(controls)
  : (v) => ME?.setBpm(v);

// ── Stopwatch / Timer (product UI) ──────────────────────────────────────────
const stopwatchDisplay   = document.getElementById('stopwatchDisplay');
const stopwatchStartStop = document.getElementById('stopwatchStartStop');
const stopwatchReset     = document.getElementById('stopwatchReset');
const stopwatchToggle    = document.getElementById('stopwatchToggle');
const stopwatchBody      = document.getElementById('stopwatchBody');
const swModeBtns         = document.querySelectorAll('.sw-mode-btn');
const swTimerSet         = document.getElementById('swTimerSet');
const timerMinsInput     = document.getElementById('timerMins');
const timerSecsInput     = document.getElementById('timerSecs');

let swMode    = 'stopwatch';
let swSeconds = 0;
let swRunning = false;
let swTimer   = null;
const SW_MAX  = 3600;

function formatStopwatch(secs) {
  if (secs >= 3600) return '1:00:00';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function timerDurationSecs() {
  const m = Math.max(0, Math.min(60, parseInt(timerMinsInput?.value, 10) || 0));
  const s = Math.max(0, Math.min(59, parseInt(timerSecsInput?.value, 10) || 0));
  return Math.min(SW_MAX, m * 60 + s);
}

function swStopTicking() {
  clearInterval(swTimer);
  swTimer = null;
  swRunning = false;
  if (stopwatchStartStop) {
    stopwatchStartStop.textContent = 'START';
    stopwatchStartStop.classList.remove('running');
  }
}

function swResetDisplay() {
  swStopTicking();
  swSeconds = (swMode === 'timer') ? timerDurationSecs() : 0;
  if (stopwatchDisplay) stopwatchDisplay.textContent = formatStopwatch(swSeconds);
}

function setSwMode(mode) {
  swMode = (mode === 'timer') ? 'timer' : 'stopwatch';
  swModeBtns.forEach(b => b.classList.toggle('active', b.dataset.swmode === swMode));
  if (swTimerSet) swTimerSet.hidden = (swMode !== 'timer');
  swResetDisplay();
}

if (stopwatchToggle && stopwatchBody) {
  stopwatchToggle.addEventListener('change', () => {
    stopwatchBody.classList.toggle('visible', stopwatchToggle.checked);
  });
}

swModeBtns.forEach(b => b.addEventListener('click', () => setSwMode(b.dataset.swmode)));

[timerMinsInput, timerSecsInput].forEach(inp => inp && inp.addEventListener('change', () => {
  if (swMode === 'timer' && !swRunning) swResetDisplay();
}));

if (stopwatchStartStop) {
  stopwatchStartStop.addEventListener('click', () => {
    if (swRunning) { swStopTicking(); return; }

    if (swMode === 'timer') {
      if (swSeconds <= 0) swSeconds = timerDurationSecs();
      if (swSeconds <= 0) return;
    } else {
      if (swSeconds >= SW_MAX) return;
    }

    swRunning = true;
    stopwatchStartStop.textContent = 'STOP';
    stopwatchStartStop.classList.add('running');
    swTimer = setInterval(() => {
      if (swMode === 'timer') {
        swSeconds--;
        if (stopwatchDisplay) stopwatchDisplay.textContent = formatStopwatch(Math.max(0, swSeconds));
        if (swSeconds <= 0) {
          swStopTicking();
          if (stopwatchDisplay) stopwatchDisplay.classList.add('sw-done');
        }
      } else {
        swSeconds++;
        if (stopwatchDisplay) stopwatchDisplay.textContent = formatStopwatch(swSeconds);
        if (swSeconds >= SW_MAX) swStopTicking();
      }
    }, 1000);
  });
}

if (stopwatchReset) {
  stopwatchReset.addEventListener('click', () => {
    if (stopwatchDisplay) stopwatchDisplay.classList.remove('sw-done');
    swResetDisplay();
  });
}

const swLabel = stopwatchToggle && stopwatchToggle.closest
  ? stopwatchToggle.closest('.toggle-switch')
  : null;
if (swLabel) {
  swLabel.addEventListener('click', () => {
    setTimeout(() => {
      if (stopwatchBody && stopwatchToggle) {
        stopwatchBody.classList.toggle('visible', stopwatchToggle.checked);
      }
    }, 0);
  });
}

// ── Keyboard shortcuts ──────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const t = e.target;
  if (t && t.tagName === 'INPUT' && t.type === 'number') { e.preventDefault(); t.blur(); }
});

document.addEventListener('keydown', (e) => {
  if (window.__gameModeActive) return;
  const t = e.target;
  if (t && t.tagName === 'INPUT' && t.type === 'checkbox' && e.key === ' ') {
    e.preventDefault();
    t.blur();
  } else if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
    return;
  }
  const engine = window.SessionEngine;
  if (e.key === 'Alt') {
    if (!e.repeat && engine && engine.isRunning()) {
      e.preventDefault();
      if (els.pauseBtn) els.pauseBtn.click();
      else engine.togglePause();
    }
    return;
  }
  if (e.key === 'Control') {
    if (!e.repeat && controls) controls.cycleSubdivision();
    return;
  }
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const bpm = () => parseInt(els.bpmValue?.value, 10) || 120;
  const clamp = engine ? engine.clampBpm.bind(engine) : (v) => Math.max(20, Math.min(400, Math.round(v)));
  switch (e.key) {
    case ' ':
      e.preventDefault();
      if (els.startStopBtn) els.startStopBtn.click();
      break;
    case 'ArrowUp':    e.preventDefault(); setDisplayBpm(clamp(bpm() + 1)); break;
    case 'ArrowDown':  e.preventDefault(); setDisplayBpm(clamp(bpm() - 1)); break;
    case 'ArrowRight': e.preventDefault(); setDisplayBpm(clamp(bpm() + 5)); break;
    case 'ArrowLeft':  e.preventDefault(); setDisplayBpm(clamp(bpm() - 5)); break;
    case 's': case 'S':
      e.preventDefault();
      if (stopwatchStartStop) stopwatchStartStop.click();
      break;
  }
});

// ── Favourite ramps (localStorage + optional Cloud sync) ────────────────────
const RAMP_FAVS_KEY = 'gm_favramps';
const rampFavSelect = document.getElementById('rampFavSelect');
const rampFavSave   = document.getElementById('rampFavSave');
const rampFavDelete = document.getElementById('rampFavDelete');
const rampFavExportImport = document.getElementById('rampFavExportImport');
const rampFavSyncHint = document.getElementById('rampFavSyncHint');
const rampIoModal = document.getElementById('rampIoModal');
const rampIoClose = document.getElementById('rampIoClose');
const rampIoList = document.getElementById('rampIoList');
const rampIoEmpty = document.getElementById('rampIoEmpty');
const rampIoExportSelected = document.getElementById('rampIoExportSelected');
const rampIoExportAll = document.getElementById('rampIoExportAll');
const rampIoFileInput = document.getElementById('rampIoFileInput');
const rampIoStatus = document.getElementById('rampIoStatus');

function readRampFavs() {
  try { const a = JSON.parse(localStorage.getItem(RAMP_FAVS_KEY)); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}
function writeRampFavs(list) {
  try { localStorage.setItem(RAMP_FAVS_KEY, JSON.stringify(list)); } catch (e) {}
}

function normalizeRampPreset(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim();
  if (!name) return null;
  const num = (v, fallback) => {
    const n = typeof v === 'number' ? v : parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  };
  let countInBars = 1;
  if (typeof raw.countInBars === 'number') {
    countInBars = Math.max(0, Math.min(4, raw.countInBars));
  } else if (typeof raw.countIn === 'boolean') {
    countInBars = raw.countIn ? 1 : 0;
  }
  return {
    name,
    startBpm:     num(raw.startBpm, 80),
    numSets:      num(raw.numSets, 4),
    setMins:      num(raw.setMins, 2),
    setSecs:      num(raw.setSecs, 0),
    bpmIncrement: num(raw.bpmIncrement, 5),
    restMins:     num(raw.restMins, 0),
    restSecs:     num(raw.restSecs, 30),
    countInBars,
  };
}

function isCompleteRampPreset(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (!String(raw.name || '').trim()) return false;
  const keys = ['startBpm', 'numSets', 'setMins', 'setSecs', 'bpmIncrement', 'restMins', 'restSecs'];
  for (let i = 0; i < keys.length; i++) {
    const v = raw[keys[i]];
    const n = typeof v === 'number' ? v : parseInt(v, 10);
    if (!Number.isFinite(n)) return false;
  }
  return true;
}

function mergeRampLists(base, incoming, preferIncoming) {
  const out = (Array.isArray(base) ? base : []).map(normalizeRampPreset).filter(Boolean);
  (Array.isArray(incoming) ? incoming : []).forEach(raw => {
    const cfg = normalizeRampPreset(raw);
    if (!cfg) return;
    const idx = out.findIndex(f => f.name.toLowerCase() === cfg.name.toLowerCase());
    if (idx < 0) out.push(cfg);
    else if (preferIncoming) out[idx] = cfg;
  });
  return out;
}

function persistRampFavs(list, selectName) {
  writeRampFavs(list);
  renderRampFavs(selectName);
  pushRampFavsToCloud(list);
}

async function pushRampFavsToCloud(list) {
  const C = window.Cloud;
  if (!C || !C.currentUser || !C.currentUser() || !C.saveRampPresets) return;
  try {
    await C.saveRampPresets(list || readRampFavs());
    updateRampSyncHint(true);
  } catch (e) {
    console.warn('[ramp] saveRampPresets', e);
  }
}

async function syncRampFavsFromCloud() {
  const C = window.Cloud;
  if (!C || !C.currentUser || !C.currentUser() || !C.getRampPresets) return;
  try {
    const remote = await C.getRampPresets();
    if (!remote) return;
    const local = readRampFavs();
    const remoteList = Array.isArray(remote.presets) ? remote.presets : [];
    const merged = mergeRampLists(remoteList, local, true);
    writeRampFavs(merged);
    renderRampFavs();
    await C.saveRampPresets(merged);
    updateRampSyncHint(true);
  } catch (e) {
    console.warn('[ramp] syncRampFavsFromCloud', e);
  }
}

function updateRampSyncHint(signedIn) {
  if (!rampFavSyncHint) return;
  if (signedIn) {
    rampFavSyncHint.textContent = 'Synced to your account';
    rampFavSyncHint.classList.remove('is-cta');
    rampFavSyncHint.type = 'button';
  } else {
    rampFavSyncHint.textContent = 'Sign in to sync ramps across devices';
    rampFavSyncHint.classList.add('is-cta');
  }
}

function currentRampConfig() {
  if (controls && controls.readRampConfig) {
    const c = controls.readRampConfig();
    return {
      startBpm: c.startBpmRaw != null ? c.startBpmRaw : c.startBpm,
      numSets: c.numSets,
      setMins: c.setMins,
      setSecs: c.setSecs,
      bpmIncrement: c.bpmIncrement,
      restMins: c.restMins,
      restSecs: c.restSecs,
      countInBars: c.countInBars,
    };
  }
  return { startBpm: 80, numSets: 4, setMins: 2, setSecs: 0, bpmIncrement: 5, restMins: 0, restSecs: 30, countInBars: 1 };
}

function applyRampConfig(c) {
  if (controls && controls.applyRampConfig) controls.applyRampConfig(c);
}

function renderRampFavs(selectName) {
  if (!rampFavSelect) return;
  const list = readRampFavs();
  rampFavSelect.innerHTML = '<option value="">— Saved ramps —</option>';
  list.forEach((f, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = f.name;
    rampFavSelect.appendChild(o);
  });
  if (selectName != null) {
    const idx = list.findIndex(f => f.name === selectName);
    if (idx >= 0) rampFavSelect.value = String(idx);
  }
  if (rampIoModal && !rampIoModal.hidden) renderRampIoList();
}

function slugRampName(name) {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return s || 'ramp';
}

function downloadRampJson(ramps, filename) {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    ramps: (ramps || []).map(normalizeRampPreset).filter(Boolean),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setRampIoStatus(msg, isError) {
  if (!rampIoStatus) return;
  rampIoStatus.textContent = msg || '';
  rampIoStatus.classList.toggle('is-error', !!isError);
}

function renderRampIoList() {
  if (!rampIoList) return;
  const list = readRampFavs();
  rampIoList.innerHTML = '';
  if (rampIoEmpty) rampIoEmpty.hidden = list.length > 0;
  if (rampIoExportAll) rampIoExportAll.disabled = list.length === 0;
  list.forEach((f, i) => {
    const label = document.createElement('label');
    label.className = 'ramp-io-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = String(i);
    cb.addEventListener('change', updateRampIoExportSelectedState);
    const span = document.createElement('span');
    span.textContent = f.name;
    label.appendChild(cb);
    label.appendChild(span);
    rampIoList.appendChild(label);
  });
  updateRampIoExportSelectedState();
}

function updateRampIoExportSelectedState() {
  if (!rampIoExportSelected || !rampIoList) return;
  const n = rampIoList.querySelectorAll('input[type="checkbox"]:checked').length;
  rampIoExportSelected.disabled = n === 0;
}

function openRampIoModal() {
  if (!rampIoModal) return;
  setRampIoStatus('');
  renderRampIoList();
  rampIoModal.hidden = false;
}

function closeRampIoModal() {
  if (!rampIoModal) return;
  rampIoModal.hidden = true;
  setRampIoStatus('');
  if (rampIoFileInput) rampIoFileInput.value = '';
}

function parseRampImportFile(text) {
  let data;
  try { data = JSON.parse(text); }
  catch (e) { return { error: 'Invalid JSON file.' }; }
  let rawList = null;
  if (Array.isArray(data)) rawList = data;
  else if (data && typeof data === 'object' && Array.isArray(data.ramps)) rawList = data.ramps;
  else return { error: 'File must contain a ramps array.' };
  if (!rawList.length) return { error: 'No ramps found in file.' };
  const ramps = [];
  for (let i = 0; i < rawList.length; i++) {
    if (!isCompleteRampPreset(rawList[i])) {
      return { error: 'Corrupt or incomplete ramp at index ' + i + '.' };
    }
    const cfg = normalizeRampPreset(rawList[i]);
    if (!cfg) return { error: 'Corrupt or incomplete ramp at index ' + i + '.' };
    ramps.push(cfg);
  }
  return { ramps };
}

if (rampFavSelect) {
  rampFavSelect.addEventListener('change', () => {
    const idx = parseInt(rampFavSelect.value, 10);
    if (isNaN(idx)) return;
    applyRampConfig(readRampFavs()[idx]);
  });
}
if (rampFavSave) {
  rampFavSave.addEventListener('click', () => {
    const name = (prompt('Name this ramp:', '') || '').trim();
    if (!name) return;
    const list = readRampFavs();
    const cfg  = currentRampConfig();
    cfg.name = name;
    const existing = list.findIndex(f => f.name.toLowerCase() === name.toLowerCase());
    if (existing >= 0) list[existing] = cfg;
    else list.push(cfg);
    persistRampFavs(list, name);
  });
}
if (rampFavDelete) {
  rampFavDelete.addEventListener('click', () => {
    const idx = parseInt(rampFavSelect.value, 10);
    if (isNaN(idx)) return;
    const list = readRampFavs();
    const f = list[idx];
    if (!f) return;
    if (!confirm('Delete saved ramp "' + f.name + '"?')) return;
    list.splice(idx, 1);
    persistRampFavs(list);
  });
}

if (rampFavExportImport) {
  rampFavExportImport.addEventListener('click', openRampIoModal);
}
if (rampIoClose) {
  rampIoClose.addEventListener('click', closeRampIoModal);
}
if (rampIoModal) {
  rampIoModal.addEventListener('click', (e) => {
    if (e.target === rampIoModal) closeRampIoModal();
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && rampIoModal && !rampIoModal.hidden) {
    closeRampIoModal();
  }
});
if (rampIoExportSelected) {
  rampIoExportSelected.addEventListener('click', () => {
    const list = readRampFavs();
    const idxs = Array.from(rampIoList.querySelectorAll('input[type="checkbox"]:checked'))
      .map(cb => parseInt(cb.value, 10))
      .filter(i => !isNaN(i) && list[i]);
    const selected = idxs.map(i => list[i]);
    if (!selected.length) return;
    const filename = selected.length === 1
      ? 'interval-metronome-ramp-' + slugRampName(selected[0].name) + '.json'
      : 'interval-metronome-ramps.json';
    downloadRampJson(selected, filename);
    setRampIoStatus('Exported ' + selected.length + ' ramp' + (selected.length === 1 ? '' : 's') + '.');
  });
}
if (rampIoExportAll) {
  rampIoExportAll.addEventListener('click', () => {
    const list = readRampFavs();
    if (!list.length) return;
    downloadRampJson(list, 'interval-metronome-ramps.json');
    setRampIoStatus('Exported all ' + list.length + ' ramp' + (list.length === 1 ? '' : 's') + '.');
  });
}
if (rampIoFileInput) {
  rampIoFileInput.addEventListener('change', () => {
    const file = rampIoFileInput.files && rampIoFileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseRampImportFile(String(reader.result || ''));
      if (parsed.error) {
        setRampIoStatus(parsed.error, true);
        rampIoFileInput.value = '';
        return;
      }
      const merged = mergeRampLists(readRampFavs(), parsed.ramps, true);
      persistRampFavs(merged);
      renderRampIoList();
      setRampIoStatus('Imported ' + parsed.ramps.length + ' ramp' + (parsed.ramps.length === 1 ? '' : 's') + '.');
      rampIoFileInput.value = '';
    };
    reader.onerror = () => {
      setRampIoStatus('Could not read file.', true);
      rampIoFileInput.value = '';
    };
    reader.readAsText(file);
  });
}

if (rampFavSyncHint) {
  updateRampSyncHint(false);
  rampFavSyncHint.addEventListener('click', () => {
    if (!rampFavSyncHint.classList.contains('is-cta')) return;
    if (window.Cloud && window.Cloud.signIn) window.Cloud.signIn();
  });
}

(function wireRampCloudSync() {
  function tryWire() {
    if (!window.Cloud || !window.Cloud.onAuth) return false;
    window.Cloud.onAuth((user) => {
      if (user) {
        updateRampSyncHint(true);
        syncRampFavsFromCloud();
      } else {
        updateRampSyncHint(false);
      }
    });
    return true;
  }
  if (tryWire()) return;
  let tries = 0;
  const t = setInterval(() => {
    tries += 1;
    if (tryWire() || tries > 40) clearInterval(t);
  }, 100);
})();

renderRampFavs();

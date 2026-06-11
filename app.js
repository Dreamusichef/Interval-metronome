'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const bpmValue         = document.getElementById('bpmValue');
const bpmSlider        = document.getElementById('bpmSlider');
const startStopBtn     = document.getElementById('startStopBtn');
const tapBtn           = document.getElementById('tapBtn');
const soundModeBtn     = document.getElementById('soundModeBtn');
const beatCountDec     = document.getElementById('beatCountDec');
const beatCountInc     = document.getElementById('beatCountInc');
const beatCountDisplay = document.getElementById('beatCountDisplay');
const subBtns          = document.querySelectorAll('.sub-btn');
const bpmButtons       = document.querySelectorAll('.bpm-btn');
const intervalToggle   = document.getElementById('intervalToggle');
const intervalConfig   = document.getElementById('intervalConfig');
const intervalStatus   = document.getElementById('intervalStatus');
const numSetsInput     = document.getElementById('numSets');
const setMinsInput     = document.getElementById('setMins');
const setSecsInput     = document.getElementById('setSecs');
const startBpmInput    = document.getElementById('startBpm');
const bpmIncrInput     = document.getElementById('bpmIncrement');
const restMinsInput    = document.getElementById('restMins');
const restSecsInput    = document.getElementById('restSecs');
const statusPhase      = document.getElementById('statusPhase');
const statusSet        = document.getElementById('statusSet');
const statusBpm        = document.getElementById('statusBpm');
const statusCountdown  = document.getElementById('statusCountdown');
const progressBar      = document.getElementById('progressBar');
const statusNext       = document.getElementById('statusNext');
const doneOverlay      = document.getElementById('doneOverlay');
const doneSummary      = document.getElementById('doneSummary');
const doneBtn          = document.getElementById('doneBtn');
const stopwatchDisplay   = document.getElementById('stopwatchDisplay');
const stopwatchStartStop = document.getElementById('stopwatchStartStop');
const stopwatchReset     = document.getElementById('stopwatchReset');
const stopwatchToggle    = document.getElementById('stopwatchToggle');
const stopwatchBody      = document.getElementById('stopwatchBody');
const swModeBtns         = document.querySelectorAll('.sw-mode-btn');
const swTimerSet         = document.getElementById('swTimerSet');
const timerMinsInput     = document.getElementById('timerMins');
const timerSecsInput     = document.getElementById('timerSecs');
const pauseBtn           = document.getElementById('pauseBtn');

// Guard: if MetronomeEngine failed to load, show a recoverable error state
const ME = (typeof MetronomeEngine !== 'undefined') ? MetronomeEngine : null;
if (!ME) {
  const msg = 'MetronomeEngine failed to load — audio will not work.';
  console.error(msg);
  if (window.__showError) window.__showError(msg);
}

function safeHandler(label, fn) {
  return function(ev) {
    try { return fn.call(this, ev); }
    catch (e) {
      const msg = '[' + label + '] ' + (e && e.message ? e.message : String(e));
      console.error(msg, e);
      if (window.__showError) window.__showError(msg);
    }
  };
}

// ── State ─────────────────────────────────────────────────────────────────────
const States = { IDLE: 0, RUNNING_SET: 1, RESTING: 2, DONE: 3, COUNTING_IN: 4 };
let appState = States.IDLE;
let countdownTimer = null;
let countInTimer = null;

// Ramp "1-bar count-in" toggle (persisted). One bar of clicks plays before each
// set's timer starts, so you're ready. Skipped in Game Mode (it has its own count-in).
const countInToggle = document.getElementById('countInToggle');
if (countInToggle) {
  const saved = localStorage.getItem('gm_rampcountin');
  if (saved !== null) countInToggle.checked = (saved === '1');
  countInToggle.addEventListener('change', () => localStorage.setItem('gm_rampcountin', countInToggle.checked ? '1' : '0'));
}
function countInOn() { return !!(countInToggle && countInToggle.checked) && !window.__gameModeActive; }
function oneBarMs() { return Math.round(currentBeats * 60000 / clampBpm(session.currentBpm || 120)); }

// Begin a set: play a 1-bar count-in first (if enabled), then start the set timer.
function beginSet(isFirst) {
  if (countInOn()) {
    appState = States.COUNTING_IN;
    updateStatusDisplay();
    clearTimeout(countInTimer);
    countInTimer = setTimeout(() => startSetTiming(isFirst), oneBarMs());
  } else {
    startSetTiming(isFirst);
  }
}
function startSetTiming(isFirst) {
  appState = States.RUNNING_SET;
  updateStatusDisplay();
  // Roguelite hook: announce the live BPM so a run can gate hits / check the ceiling.
  document.dispatchEvent(new CustomEvent(isFirst ? 'ramp:start' : 'ramp:bpmchange', { detail: { bpm: session.currentBpm } }));
}
let isPaused = false;

const session = {
  totalSets: 0, setDurationSecs: 0, restDurationSecs: 0,
  startBpm: 0, bpmIncrement: 0, currentSet: 1,
  currentBpm: 0, timeRemaining: 0, totalDuration: 0,
};

// ── Stopwatch / Timer ───────────────────────────────────────────────────────
// Two modes share one display + START/RESET controls:
//   'stopwatch' counts UP from 0:00, capped at 60:00.
//   'timer'     counts DOWN from a user-set mm:ss (up to 60:00) and stops at 0.
let swMode    = 'stopwatch';   // 'stopwatch' | 'timer'
let swSeconds = 0;             // stopwatch: elapsed · timer: remaining
let swRunning = false;
let swTimer   = null;
const SW_MAX  = 3600;          // 60 minutes, the ceiling for both modes

function formatStopwatch(secs) {
  if (secs >= 3600) return '1:00:00';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Timer's configured duration (seconds), clamped to [0, 60:00].
function timerDurationSecs() {
  const m = Math.max(0, Math.min(60, parseInt(timerMinsInput?.value, 10) || 0));
  const s = Math.max(0, Math.min(59, parseInt(timerSecsInput?.value, 10) || 0));
  return Math.min(SW_MAX, m * 60 + s);
}

function swStopTicking() {
  clearInterval(swTimer);
  swTimer = null;
  swRunning = false;
  stopwatchStartStop.textContent = 'START';
  stopwatchStartStop.classList.remove('running');
}

// Reset the display to the mode's starting value (0:00 for stopwatch, the set
// duration for timer) and stop any run in progress.
function swResetDisplay() {
  swStopTicking();
  swSeconds = (swMode === 'timer') ? timerDurationSecs() : 0;
  stopwatchDisplay.textContent = formatStopwatch(swSeconds);
}

function setSwMode(mode) {
  swMode = (mode === 'timer') ? 'timer' : 'stopwatch';
  swModeBtns.forEach(b => b.classList.toggle('active', b.dataset.swmode === swMode));
  if (swTimerSet) swTimerSet.hidden = (swMode !== 'timer');
  swResetDisplay();
}

stopwatchToggle.addEventListener('change', () => {
  stopwatchBody.classList.toggle('visible', stopwatchToggle.checked);
});

swModeBtns.forEach(b => b.addEventListener('click', () => setSwMode(b.dataset.swmode)));

// Re-seed the timer display when the duration inputs change (only when idle, so a
// running countdown isn't disturbed).
[timerMinsInput, timerSecsInput].forEach(inp => inp && inp.addEventListener('change', () => {
  if (swMode === 'timer' && !swRunning) swResetDisplay();
}));

stopwatchStartStop.addEventListener('click', () => {
  if (swRunning) { swStopTicking(); return; }

  if (swMode === 'timer') {
    // Starting fresh (display at 0) re-arms from the configured duration.
    if (swSeconds <= 0) swSeconds = timerDurationSecs();
    if (swSeconds <= 0) return;                     // nothing to count down
  } else {
    if (swSeconds >= SW_MAX) return;                // stopwatch already maxed
  }

  swRunning = true;
  stopwatchStartStop.textContent = 'STOP';
  stopwatchStartStop.classList.add('running');
  swTimer = setInterval(() => {
    if (swMode === 'timer') {
      swSeconds--;
      stopwatchDisplay.textContent = formatStopwatch(Math.max(0, swSeconds));
      if (swSeconds <= 0) { swStopTicking(); stopwatchDisplay.classList.add('sw-done'); }
    } else {
      swSeconds++;
      stopwatchDisplay.textContent = formatStopwatch(swSeconds);
      if (swSeconds >= SW_MAX) swStopTicking();
    }
  }, 1000);
});

stopwatchReset.addEventListener('click', () => {
  stopwatchDisplay.classList.remove('sw-done');
  swResetDisplay();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function clampBpm(val) { return Math.max(20, Math.min(400, Math.round(val))); }

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function setDisplayBpm(val) {
  const clamped = clampBpm(val);
  bpmValue.value  = clamped;
  bpmSlider.value = clamped;
  ME?.setBpm(clamped);
}

function flashBeat(beatIndex, soundType) {
  const el = document.getElementById('beat' + beatIndex);
  if (!el || soundType === 'silent') return;
  el.classList.remove('flash-accent', 'flash-click');
  void el.offsetWidth;
  el.classList.add('flash-' + soundType);
  setTimeout(() => el.classList.remove('flash-accent', 'flash-click'), 90);
}

ME?.onBeat(flashBeat);

// ── Beat indicators ───────────────────────────────────────────────────────────
const MODE_CYCLE = ['accent', 'click', 'silent'];
let currentBeats = 4;

function renderBeatIndicators(count) {
  const container = document.getElementById('beatIndicators');
  if (!container) return;
  const modes = ME ? ME.getBeatModes() : Array(count).fill('click').fill('accent', 0, 1);
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const mode = modes[i] !== undefined ? modes[i] : (i === 0 ? 'accent' : 'click');
    const el   = document.createElement('div');
    el.className    = 'beat-indicator';
    el.id           = 'beat' + i;
    el.dataset.beat = i;
    el.dataset.mode = mode;
    el.innerHTML    = `<span class="beat-num">${i + 1}</span><span class="beat-pip"></span>`;
    el.addEventListener('click', () => {
      const next      = MODE_CYCLE[(MODE_CYCLE.indexOf(el.dataset.mode) + 1) % MODE_CYCLE.length];
      el.dataset.mode = next;
      ME?.setBeatMode(i, next);
    });
    container.appendChild(el);
  }
}

// ── Sound mode toggle ─────────────────────────────────────────────────────────
soundModeBtn.addEventListener('click', () => {
  const current = ME?.getSoundMode() ?? 'click';
  const next    = current === 'click' ? 'cowbell' : 'click';
  ME?.setSoundMode(next);
  soundModeBtn.textContent = next === 'cowbell' ? 'COWBELL' : 'CLICK';
  soundModeBtn.classList.toggle('cowbell', next === 'cowbell');
});

// ── Beat count ────────────────────────────────────────────────────────────────
beatCountDec.addEventListener('click', () => {
  if (currentBeats <= 1) return;
  currentBeats--;
  beatCountDisplay.textContent = currentBeats;
  ME?.setBeatsPerMeasure(currentBeats);
  renderBeatIndicators(currentBeats);
});

beatCountInc.addEventListener('click', () => {
  if (currentBeats >= 16) return;
  currentBeats++;
  beatCountDisplay.textContent = currentBeats;
  ME?.setBeatsPerMeasure(currentBeats);
  renderBeatIndicators(currentBeats);
});

renderBeatIndicators(4);

// ── Tap tempo ─────────────────────────────────────────────────────────────────
const tapTimes    = [];
const TAP_RESET_MS = 2500;
let tapResetTimer  = null;

tapBtn.addEventListener('click', () => {
  const now = Date.now();
  if (tapTimes.length > 0 && now - tapTimes[tapTimes.length - 1] > TAP_RESET_MS) tapTimes.length = 0;
  tapTimes.push(now);
  if (tapTimes.length >= 4) {
    let total = 0;
    for (let i = 1; i < tapTimes.length; i++) total += tapTimes[i] - tapTimes[i - 1];
    setDisplayBpm(clampBpm(Math.round(60000 / (total / (tapTimes.length - 1)))));
  }
  if (tapTimes.length > 8) tapTimes.shift();
  clearTimeout(tapResetTimer);
  tapResetTimer = setTimeout(() => { tapTimes.length = 0; }, TAP_RESET_MS);
});

// ── Metronome controls ────────────────────────────────────────────────────────
bpmSlider.addEventListener('input', () => setDisplayBpm(parseInt(bpmSlider.value, 10)));

bpmButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    setDisplayBpm(clampBpm(parseInt(bpmValue.value, 10) + parseInt(btn.dataset.delta, 10)));
  });
});

bpmValue.addEventListener('input', () => {
  const val = parseInt(bpmValue.value, 10);
  if (!isNaN(val)) {
    bpmSlider.value = Math.max(20, Math.min(400, val));
    ME?.setBpm(val);
  }
});

bpmValue.addEventListener('change', () => setDisplayBpm(parseInt(bpmValue.value, 10) || 120));
bpmValue.addEventListener('focus',  () => bpmValue.select());

subBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    subBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ME?.setSubdivision(btn.dataset.mode);
  });
});

// ── Keyboard shortcuts (metronome / ramp) ─────────────────────────────────────
//   Space  start / stop · Alt  pause / resume (ramp) · ↑/↓ ±1 BPM · ←/→ ±5 BPM ·
//   S  start / stop stopwatch / timer.
// Suppressed in Game Mode (roguelite handles its own keys) and while typing.

// Enter confirms (commits) any number field, so you don't need a mouse click —
// blur fires that field's existing 'change' handler. Runs even while focused in
// an input (the main shortcut handler below bails out on inputs, by design).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const t = e.target;
  if (t && t.tagName === 'INPUT' && t.type === 'number') { e.preventDefault(); t.blur(); }
});

document.addEventListener('keydown', (e) => {
  if (window.__gameModeActive) return;
  const t = e.target;
  // A focused toggle switch (checkbox) eats Space to flip itself by default,
  // which hijacks the Start/Stop shortcut. Block that default and blur it so
  // Space falls through to the switch below instead of toggling the switch.
  if (t && t.tagName === 'INPUT' && t.type === 'checkbox' && e.key === ' ') {
    e.preventDefault();
    t.blur();
  } else if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
    return;
  }
  if (e.key === 'Alt') {                       // pause / resume an active ramp session
    if (!e.repeat && appState !== States.IDLE) { e.preventDefault(); pauseBtn.click(); }
    return;
  }
  if (e.key === 'Control') {                    // Ctrl cycles the subdivision
    if (!e.repeat) {
      const btns = [...subBtns];
      const i = btns.findIndex(b => b.classList.contains('active'));
      const next = btns[(i + 1) % btns.length];
      next && next.click();
    }
    return;
  }
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const bpm = () => parseInt(bpmValue.value, 10) || 120;
  switch (e.key) {
    case ' ':          e.preventDefault(); startStopBtn.click(); break;
    case 'ArrowUp':    e.preventDefault(); setDisplayBpm(clampBpm(bpm() + 1)); break;
    case 'ArrowDown':  e.preventDefault(); setDisplayBpm(clampBpm(bpm() - 1)); break;
    case 'ArrowRight': e.preventDefault(); setDisplayBpm(clampBpm(bpm() + 5)); break;
    case 'ArrowLeft':  e.preventDefault(); setDisplayBpm(clampBpm(bpm() - 5)); break;
    case 's': case 'S': e.preventDefault(); stopwatchStartStop.click(); break;
  }
});

// ── Start / Stop ──────────────────────────────────────────────────────────────
startStopBtn.addEventListener('click', safeHandler('startStop', () => {
  if (appState !== States.IDLE) { stopAll(); return; }

  if (intervalToggle.checked) {
    startIntervalSession();
  } else {
    ME?.init();
    ME?.setBpm(clampBpm(parseInt(bpmValue.value, 10)));
    ME?.start();
    appState = States.RUNNING_SET;
    startStopBtn.textContent = 'STOP';
    startStopBtn.classList.add('running');
    setConfigDisabled(true);
  }
}));

function stopAll() {
  ME?.stop();
  clearInterval(countdownTimer);
  countdownTimer = null;
  clearTimeout(countInTimer);
  countInTimer = null;
  isPaused = false;
  appState = States.IDLE;
  startStopBtn.textContent = 'START';
  startStopBtn.classList.remove('running');
  pauseBtn.classList.remove('visible', 'resuming');
  intervalStatus.classList.remove('visible');
  setConfigDisabled(false);
  // Roguelite hook: the session stopped (manual STOP or programmatic abort).
  document.dispatchEvent(new CustomEvent('ramp:stop'));
}

// ── Pause / Resume (ramp sessions only) ───────────────────────────────────────
pauseBtn.addEventListener('click', safeHandler('pause', () => {
  if (appState === States.IDLE || appState === States.COUNTING_IN) return;

  if (isPaused) {
    isPaused = false;
    pauseBtn.textContent = 'PAUSE';
    pauseBtn.classList.remove('resuming');
    // During a set: restart the metronome at the current BPM
    if (appState === States.RUNNING_SET) {
      ME?.init();
      ME?.setBpm(session.currentBpm);
      ME?.start();
    }
    // Restart the countdown (works for both set and rest phases)
    countdownTimer = setInterval(countdownTick, 1000);
  } else {
    isPaused = true;
    pauseBtn.textContent = 'RESUME';
    pauseBtn.classList.add('resuming');
    ME?.stop();
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}));

// ── Ramp Mode toggle ──────────────────────────────────────────────────────────
function applyRampToggleState() {
  intervalConfig.classList.toggle('visible', intervalToggle.checked);
  // (Welcome greeting now fires when GAME MODE is toggled on — see roguelite.js.)
}
intervalToggle.addEventListener('change', safeHandler('rampChange', applyRampToggleState));
intervalToggle.addEventListener('input',  safeHandler('rampInput',  applyRampToggleState));

// Fallback for Android Chrome where label-wrapped checkbox change events can be flaky:
// listen to click on the parent .toggle-switch label directly.
const rampLabel = intervalToggle.closest('.toggle-switch');
if (rampLabel) {
  rampLabel.addEventListener('click', safeHandler('rampLabelClick', () => {
    // Defer to next tick so the native checkbox toggle (from the label) is reflected first.
    setTimeout(applyRampToggleState, 0);
  }));
}

// Same fallback for stopwatch toggle
const swLabel = stopwatchToggle.closest('.toggle-switch');
if (swLabel) {
  swLabel.addEventListener('click', safeHandler('swLabelClick', () => {
    setTimeout(() => {
      stopwatchBody.classList.toggle('visible', stopwatchToggle.checked);
    }, 0);
  }));
}

// ── Ramp Session ──────────────────────────────────────────────────────────────
function parseIntVal(el, fallback) {
  const v = parseInt(el.value, 10);
  return isNaN(v) ? fallback : v;
}

// ── Favourite ramps ───────────────────────────────────────────────────────────
// Save the current ramp config under a name and reload it later with one pick.
// Device-local (localStorage) — no sign-in needed. Saving a name that already
// exists overwrites it (that's how you "edit" a favourite).
const RAMP_FAVS_KEY = 'gm_favramps';
const rampFavSelect = document.getElementById('rampFavSelect');
const rampFavSave   = document.getElementById('rampFavSave');
const rampFavDelete = document.getElementById('rampFavDelete');

function readRampFavs() {
  try { const a = JSON.parse(localStorage.getItem(RAMP_FAVS_KEY)); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}
function writeRampFavs(list) {
  try { localStorage.setItem(RAMP_FAVS_KEY, JSON.stringify(list)); } catch (e) {}
}
function currentRampConfig() {
  return {
    startBpm:     parseIntVal(startBpmInput, 80),
    numSets:      parseIntVal(numSetsInput, 4),
    setMins:      parseIntVal(setMinsInput, 2),
    setSecs:      parseIntVal(setSecsInput, 0),
    bpmIncrement: parseIntVal(bpmIncrInput, 5),
    restMins:     parseIntVal(restMinsInput, 0),
    restSecs:     parseIntVal(restSecsInput, 30),
    countIn:      !!(countInToggle && countInToggle.checked),
  };
}
function applyRampConfig(c) {
  if (!c) return;
  startBpmInput.value = c.startBpm;
  numSetsInput.value  = c.numSets;
  setMinsInput.value  = c.setMins;
  setSecsInput.value  = c.setSecs;
  bpmIncrInput.value  = c.bpmIncrement;
  restMinsInput.value = c.restMins;
  restSecsInput.value = c.restSecs;
  if (countInToggle && typeof c.countIn === 'boolean') {
    countInToggle.checked = c.countIn;
    localStorage.setItem('gm_rampcountin', c.countIn ? '1' : '0');
  }
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
    if (existing >= 0) list[existing] = cfg;   // same name → edit in place
    else list.push(cfg);
    writeRampFavs(list);
    renderRampFavs(name);
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
    writeRampFavs(list);
    renderRampFavs();
  });
}
renderRampFavs();

function startIntervalSession() {
  const totalSets    = Math.max(1, parseIntVal(numSetsInput, 1));
  const setDuration  = Math.max(0, parseIntVal(setMinsInput, 0)) * 60 + Math.max(0, parseIntVal(setSecsInput, 0));
  const restDuration = Math.max(0, parseIntVal(restMinsInput, 0)) * 60 + Math.max(0, parseIntVal(restSecsInput, 0));
  const startBpm     = clampBpm(parseIntVal(startBpmInput, 80));
  const bpmIncrement = parseIntVal(bpmIncrInput, 0);

  if (setDuration === 0) { alert('Set duration must be greater than 0.'); return; }

  Object.assign(session, {
    totalSets, setDurationSecs: setDuration, restDurationSecs: restDuration,
    startBpm, bpmIncrement, currentSet: 1, currentBpm: startBpm,
    timeRemaining: setDuration, totalDuration: setDuration,
  });

  ME?.init();
  ME?.setBpm(startBpm);
  setDisplayBpm(startBpm);
  ME?.start();
  ME?.playSetStartCue();

  isPaused = false;
  startStopBtn.textContent = 'STOP';
  startStopBtn.classList.add('running');
  pauseBtn.textContent = 'PAUSE';
  pauseBtn.classList.add('visible');
  pauseBtn.classList.remove('resuming');
  setConfigDisabled(true);
  intervalStatus.classList.add('visible');
  countdownTimer = setInterval(countdownTick, 1000);
  beginSet(true);   // count-in (if enabled) → start the set timer + ramp:start
}

function countdownTick() {
  if (appState === States.COUNTING_IN) return;   // count-in bar: clicks only, no timer
  session.timeRemaining--;
  if (session.timeRemaining <= 0) {
    if (appState === States.RUNNING_SET) onSetComplete();
    else if (appState === States.RESTING) onRestComplete();
    return;
  }
  updateStatusDisplay();
}

function onSetComplete() {
  if (session.currentSet >= session.totalSets) { finishSession(); return; }
  ME?.playSetEndCue();
  if (session.restDurationSecs > 0) {
    ME?.stop();
    appState = States.RESTING;
    session.timeRemaining = session.restDurationSecs;
    session.totalDuration = session.restDurationSecs;
    updateStatusDisplay();
  } else {
    advanceToNextSet();
  }
}

function onRestComplete() { advanceToNextSet(); }

function advanceToNextSet() {
  session.currentSet++;
  session.currentBpm    = clampBpm(session.currentBpm + session.bpmIncrement);
  session.timeRemaining = session.setDurationSecs;
  session.totalDuration = session.setDurationSecs;
  ME?.setBpm(session.currentBpm);
  setDisplayBpm(session.currentBpm);
  if (!ME?.isRunning()) ME?.start();
  ME?.playSetStartCue();
  beginSet(false);   // count-in (if enabled) → start the set timer + ramp:bpmchange
}

function finishSession() {
  ME?.stop();
  // Roguelite suppresses the practice-complete cue during a game run — its own
  // result-screen sound system (GameSfx) plays the completion stinger instead.
  if (!window.__rogueSuppressCompleteCue) ME?.playPracticeCompleteCue();
  clearInterval(countdownTimer);
  countdownTimer = null;
  isPaused = false;
  appState = States.DONE;
  intervalStatus.classList.remove('visible');
  startStopBtn.textContent = 'START';
  startStopBtn.classList.remove('running');
  pauseBtn.classList.remove('visible', 'resuming');
  setConfigDisabled(false);
  const finalBpm = clampBpm(session.startBpm + (session.totalSets - 1) * session.bpmIncrement);
  doneSummary.textContent =
    `Completed ${session.totalSets} set${session.totalSets !== 1 ? 's' : ''}. ` +
    `BPM ranged from ${session.startBpm} to ${finalBpm}.`;
  // Roguelite hook: ramp finished cleanly (ran out of sets). A run treats this
  // as a completion. Dispatched before showing the default overlay so the
  // roguelite layer can suppress it in favour of its own completion screen.
  document.dispatchEvent(new CustomEvent('ramp:complete', { detail: { finalBpm } }));
  if (!window.__rogueSuppressDoneOverlay) {
    doneOverlay.classList.add('visible');
  }
  appState = States.IDLE;
}

doneBtn.addEventListener('click', () => doneOverlay.classList.remove('visible'));

// ── Status Display ────────────────────────────────────────────────────────────
function updateStatusDisplay() {
  const isCountIn = appState === States.COUNTING_IN;
  const isRest = appState === States.RESTING;
  statusPhase.textContent = isCountIn ? 'COUNT-IN' : isRest ? 'REST' : 'SET';
  statusPhase.className   = 'status-phase' + (isRest ? ' rest' : isCountIn ? ' countin' : '');
  statusSet.textContent   = `Set ${session.currentSet} of ${session.totalSets}`;
  statusBpm.textContent   = `BPM: ${session.currentBpm}`;
  statusCountdown.textContent = isCountIn ? 'Ready…' : formatTime(session.timeRemaining);
  const pct = isCountIn ? 100 : (session.totalDuration > 0 ? (session.timeRemaining / session.totalDuration) * 100 : 0);
  progressBar.style.width = pct + '%';
  progressBar.classList.toggle('rest-mode', isRest);
  if (!isRest && session.currentSet < session.totalSets) {
    statusNext.textContent = `Next set: BPM ${clampBpm(session.currentBpm + session.bpmIncrement)}`;
  } else if (isRest) {
    statusNext.textContent = `Resuming at BPM ${clampBpm(session.currentBpm + session.bpmIncrement)}`;
  } else {
    statusNext.textContent = 'Last set';
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────
function setConfigDisabled(disabled) {
  [numSetsInput, setMinsInput, setSecsInput, startBpmInput,
   bpmIncrInput, restMinsInput, restSecsInput, intervalToggle]
    .forEach(el => { el.disabled = disabled; });
}

// ── Roguelite control surface ───────────────────────────────────────────────
// Minimal, additive API so Roguelite Mode can reuse the existing ramp engine
// instead of duplicating it. The roguelite layer (roguelite.js) drives the
// climb through this surface and listens to the ramp:* CustomEvents above.
window.AppRamp = {
  // Ensure Ramp Mode is on, then start the existing interval session unchanged.
  startRampSession() {
    if (appState !== States.IDLE) return false;
    if (!intervalToggle.checked) {
      intervalToggle.checked = true;
      applyRampToggleState();
    }
    startIntervalSession();
    return appState !== States.IDLE;
  },
  // Programmatic abort — same path as pressing STOP (fires ramp:stop).
  stop() { if (appState !== States.IDLE) stopAll(); },
  getCurrentBpm() { return session.currentBpm; },
  isRunning() { return appState !== States.IDLE; },

  // Roguelite count-in support. A run's 2-bar count-in shouldn't burn the set's
  // duration, so the roguelite layer holds the set countdown when a set starts and
  // begins a fresh full-length countdown once gating goes live. No-ops outside a
  // running set so they can't disturb the rest phase or an idle engine.
  holdSetCountdown() {
    if (appState === States.RUNNING_SET && countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  },
  beginSetCountdown() {
    if (appState !== States.RUNNING_SET) return;
    session.timeRemaining = session.setDurationSecs;
    session.totalDuration = session.setDurationSecs;
    updateStatusDisplay();
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(countdownTick, 1000);
  },
};

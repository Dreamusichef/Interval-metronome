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
const States = { IDLE: 0, RUNNING_SET: 1, RESTING: 2, DONE: 3 };
let appState = States.IDLE;
let countdownTimer = null;
let isPaused = false;

const session = {
  totalSets: 0, setDurationSecs: 0, restDurationSecs: 0,
  startBpm: 0, bpmIncrement: 0, currentSet: 1,
  currentBpm: 0, timeRemaining: 0, totalDuration: 0,
};

// ── Stopwatch ─────────────────────────────────────────────────────────────────
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

stopwatchToggle.addEventListener('change', () => {
  stopwatchBody.classList.toggle('visible', stopwatchToggle.checked);
});

stopwatchStartStop.addEventListener('click', () => {
  if (swRunning) {
    clearInterval(swTimer);
    swTimer = null;
    swRunning = false;
    stopwatchStartStop.textContent = 'START';
    stopwatchStartStop.classList.remove('running');
  } else {
    if (swSeconds >= SW_MAX) return;
    swRunning = true;
    stopwatchStartStop.textContent = 'STOP';
    stopwatchStartStop.classList.add('running');
    swTimer = setInterval(() => {
      swSeconds++;
      stopwatchDisplay.textContent = formatStopwatch(swSeconds);
      if (swSeconds >= SW_MAX) {
        clearInterval(swTimer);
        swTimer = null;
        swRunning = false;
        stopwatchStartStop.textContent = 'START';
        stopwatchStartStop.classList.remove('running');
      }
    }, 1000);
  }
});

stopwatchReset.addEventListener('click', () => {
  clearInterval(swTimer);
  swTimer = null;
  swRunning = false;
  swSeconds = 0;
  stopwatchDisplay.textContent = '0:00';
  stopwatchStartStop.textContent = 'START';
  stopwatchStartStop.classList.remove('running');
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
  if (currentBeats >= 11) return;
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
  if (appState === States.IDLE) return;

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
  ME?.playWelcomeGreeting();
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
  appState = States.RUNNING_SET;
  startStopBtn.textContent = 'STOP';
  startStopBtn.classList.add('running');
  pauseBtn.textContent = 'PAUSE';
  pauseBtn.classList.add('visible');
  pauseBtn.classList.remove('resuming');
  setConfigDisabled(true);
  intervalStatus.classList.add('visible');
  updateStatusDisplay();
  countdownTimer = setInterval(countdownTick, 1000);
  // Roguelite hook: the session is fully live (appState set, BPM applied) — now
  // announce the start BPM so a run can begin gating hits / check the ceiling.
  document.dispatchEvent(new CustomEvent('ramp:start', { detail: { bpm: session.currentBpm } }));
}

function countdownTick() {
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
  appState = States.RUNNING_SET;
  updateStatusDisplay();
  // Roguelite hook: the ramp just climbed — report the new BPM so a run can
  // check it against the tier's ceiling.
  document.dispatchEvent(new CustomEvent('ramp:bpmchange', { detail: { bpm: session.currentBpm } }));
}

function finishSession() {
  ME?.stop();
  ME?.playPracticeCompleteCue();
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
  const isRest = appState === States.RESTING;
  statusPhase.textContent = isRest ? 'REST' : 'SET';
  statusPhase.className   = 'status-phase' + (isRest ? ' rest' : '');
  statusSet.textContent   = `Set ${session.currentSet} of ${session.totalSets}`;
  statusBpm.textContent   = `BPM: ${session.currentBpm}`;
  statusCountdown.textContent = formatTime(session.timeRemaining);
  const pct = session.totalDuration > 0 ? (session.timeRemaining / session.totalDuration) * 100 : 0;
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

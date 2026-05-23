'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const bpmValue      = document.getElementById('bpmValue');
const bpmSlider     = document.getElementById('bpmSlider');
const startStopBtn  = document.getElementById('startStopBtn');
const beatFlash     = document.getElementById('beatFlash');
const subBtns       = document.querySelectorAll('.sub-btn');
const bpmButtons    = document.querySelectorAll('.bpm-btn');
const intervalToggle = document.getElementById('intervalToggle');
const intervalConfig = document.getElementById('intervalConfig');
const intervalStatus = document.getElementById('intervalStatus');
const numSetsInput  = document.getElementById('numSets');
const setMinsInput  = document.getElementById('setMins');
const setSecsInput  = document.getElementById('setSecs');
const startBpmInput = document.getElementById('startBpm');
const bpmIncrInput  = document.getElementById('bpmIncrement');
const restMinsInput = document.getElementById('restMins');
const restSecsInput = document.getElementById('restSecs');
const statusPhase   = document.getElementById('statusPhase');
const statusSet     = document.getElementById('statusSet');
const statusBpm     = document.getElementById('statusBpm');
const statusCountdown = document.getElementById('statusCountdown');
const progressBar   = document.getElementById('progressBar');
const statusNext    = document.getElementById('statusNext');
const doneOverlay   = document.getElementById('doneOverlay');
const doneSummary   = document.getElementById('doneSummary');
const doneBtn       = document.getElementById('doneBtn');

// Stopwatch
const stopwatchDisplay   = document.getElementById('stopwatchDisplay');
const stopwatchStartStop = document.getElementById('stopwatchStartStop');
const stopwatchReset     = document.getElementById('stopwatchReset');


// ── State ─────────────────────────────────────────────────────────────────────
const States = { IDLE: 0, RUNNING_SET: 1, RESTING: 2, DONE: 3 };
let appState = States.IDLE;
let countdownTimer = null;

const session = {
  totalSets: 0,
  setDurationSecs: 0,
  restDurationSecs: 0,
  startBpm: 0,
  bpmIncrement: 0,
  currentSet: 1,
  currentBpm: 0,
  timeRemaining: 0,
  totalDuration: 0,
};

// ── Stopwatch ─────────────────────────────────────────────────────────────────
let swSeconds = 0;
let swRunning = false;
let swTimer = null;
const SW_MAX = 3600;

function formatStopwatch(secs) {
  if (secs >= 3600) return '1:00:00';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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
function clampBpm(val) {
  return Math.max(20, Math.min(400, Math.round(val)));
}

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function setDisplayBpm(val) {
  const clamped = clampBpm(val);
  bpmValue.value = clamped;
  bpmSlider.value = clamped;
  MetronomeEngine.setBpm(clamped);
}

function flashBeat(isAccent) {
  beatFlash.classList.remove('flash-accent', 'flash-tick');
  // Force reflow so re-adding the class triggers transition
  void beatFlash.offsetWidth;
  beatFlash.classList.add(isAccent ? 'flash-accent' : 'flash-tick');
  setTimeout(() => beatFlash.classList.remove('flash-accent', 'flash-tick'), 80);
}

MetronomeEngine.onBeat(flashBeat);

// ── Metronome controls ────────────────────────────────────────────────────────
bpmSlider.addEventListener('input', () => {
  setDisplayBpm(parseInt(bpmSlider.value, 10));
});

bpmButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const delta = parseInt(btn.dataset.delta, 10);
    setDisplayBpm(clampBpm(parseInt(bpmValue.value, 10) + delta));
  });
});

bpmValue.addEventListener('input', () => {
  const val = parseInt(bpmValue.value, 10);
  if (!isNaN(val)) {
    bpmSlider.value = Math.max(20, Math.min(400, val));
    MetronomeEngine.setBpm(val);
  }
});

bpmValue.addEventListener('change', () => {
  setDisplayBpm(parseInt(bpmValue.value, 10) || 120);
});

bpmValue.addEventListener('focus', () => {
  bpmValue.select();
});

subBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    subBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    MetronomeEngine.setSubdivision(btn.dataset.mode);
  });
});

// ── Start / Stop ──────────────────────────────────────────────────────────────
startStopBtn.addEventListener('click', () => {
  if (appState !== States.IDLE) {
    stopAll();
    return;
  }

  if (intervalToggle.checked) {
    startIntervalSession();
  } else {
    MetronomeEngine.init();
    MetronomeEngine.setBpm(clampBpm(parseInt(bpmValue.value, 10)));
    MetronomeEngine.start();
    appState = States.RUNNING_SET; // treat as "running" for stop check
    startStopBtn.textContent = 'STOP';
    startStopBtn.classList.add('running');
    setConfigDisabled(true);
  }
});

function stopAll() {
  MetronomeEngine.stop();
  clearInterval(countdownTimer);
  countdownTimer = null;
  appState = States.IDLE;
  startStopBtn.textContent = 'START';
  startStopBtn.classList.remove('running');
  intervalStatus.classList.remove('visible');
  setConfigDisabled(false);
}

// ── Interval toggle ───────────────────────────────────────────────────────────
intervalToggle.addEventListener('change', () => {
  intervalConfig.classList.toggle('visible', intervalToggle.checked);
});

// ── Interval Session ──────────────────────────────────────────────────────────
function parseIntVal(el, fallback) {
  const v = parseInt(el.value, 10);
  return isNaN(v) ? fallback : v;
}

function startIntervalSession() {
  const totalSets = Math.max(1, parseIntVal(numSetsInput, 1));
  const mins = Math.max(0, parseIntVal(setMinsInput, 0));
  const secs = Math.max(0, parseIntVal(setSecsInput, 0));
  const setDuration = mins * 60 + secs;
  const restMins = Math.max(0, parseIntVal(restMinsInput, 0));
  const restSecs = Math.max(0, parseIntVal(restSecsInput, 0));
  const restDuration = restMins * 60 + restSecs;
  const startBpm = clampBpm(parseIntVal(startBpmInput, 80));
  const bpmIncrement = parseIntVal(bpmIncrInput, 0);

  if (setDuration === 0) {
    alert('Set duration must be greater than 0.');
    return;
  }

  session.totalSets = totalSets;
  session.setDurationSecs = setDuration;
  session.restDurationSecs = restDuration;
  session.startBpm = startBpm;
  session.bpmIncrement = bpmIncrement;
  session.currentSet = 1;
  session.currentBpm = startBpm;
  session.timeRemaining = setDuration;
  session.totalDuration = setDuration;

  MetronomeEngine.init();
  MetronomeEngine.setBpm(startBpm);
  setDisplayBpm(startBpm);
  MetronomeEngine.start();
  MetronomeEngine.playSetStartCue();

  appState = States.RUNNING_SET;
  startStopBtn.textContent = 'STOP';
  startStopBtn.classList.add('running');
  setConfigDisabled(true);
  intervalStatus.classList.add('visible');

  updateStatusDisplay();
  countdownTimer = setInterval(countdownTick, 1000);
}

function countdownTick() {
  session.timeRemaining--;

  if (session.timeRemaining <= 0) {
    if (appState === States.RUNNING_SET) {
      onSetComplete();
    } else if (appState === States.RESTING) {
      onRestComplete();
    }
    return;
  }

  updateStatusDisplay();
}

function onSetComplete() {
  if (session.currentSet >= session.totalSets) {
    finishSession();
    return;
  }

  MetronomeEngine.playSetEndCue();

  if (session.restDurationSecs > 0) {
    MetronomeEngine.stop();
    appState = States.RESTING;
    session.timeRemaining = session.restDurationSecs;
    session.totalDuration = session.restDurationSecs;
    updateStatusDisplay();
  } else {
    advanceToNextSet();
  }
}

function onRestComplete() {
  advanceToNextSet();
}

function advanceToNextSet() {
  session.currentSet++;
  session.currentBpm = clampBpm(session.currentBpm + session.bpmIncrement);
  session.timeRemaining = session.setDurationSecs;
  session.totalDuration = session.setDurationSecs;

  MetronomeEngine.setBpm(session.currentBpm);
  setDisplayBpm(session.currentBpm);

  if (!MetronomeEngine.isRunning()) {
    MetronomeEngine.start();
  }

  MetronomeEngine.playSetStartCue();
  appState = States.RUNNING_SET;
  updateStatusDisplay();
}

function finishSession() {
  MetronomeEngine.stop();
  MetronomeEngine.playPracticeCompleteCue();
  clearInterval(countdownTimer);
  countdownTimer = null;
  appState = States.DONE;

  intervalStatus.classList.remove('visible');
  startStopBtn.textContent = 'START';
  startStopBtn.classList.remove('running');
  setConfigDisabled(false);

  const finalBpm = clampBpm(session.startBpm + (session.totalSets - 1) * session.bpmIncrement);
  doneSummary.textContent =
    `Completed ${session.totalSets} set${session.totalSets !== 1 ? 's' : ''}. ` +
    `BPM ranged from ${session.startBpm} to ${finalBpm}.`;
  doneOverlay.classList.add('visible');

  appState = States.IDLE;
}

doneBtn.addEventListener('click', () => {
  doneOverlay.classList.remove('visible');
});

// ── Status Display ────────────────────────────────────────────────────────────
function updateStatusDisplay() {
  const isRest = appState === States.RESTING;

  statusPhase.textContent = isRest ? 'REST' : 'SET';
  statusPhase.className = 'status-phase' + (isRest ? ' rest' : '');

  statusSet.textContent = `Set ${session.currentSet} of ${session.totalSets}`;
  statusBpm.textContent = `BPM: ${session.currentBpm}`;
  statusCountdown.textContent = formatTime(session.timeRemaining);

  const pct = session.totalDuration > 0
    ? (session.timeRemaining / session.totalDuration) * 100
    : 0;
  progressBar.style.width = pct + '%';
  progressBar.classList.toggle('rest-mode', isRest);

  if (!isRest && session.currentSet < session.totalSets) {
    const nextBpm = clampBpm(session.currentBpm + session.bpmIncrement);
    statusNext.textContent = `Next set: BPM ${nextBpm}`;
  } else if (isRest) {
    const nextBpm = clampBpm(session.currentBpm + session.bpmIncrement);
    statusNext.textContent = `Resuming at BPM ${nextBpm}`;
  } else {
    statusNext.textContent = 'Last set';
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────
function setConfigDisabled(disabled) {
  const fields = [
    numSetsInput, setMinsInput, setSecsInput,
    startBpmInput, bpmIncrInput, restMinsInput, restSecsInput,
    intervalToggle,
  ];
  fields.forEach(el => { el.disabled = disabled; });
}

'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   SESSION ENGINE — ramp / set / rest / count-in (DOM-free).
   Consumes MetronomeEngine (bare lexical global when loaded via <script>).
   Exposes window.SessionEngine; AppRamp-compatible surface via .publicApi
   (also assigned to window.AppRamp when unset).
   Events (on document by default): ramp:start, ramp:bpmchange, ramp:setcomplete,
   ramp:complete, ramp:stop.
   ════════════════════════════════════════════════════════════════════════════ */

const SessionEngine = (() => {
  const States = { IDLE: 0, RUNNING_SET: 1, RESTING: 2, DONE: 3, COUNTING_IN: 4 };
  const COUNT_IN_KEY = 'gm_rampcountin';

  let appState = States.IDLE;
  let countdownTimer = null;
  let countInTimer = null;
  let isPaused = false;
  let countInBars = 1;
  let beatsPerMeasure = 4;

  const session = {
    totalSets: 0, setDurationSecs: 0, restDurationSecs: 0,
    startBpm: 0, bpmIncrement: 0, currentSet: 1,
    currentBpm: 0, timeRemaining: 0, totalDuration: 0,
  };

  const hooks = {
    getMetronome() {
      return (typeof MetronomeEngine !== 'undefined') ? MetronomeEngine : null;
    },
    /** @returns {{ totalSets, setDurationSecs, restDurationSecs, startBpm, bpmIncrement }|null} */
    getConfig: null,
    getBeatsPerMeasure() { return beatsPerMeasure; },
    isGameModeActive() {
      return (typeof window !== 'undefined') && !!window.__gameModeActive;
    },
    suppressCompleteCue() {
      return (typeof window !== 'undefined') && !!window.__rogueSuppressCompleteCue;
    },
    suppressDoneOverlay() {
      return (typeof window !== 'undefined') && !!window.__rogueSuppressDoneOverlay;
    },
    ensureRampEnabled() {},
    onBpmDisplay(_bpm) {},
    onStatus(_snap) {},
    onRunningUi(_info) {},
    onConfigDisabled(_disabled) {},
    onDone(_summary) {},
    onAlert(msg) {
      if (typeof alert === 'function') alert(msg);
    },
    dispatch(name, detail) {
      if (typeof document === 'undefined') return;
      document.dispatchEvent(new CustomEvent(name, { detail }));
    },
  };

  // Restore persisted count-in bars (0–4).
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = parseInt(localStorage.getItem(COUNT_IN_KEY), 10);
      if (!isNaN(saved) && saved >= 0 && saved <= 4) countInBars = saved;
    }
  } catch (_e) { /* ignore */ }

  function configure(opts) {
    if (!opts || typeof opts !== 'object') return;
    Object.keys(opts).forEach((k) => {
      if (typeof opts[k] === 'function' || opts[k] === null) hooks[k] = opts[k];
    });
  }

  function me() { return hooks.getMetronome ? hooks.getMetronome() : null; }

  function clampBpm(val) {
    return Math.max(20, Math.min(400, Math.round(val)));
  }

  function formatTime(secs) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return m + ':' + s.toString().padStart(2, '0');
  }

  function countInOn() {
    return countInBars > 0 && !hooks.isGameModeActive();
  }

  function oneBarMs() {
    const beats = hooks.getBeatsPerMeasure ? hooks.getBeatsPerMeasure() : beatsPerMeasure;
    return Math.round(beats * 60000 / clampBpm(session.currentBpm || 120));
  }

  function setCountInBars(n) {
    const v = Math.max(0, Math.min(4, parseInt(n, 10) || 0));
    countInBars = v;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(COUNT_IN_KEY, String(v));
    } catch (_e) { /* ignore */ }
    return countInBars;
  }

  function setBeatsPerMeasure(n) {
    const v = Math.max(1, Math.min(16, parseInt(n, 10) || 4));
    beatsPerMeasure = v;
    return beatsPerMeasure;
  }

  function getStatusSnapshot() {
    const isCountIn = appState === States.COUNTING_IN;
    const isRest = appState === States.RESTING;
    const pct = isCountIn
      ? 100
      : (session.totalDuration > 0 ? (session.timeRemaining / session.totalDuration) * 100 : 0);
    let nextLabel = 'Last set';
    if (!isRest && session.currentSet < session.totalSets) {
      nextLabel = 'Next set: BPM ' + clampBpm(session.currentBpm + session.bpmIncrement);
    } else if (isRest) {
      nextLabel = 'Resuming at BPM ' + clampBpm(session.currentBpm + session.bpmIncrement);
    }
    return {
      state: appState,
      phase: isCountIn ? 'countin' : isRest ? 'rest' : 'set',
      phaseLabel: isCountIn ? 'COUNT-IN' : isRest ? 'REST' : 'SET',
      currentSet: session.currentSet,
      totalSets: session.totalSets,
      currentBpm: session.currentBpm,
      timeRemaining: session.timeRemaining,
      totalDuration: session.totalDuration,
      countdownLabel: isCountIn ? 'Ready…' : formatTime(session.timeRemaining),
      progressPct: pct,
      nextLabel,
      isPaused,
      isIdle: appState === States.IDLE,
    };
  }

  function emitStatus() { hooks.onStatus(getStatusSnapshot()); }

  function emitRunningUi(extra) {
    hooks.onRunningUi(Object.assign({
      running: appState !== States.IDLE,
      paused: isPaused,
      showPause: appState !== States.IDLE && appState !== States.DONE,
      showStatus: appState !== States.IDLE && appState !== States.DONE &&
        (session.totalSets > 0),
      state: appState,
    }, extra || {}));
  }

  function beginSet(isFirst) {
    if (countInOn()) {
      appState = States.COUNTING_IN;
      emitStatus();
      clearTimeout(countInTimer);
      countInTimer = setTimeout(() => startSetTiming(isFirst), oneBarMs() * countInBars);
    } else {
      startSetTiming(isFirst);
    }
  }

  function startSetTiming(isFirst) {
    appState = States.RUNNING_SET;
    emitStatus();
    hooks.dispatch(isFirst ? 'ramp:start' : 'ramp:bpmchange', { bpm: session.currentBpm });
  }

  function stopAll() {
    me()?.stop();
    clearInterval(countdownTimer);
    countdownTimer = null;
    clearTimeout(countInTimer);
    countInTimer = null;
    isPaused = false;
    appState = States.IDLE;
    hooks.onConfigDisabled(false);
    emitRunningUi({ running: false, showPause: false, showStatus: false, resetButtons: true });
    hooks.dispatch('ramp:stop');
  }

  function togglePause() {
    if (appState === States.IDLE || appState === States.COUNTING_IN) return false;

    if (isPaused) {
      isPaused = false;
      if (appState === States.RUNNING_SET) {
        const eng = me();
        eng?.init();
        eng?.setBpm(session.currentBpm);
        eng?.start();
      }
      countdownTimer = setInterval(countdownTick, 1000);
      emitRunningUi({ paused: false });
      return true;
    }

    isPaused = true;
    me()?.stop();
    clearInterval(countdownTimer);
    countdownTimer = null;
    emitRunningUi({ paused: true });
    return true;
  }

  function startPlain(bpm) {
    if (appState !== States.IDLE) return false;
    const clamped = clampBpm(bpm);
    const eng = me();
    eng?.init();
    eng?.setBpm(clamped);
    eng?.start();
    hooks.onBpmDisplay(clamped);
    appState = States.RUNNING_SET;
    // Plain play has no multi-set session — clear set totals so status stays hidden.
    session.totalSets = 0;
    isPaused = false;
    hooks.onConfigDisabled(true);
    emitRunningUi({ running: true, showPause: false, showStatus: false, resetButtons: false });
    return true;
  }

  function startIntervalSession(config) {
    const cfg = config || (hooks.getConfig && hooks.getConfig());
    if (!cfg) {
      hooks.onAlert('Ramp config unavailable.');
      return false;
    }

    const totalSets = Math.max(1, cfg.totalSets | 0);
    const setDuration = Math.max(0, cfg.setDurationSecs | 0);
    const restDuration = Math.max(0, cfg.restDurationSecs | 0);
    const startBpm = clampBpm(cfg.startBpm);
    const bpmIncrement = cfg.bpmIncrement | 0;

    if (setDuration === 0) {
      hooks.onAlert('Set duration must be greater than 0.');
      return false;
    }

    Object.assign(session, {
      totalSets,
      setDurationSecs: setDuration,
      restDurationSecs: restDuration,
      startBpm,
      bpmIncrement,
      currentSet: 1,
      currentBpm: startBpm,
      timeRemaining: setDuration,
      totalDuration: setDuration,
    });

    const eng = me();
    eng?.init();
    eng?.setBpm(startBpm);
    hooks.onBpmDisplay(startBpm);
    eng?.start();
    eng?.playSetStartCue();

    isPaused = false;
    hooks.onConfigDisabled(true);
    emitRunningUi({
      running: true,
      showPause: true,
      showStatus: true,
      resetButtons: false,
      paused: false,
    });
    countdownTimer = setInterval(countdownTick, 1000);
    beginSet(true);
    return appState !== States.IDLE;
  }

  function countdownTick() {
    if (appState === States.COUNTING_IN) return;
    session.timeRemaining--;
    if (session.timeRemaining <= 0) {
      if (appState === States.RUNNING_SET) onSetComplete();
      else if (appState === States.RESTING) onRestComplete();
      return;
    }
    emitStatus();
  }

  function onSetComplete() {
    if (session.currentSet >= session.totalSets) {
      finishSession();
      return;
    }
    hooks.dispatch('ramp:setcomplete', { bpm: session.currentBpm, set: session.currentSet });
    me()?.playSetEndCue();
    if (session.restDurationSecs > 0) {
      me()?.stop();
      appState = States.RESTING;
      session.timeRemaining = session.restDurationSecs;
      session.totalDuration = session.restDurationSecs;
      emitStatus();
    } else {
      advanceToNextSet();
    }
  }

  function onRestComplete() { advanceToNextSet(); }

  function advanceToNextSet() {
    session.currentSet++;
    session.currentBpm = clampBpm(session.currentBpm + session.bpmIncrement);
    session.timeRemaining = session.setDurationSecs;
    session.totalDuration = session.setDurationSecs;
    const eng = me();
    eng?.setBpm(session.currentBpm);
    hooks.onBpmDisplay(session.currentBpm);
    if (!eng?.isRunning()) eng?.start();
    eng?.playSetStartCue();
    beginSet(false);
  }

  function finishSession() {
    me()?.stop();
    if (!hooks.suppressCompleteCue()) me()?.playPracticeCompleteCue();
    clearInterval(countdownTimer);
    countdownTimer = null;
    isPaused = false;
    appState = States.DONE;
    hooks.onConfigDisabled(false);
    emitRunningUi({ running: false, showPause: false, showStatus: false, resetButtons: true });

    const finalBpm = clampBpm(session.startBpm + (session.totalSets - 1) * session.bpmIncrement);
    const summary =
      'Completed ' + session.totalSets + ' set' + (session.totalSets !== 1 ? 's' : '') + '. ' +
      'BPM ranged from ' + session.startBpm + ' to ' + finalBpm + '.';

    hooks.dispatch('ramp:complete', { finalBpm });
    if (!hooks.suppressDoneOverlay()) hooks.onDone(summary);
    appState = States.IDLE;
  }

  // ── AppRamp-compatible public surface ─────────────────────────────────────
  const publicApi = {
    startRampSession(config) {
      if (appState !== States.IDLE) return false;
      hooks.ensureRampEnabled();
      return startIntervalSession(config);
    },
    stop() {
      if (appState !== States.IDLE) stopAll();
    },
    getCurrentBpm() { return session.currentBpm; },
    isRunning() { return appState !== States.IDLE; },
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
      emitStatus();
      if (countdownTimer) clearInterval(countdownTimer);
      countdownTimer = setInterval(countdownTick, 1000);
    },
  };

  return {
    States,
    configure,
    clampBpm,
    formatTime,
    getStatusSnapshot,
    setCountInBars,
    getCountInBars() { return countInBars; },
    setBeatsPerMeasure,
    getBeatsPerMeasure() { return beatsPerMeasure; },
    getState() { return appState; },
    getSession() { return session; },
    isPaused() { return isPaused; },
    startPlain,
    startIntervalSession,
    stop: publicApi.stop,
    togglePause,
    publicApi,
    // Flat AppRamp methods for convenience / SessionEngine === AppRamp style use
    startRampSession: publicApi.startRampSession,
    getCurrentBpm: publicApi.getCurrentBpm,
    isRunning: publicApi.isRunning,
    holdSetCountdown: publicApi.holdSetCountdown,
    beginSetCountdown: publicApi.beginSetCountdown,
  };
})();

if (typeof window !== 'undefined') {
  window.SessionEngine = SessionEngine;
  if (!window.AppRamp) window.AppRamp = SessionEngine.publicApi;
}
if (typeof module !== 'undefined' && module.exports) module.exports = SessionEngine;

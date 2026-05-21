'use strict';

const MetronomeEngine = (() => {
  const SCHEDULE_AHEAD_TIME = 0.1; // seconds
  const SCHEDULER_INTERVAL = 25;   // ms

  const SUBDIVISION_TICKS = {
    quarter:    1,
    eighth:     2,
    triplet:    3,
    sixteenth:  4,
    sextuplet:  6,
  };

  let audioCtx = null;
  let bpm = 120;
  let subdivision = 'quarter';
  let running = false;
  let schedulerTimer = null;
  let nextTickTime = 0;
  let currentTick = 0;   // position within measure (0-based)
  let ticksPerMeasure = 1;
  let tickInterval = 0.5;
  let beatCallback = null;
  let pendingVisuals = [];
  let rafId = null;

  function getTickInterval() {
    const ticksPerBeat = SUBDIVISION_TICKS[subdivision] || 1;
    return 60 / bpm / ticksPerBeat;
  }

  function scheduleClick(time, isAccent) {
    const freq = isAccent ? 1000 : 600;
    const gainPeak = isAccent ? 0.8 : 0.4;
    const duration = isAccent ? 0.06 : 0.04;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'triangle';
    osc.frequency.value = freq;

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(gainPeak, time + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(time);
    osc.stop(time + duration + 0.01);

    pendingVisuals.push({ time, isAccent });
  }

  function scheduler() {
    const ticksPerBeat = SUBDIVISION_TICKS[subdivision] || 1;
    tickInterval = 60 / bpm / ticksPerBeat;
    ticksPerMeasure = ticksPerBeat * 4; // 4/4 time

    while (nextTickTime < audioCtx.currentTime + SCHEDULE_AHEAD_TIME) {
      const isAccent = currentTick % ticksPerMeasure === 0;
      scheduleClick(nextTickTime, isAccent);
      nextTickTime += tickInterval;
      currentTick = (currentTick + 1) % ticksPerMeasure;
    }
  }

  function visualLoop() {
    const now = audioCtx ? audioCtx.currentTime : 0;
    while (pendingVisuals.length > 0 && pendingVisuals[0].time <= now) {
      const visual = pendingVisuals.shift();
      if (beatCallback) beatCallback(visual.isAccent);
    }
    if (running || pendingVisuals.length > 0) {
      rafId = requestAnimationFrame(visualLoop);
    }
  }

  function init() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  function start() {
    if (!audioCtx) init();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    if (running) return;
    running = true;
    currentTick = 0;
    nextTickTime = audioCtx.currentTime + 0.05;
    scheduler();
    schedulerTimer = setInterval(scheduler, SCHEDULER_INTERVAL);
    rafId = requestAnimationFrame(visualLoop);
  }

  function stop() {
    if (!running) return;
    running = false;
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    pendingVisuals = [];
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function setBpm(newBpm) {
    bpm = Math.max(20, Math.min(400, Math.round(newBpm)));
  }

  function setSubdivision(mode) {
    if (!SUBDIVISION_TICKS[mode]) return;
    subdivision = mode;
    currentTick = 0;
  }

  function onBeat(callback) {
    beatCallback = callback;
  }

  function getCurrentBpm() {
    return bpm;
  }

  function isRunning() {
    return running;
  }

  // Resume audio context when tab regains visibility
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && audioCtx && audioCtx.state === 'suspended' && running) {
      audioCtx.resume().then(() => {
        nextTickTime = audioCtx.currentTime + 0.05;
        currentTick = 0;
      });
    }
  });

  return { init, start, stop, setBpm, setSubdivision, onBeat, getCurrentBpm, isRunning };
})();

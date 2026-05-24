'use strict';

const MetronomeEngine = (() => {
  const SCHEDULE_AHEAD_TIME = 0.1;
  const SCHEDULER_INTERVAL = 25;

  const SUBDIVISION_TICKS = {
    quarter:   1,
    eighth:    2,
    triplet:   3,
    sixteenth: 4,
    sextuplet: 6,
  };

  const BEAT_MODES = ['accent', 'click', 'silent'];

  let audioCtx = null;
  let setEndBuffer = null;
  let setStartBuffer = null;
  let practiceCompleteBuffer = null;
  let bpm = 120;
  let subdivision = 'quarter';
  let running = false;
  let schedulerTimer = null;
  let nextTickTime = 0;
  let currentTick = 0;
  let tickInterval = 0.5;
  let beatModes = ['accent', 'click', 'click', 'click'];
  let beatCallback = null;
  let pendingVisuals = [];
  let rafId = null;

  function scheduleSound(time, soundType) {
    if (soundType === 'silent') return;
    let freq, gainPeak, duration;
    if (soundType === 'accent') { freq = 1000; gainPeak = 0.8; duration = 0.06; }
    else                        { freq = 600;  gainPeak = 0.4; duration = 0.04; } // click

    const osc  = audioCtx.createOscillator();
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
  }

  function scheduler() {
    const ticksPerBeat   = SUBDIVISION_TICKS[subdivision] || 1;
    tickInterval         = 60 / bpm / ticksPerBeat;
    const ticksPerMeasure = ticksPerBeat * 4;

    while (nextTickTime < audioCtx.currentTime + SCHEDULE_AHEAD_TIME) {
      const beatIndex  = Math.floor(currentTick / ticksPerBeat) % 4;
      const tickInBeat = currentTick % ticksPerBeat;
      const isFirst    = tickInBeat === 0;
      const mode       = beatModes[beatIndex];

      let soundType;
      if (mode === 'silent') {
        soundType = 'silent';
      } else if (isFirst) {
        soundType = mode; // 'accent' | 'click' for the beat itself
      } else {
        soundType = 'click'; // subdivisions always click
      }

      scheduleSound(nextTickTime, soundType);

      if (isFirst) {
        pendingVisuals.push({ time: nextTickTime, beatIndex, soundType });
      }

      nextTickTime  += tickInterval;
      currentTick    = (currentTick + 1) % ticksPerMeasure;
    }
  }

  function visualLoop() {
    const now = audioCtx ? audioCtx.currentTime : 0;
    while (pendingVisuals.length > 0 && pendingVisuals[0].time <= now) {
      const v = pendingVisuals.shift();
      if (beatCallback) beatCallback(v.beatIndex, v.soundType);
    }
    if (running || pendingVisuals.length > 0) {
      rafId = requestAnimationFrame(visualLoop);
    }
  }

  function init() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    [
      [typeof SOUND_SET_END_B64          !== 'undefined' && SOUND_SET_END_B64,          b => { setEndBuffer           = b; }],
      [typeof SOUND_SET_START_B64        !== 'undefined' && SOUND_SET_START_B64,        b => { setStartBuffer         = b; }],
      [typeof SOUND_PRACTICE_COMPLETE_B64 !== 'undefined' && SOUND_PRACTICE_COMPLETE_B64, b => { practiceCompleteBuffer = b; }],
    ].forEach(([src, setter]) => {
      if (src) fetch(src).then(r => r.arrayBuffer()).then(b => audioCtx.decodeAudioData(b)).then(setter).catch(() => {});
    });
  }

  function doStart() {
    if (running) return;
    running      = true;
    currentTick  = 0;
    nextTickTime = audioCtx.currentTime + 0.05;
    scheduler();
    schedulerTimer = setInterval(scheduler, SCHEDULER_INTERVAL);
    rafId = requestAnimationFrame(visualLoop);
  }

  function start() {
    if (!audioCtx) init();
    if (audioCtx.state === 'suspended') audioCtx.resume().then(doStart);
    else doStart();
  }

  function stop() {
    if (!running) return;
    running = false;
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    pendingVisuals = [];
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function setBpm(newBpm) {
    bpm = Math.max(20, Math.min(400, Math.round(newBpm)));
  }

  function setSubdivision(mode) {
    if (!SUBDIVISION_TICKS[mode]) return;
    subdivision = mode;
    currentTick = 0;
  }

  function setBeatMode(beatIndex, mode) {
    if (beatIndex >= 0 && beatIndex < 4 && BEAT_MODES.includes(mode)) {
      beatModes[beatIndex] = mode;
    }
  }

  function getBeatModes() { return [...beatModes]; }

  function onBeat(callback) { beatCallback = callback; }

  function playSyntheticCue(pitches, spacing) {
    if (!audioCtx) return;
    pitches.forEach((freq, i) => {
      const t    = audioCtx.currentTime + i * spacing;
      const osc  = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.55, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.22);
    });
  }

  function playBuffer(buffer) {
    if (!audioCtx || !buffer) return;
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(audioCtx.destination);
    src.start();
  }

  function playSetEndCue()         { if (setEndBuffer)           playBuffer(setEndBuffer);           else playSyntheticCue([880, 660, 440],       0.18); }
  function playSetStartCue()       { if (setStartBuffer)         playBuffer(setStartBuffer);         else playSyntheticCue([440, 660, 880],       0.18); }
  function playPracticeCompleteCue() { if (practiceCompleteBuffer) playBuffer(practiceCompleteBuffer); else playSyntheticCue([440, 550, 660, 880], 0.15); }

  function getCurrentBpm() { return bpm; }
  function isRunning()     { return running; }

  document.addEventListener('touchstart', () => {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().then(() => {
        if (running) { nextTickTime = audioCtx.currentTime + 0.05; currentTick = 0; }
      });
    }
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && audioCtx && running) {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => { nextTickTime = audioCtx.currentTime + 0.05; currentTick = 0; });
      } else {
        nextTickTime = audioCtx.currentTime + 0.05; currentTick = 0;
      }
    }
  });

  return {
    init, start, stop, setBpm, setSubdivision, onBeat, getCurrentBpm, isRunning,
    setBeatMode, getBeatModes,
    playSetEndCue, playSetStartCue, playPracticeCompleteCue,
  };
})();

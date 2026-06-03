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

  let soundMode = 'click'; // 'click' | 'cowbell'

  // Per-sound level trims (linear gain = 10^(dB/20)).
  const WELCOME_GAIN = 0.708;   // welcome greeting  −3dB
  const COWBELL_GAIN = 1.122;   // cowbell click     +1dB
  const CUE_GAIN     = 0.891;   // set start/end + practice-complete cues  −1dB

  let audioCtx = null;
  let setEndBuffer = null;
  let setStartBuffer = null;
  let practiceCompleteBuffer = null;
  let cowbellBeatBuffer   = null;
  let cowbellAccentBuffer = null;
  let bpm = 120;
  let subdivision = 'quarter';
  let beatsPerMeasure = 4;
  let beatModes = ['accent', 'click', 'click', 'click'];
  let running = false;
  let schedulerTimer = null;
  let nextTickTime = 0;
  let currentTick = 0;
  let tickInterval = 0.5;
  let beatCallback = null;
  let scheduleCallback = null; // Roguelite hook: fires for every scheduled tick (audio-clock time)
  let pendingVisuals = [];
  let rafId = null;

  function scheduleBufferAt(buffer, time, gain) {
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    if (gain != null && gain !== 1) {
      const g = audioCtx.createGain();
      g.gain.value = gain;
      src.connect(g); g.connect(audioCtx.destination);
    } else {
      src.connect(audioCtx.destination);
    }
    src.start(time);
  }

  function scheduleSound(time, soundType) {
    if (soundType === 'silent') return;

    if (soundMode === 'cowbell') {
      const buf = soundType === 'accent' ? cowbellAccentBuffer : cowbellBeatBuffer;
      if (buf) { scheduleBufferAt(buf, time, COWBELL_GAIN); return; }   // +1dB
      // fall through to click if buffers not yet loaded
    }

    // Click +2dB (0.62→0.78). Accent stays at 1.0 (already at the safe ceiling —
    // boosting it would clip the downbeat transient).
    let freq, gainPeak, duration;
    if (soundType === 'accent') { freq = 880; gainPeak = 1.0;  duration = 0.06; }
    else                        { freq = 540; gainPeak = 0.78; duration = 0.04; } // click

    const osc    = audioCtx.createOscillator();
    const filter = audioCtx.createBiquadFilter();
    const gain   = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    // Low-pass at 2kHz removes harsh upper harmonics while keeping the click crisp
    filter.type = 'lowpass';
    filter.frequency.value = 2000;
    filter.Q.value = 0.5;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(gainPeak, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(time);
    osc.stop(time + duration + 0.01);
  }

  function scheduler() {
    const ticksPerBeat   = SUBDIVISION_TICKS[subdivision] || 1;
    tickInterval         = 60 / bpm / ticksPerBeat;
    const ticksPerMeasure = ticksPerBeat * beatsPerMeasure;

    while (nextTickTime < audioCtx.currentTime + SCHEDULE_AHEAD_TIME) {
      const beatIndex  = Math.floor(currentTick / ticksPerBeat) % beatsPerMeasure;
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

      // Roguelite detection hook. Fires synchronously as each tick is scheduled,
      // handing out the tick's precise time in the audio clock (audioCtx.currentTime
      // domain, seconds). Additive only — has no effect when no callback is registered.
      if (scheduleCallback) {
        scheduleCallback(nextTickTime, soundType, beatIndex, tickInBeat);
      }

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

  function loadAudio(dataUrl, setter) {
    if (!dataUrl) return;
    try {
      const raw = atob(dataUrl.split(',')[1]);
      const buf = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
      audioCtx.decodeAudioData(buf.buffer.slice(0)).then(setter).catch(() => {});
    } catch (e) {}
  }

  function init() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    loadSoundBank();   // populates buffers if sounds.js is already loaded (else no-op)
  }

  // Decode the cue/cowbell buffers from the (lazily loaded) sounds.js base64 blobs.
  // Idempotent + safe to call before sounds.js exists: each buffer is only decoded
  // once, and missing SOUND_*_B64 globals are skipped (the metronome click itself is
  // synthesized, so the core app never waits on these). Called from init() and again
  // by the background loader once sounds.js arrives.
  function loadSoundBank() {
    if (!audioCtx) return;
    if (!setEndBuffer)           loadAudio(typeof SOUND_SET_END_B64           !== 'undefined' ? SOUND_SET_END_B64           : null, b => { setEndBuffer           = b; });
    if (!setStartBuffer)         loadAudio(typeof SOUND_SET_START_B64         !== 'undefined' ? SOUND_SET_START_B64         : null, b => { setStartBuffer         = b; });
    if (!practiceCompleteBuffer) loadAudio(typeof SOUND_PRACTICE_COMPLETE_B64 !== 'undefined' ? SOUND_PRACTICE_COMPLETE_B64 : null, b => { practiceCompleteBuffer = b; });
    if (!cowbellBeatBuffer)      loadAudio(typeof SOUND_COWBELL_BEAT_B64      !== 'undefined' ? SOUND_COWBELL_BEAT_B64      : null, b => { cowbellBeatBuffer      = b; });
    if (!cowbellAccentBuffer)    loadAudio(typeof SOUND_COWBELL_ACCENT_B64    !== 'undefined' ? SOUND_COWBELL_ACCENT_B64    : null, b => { cowbellAccentBuffer    = b; });
  }

  let welcomePlayed = false;
  function playWelcomeGreeting() {
    if (welcomePlayed) return;
    if (typeof SOUND_WELCOME_B64 === 'undefined' || !SOUND_WELCOME_B64) return;
    if (!audioCtx) init();

    const fire = () => {
      if (welcomePlayed || audioCtx.state !== 'running') return;
      welcomePlayed = true;
      try {
        const raw = atob(SOUND_WELCOME_B64.split(',')[1]);
        const buf = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
        audioCtx.decodeAudioData(buf.buffer.slice(0))
          .then(b => playBuffer(b, WELCOME_GAIN))
          .catch(() => { welcomePlayed = false; });
      } catch (e) { welcomePlayed = false; }
    };

    if (audioCtx.state === 'suspended') audioCtx.resume().then(fire).catch(() => {});
    else fire();
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
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().then(doStart).catch((err) => {
        if (window.__showError) window.__showError('audio resume failed: ' + (err && err.message ? err.message : err));
        doStart();
      });
    } else {
      doStart();
    }
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

  function setBeatsPerMeasure(n) {
    n = Math.max(1, Math.min(11, n));
    beatsPerMeasure = n;
    while (beatModes.length < n) beatModes.push('click');
    beatModes = beatModes.slice(0, n);
    currentTick = 0;
  }

  function getBeatsPerMeasure() { return beatsPerMeasure; }

  function setBeatMode(beatIndex, mode) {
    if (beatIndex >= 0 && beatIndex < beatsPerMeasure && BEAT_MODES.includes(mode)) {
      beatModes[beatIndex] = mode;
    }
  }

  function getBeatModes() { return [...beatModes]; }

  function onBeat(callback) { beatCallback = callback; }

  // Roguelite hook: register/unregister a per-tick scheduling callback.
  // callback(tickTimeSec, soundType, beatIndex, tickInBeat). Pass null to clear.
  function onSchedule(callback) { scheduleCallback = callback; }

  // Exposes the shared audio clock so the roguelite layer can reconcile it with
  // the Web MIDI / performance.now() clock. Returns null until init() has run.
  function getAudioContext() { return audioCtx; }

  function playSyntheticCue(pitches, spacing) {
    if (!audioCtx) return;
    pitches.forEach((freq, i) => {
      const t    = audioCtx.currentTime + i * spacing;
      const osc  = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.49, t + 0.005);   // −1dB, matches the cue buffers
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.22);
    });
  }

  function playBuffer(buffer, gain) {
    if (!audioCtx || !buffer) return;
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    if (gain != null && gain !== 1) {
      const g = audioCtx.createGain();
      g.gain.value = gain;
      src.connect(g); g.connect(audioCtx.destination);
    } else {
      src.connect(audioCtx.destination);
    }
    src.start();
  }

  function playSetEndCue()         { if (setEndBuffer)           playBuffer(setEndBuffer,           CUE_GAIN); else playSyntheticCue([880, 660, 440],       0.18); }
  function playSetStartCue()       { if (setStartBuffer)         playBuffer(setStartBuffer,         CUE_GAIN); else playSyntheticCue([440, 660, 880],       0.18); }
  function playPracticeCompleteCue() { if (practiceCompleteBuffer) playBuffer(practiceCompleteBuffer, CUE_GAIN); else playSyntheticCue([440, 550, 660, 880], 0.15); }

  function setSoundMode(mode) { if (mode === 'click' || mode === 'cowbell') soundMode = mode; }
  function getSoundMode()     { return soundMode; }

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
    setBeatsPerMeasure, getBeatsPerMeasure, setBeatMode, getBeatModes,
    playSetEndCue, playSetStartCue, playPracticeCompleteCue,
    setSoundMode, getSoundMode, playWelcomeGreeting,
    onSchedule, getAudioContext, loadSoundBank,
  };
})();

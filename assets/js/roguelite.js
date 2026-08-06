'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   ROGUELITE MODE — double-bass practice as a punishment loop.

   A bolt-on over the existing metronome/ramp engine. The player runs the BPM
   ramp; every kick is detected via Web MIDI and timing-compared against the
   click grid. One bad hit (or one missing hit) ends the run. Reaching the
   level's BPM ceiling cleanly completes it.

   This module does NOT rebuild the tempo/ramp engine. It hooks into it:
     - MetronomeEngine.onSchedule()  → precise per-tick times (audio clock)
     - MetronomeEngine.getAudioContext() → the shared audio clock
     - window.AppRamp.*               → start/stop/read the existing ramp
     - document 'ramp:start|bpmchange|setcomplete|complete|stop' events → ramp lifecycle

   ─────────────────────────────────────────────────────────────────────────
   THE CALIBRATION PRINCIPLE (read before touching detection math):

   The browser CANNOT measure hardware/MIDI-transport latency. event.timeStamp
   is just the moment the browser received the MIDI message, on the same clock
   that schedules the click. We see ONE number — the gap between when the click
   should have sounded and when the event arrived — and cannot decompose it into
   "hardware latency" vs "player error".

   So we don't try. We subtract the TOTAL systematic offset:
     - Hardware/transport latency is ~constant on every hit.
     - Player timing error is variable, different every hit.
     - Averaging many hits preserves the constant (hardware + habitual bias) and
       partially cancels the centered variable part.
     - We subtract that whole mean. What remains for the run to test is the
       hit-to-hit VARIANCE, which is pure skill.

   KNOWN LIMITATION: if a trigger module has *jittery* (non-constant) latency,
   that jitter is indistinguishable from skill variance and counts against the
   player. There is no software fix — it's a gear problem. Most decent modules
   (Roland, Alesis, ddrum) are tight enough that this is negligible.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Timing math: consume Core's TimingMath / RL_TimingMath (core/js/timing-math.js).
   Do not redeclare those identifiers — classic scripts share one let/const scope. */

/* ───────────────────────────────────────────────────────────────────────────
   THE FEATURE
   ─────────────────────────────────────────────────────────────────────────── */
const RogueliteMode = (() => {
  const {
    audioToPerfMs, perfMsToAudio, classifySlot, classifyFirstSlot,
    rankFor, runResultPct, liveGaugePct,
  } = TimingMath;

  // Challenge levels — the ONLY difficulty knobs, all in one place so they can be
  // tuned against real student data without hunting through logic.
  //   bpmStart   = where the run's ramp begins (overrides Ramp Mode's Starting BPM)
  //   bpmCeiling = top of the level's range; surviving the final set = run complete
  // This is a CONTINUITY game: the run fails only when a 16th is DROPPED (a skip or
  // a frozen foot), not on timing wobble — so the difficulty is purely the tempo
  // (how fast a stream of 16ths you can sustain without dropping one). No per-level
  // timing window any more.
  const LEVELS = {
    1: { bpmStart:  80, bpmCeiling: 100 },
    2: { bpmStart: 100, bpmCeiling: 120 },
    3: { bpmStart: 120, bpmCeiling: 140 },
    4: { bpmStart: 140, bpmCeiling: 160 },
    5: { bpmStart: 160, bpmCeiling: 180 },
    6: { bpmStart: 180, bpmCeiling: 200 },
  };

  // Time Trial / Sudden Death pick a BPM from a fixed ladder: 50–250 in steps of 5
  // (41 buckets). Finer steps because players want to drill at small increments;
  // the resulting leaderboard density is a display concern handled on the stats page.
  // The pure metronome / Ramp / Stopwatch are untouched — still 20–400.
  const GAME_BPM_MIN = 50, GAME_BPM_MAX = 250, GAME_BPM_STEP = 5;
  const GAME_MINS_MIN = 1, GAME_MINS_MAX = 60;
  // Beta access gate for Game Mode (sign-in + claim a 250 spot). Flip to false to
  // disable the gate entirely (Game Mode open to all).
  const BETA_GATE = true;
  let betaOk = false;   // session cache: once a spot is confirmed, don't re-check
  const snapGameBpm = (n) => {
    const v = Math.round(n / GAME_BPM_STEP) * GAME_BPM_STEP;
    return Math.max(GAME_BPM_MIN, Math.min(GAME_BPM_MAX, v));
  };

  // Calibration constants + two-pass state machine live in core/js/calibrator.js.
  const CAL_BEATS = Calibrator.CAL_BEATS;
  const CAL_BPM_DEFAULT = Calibrator.CAL_BPM_DEFAULT;

  // Run constants.
  // Presence gate: each 16th "owns" a slot of ±(this fraction × 16th-spacing). At
  // 0.5 the slots TILE the timeline — a kick lands in exactly one 16th, and a
  // dropped 16th leaves a real, detectable gap. This is the only fail condition.
  const RUN_PRESENCE_FACTOR = 0.5;
  // HUD feedback: a 'clear' hit is GOOD (green) if it landed within this fraction of
  // the slot HALF-WIDTH; beyond it (out to the slot edge) it's neutral and shown as
  // RUSH (early) / DRAG (late). The fraction ramps with tempo: WIDER GOOD at fast
  // tempos (the slot is already tight in ms), NARROWER at slow tempos (a wide slow
  // slot would otherwise read GOOD until you spill into the next slot = BAD, so the
  // rush/drag band would never show). Steps by 20-BPM band.
  function goodFraction(bpm) {
    if (bpm < 60)  return 0.50;
    if (bpm < 80)  return 0.55;
    if (bpm < 100) return 0.60;
    if (bpm < 120) return 0.65;
    if (bpm < 140) return 0.70;
    if (bpm < 160) return 0.75;
    if (bpm < 180) return 0.80;
    return 0.85;
  }
  // The FIRST gated 16th of each set gets a generous early grace (× the slot
  // half-width) so a rushed start isn't orphaned and instantly failed. Early side
  // only — the late edge stays normal so it can't steal the second slot's kick.
  const RUN_FIRST_SLOT_EARLY_MULT = 3;
  const EVAL_MARGIN_MS = 35;           // evaluate a slot this long after it closes
  // Debounce for audio path (MIDI debounce lives in MidiInput).
  const KICK_DEBOUNCE_MS = (typeof MidiInput !== 'undefined' && MidiInput.KICK_DEBOUNCE_MS) || 15;
  const RUN_LEAD_IN_BARS = 2;          // bars 1–2 of every set play ungated (count-in)
  const RUN_REST_SECS = 10;            // fixed rest between sets during a run
  // Fixed climb shape for ALL levels (overrides the user's Ramp Mode settings):
  // 5 sets of 1 minute each, +5 BPM per set. Every level spans exactly 20 BPM, so
  // start + 4×5 = ceiling — the 5th set lands ON the ceiling (e.g. L6: 180·185·
  // 190·195·200) and the run completes by SURVIVING that final set, not by merely
  // reaching the ceiling BPM (see maybeCompleteOnBpm).
  const RUN_NUM_SETS = 5;
  const RUN_BPM_INCREMENT = 5;
  const RUN_SET_MINS = 1;
  const RUN_SET_SECS = 0;
  // A gap between consecutive ticks longer than this means a new set just began
  // (the metronome stops for the between-set rest). Far larger than any in-set gap
  // — slowest case is 80 BPM quarters at 750ms — so it cleanly flags set boundaries.
  const RUN_SEGMENT_GAP_MS = 1500;

  // Per-hit run diagnostics: logs every gated 16th and, on a fail, dumps the nearby
  // kick events. Off for release (flip to true to debug timing/clock issues).
  const RL_DEBUG = false;

  // GM defaults / learn maps — owned by MidiInput.
  const DEFAULT_NOTE = MidiInput.DEFAULT_NOTE;
  const DEFAULT_KICK_NOTE = DEFAULT_NOTE.kick;
  const KICK_LEARN_NOTES = MidiInput.LEARN_NOTES.kick;
  const SNARE_LEARN_NOTES = MidiInput.LEARN_NOTES.snare;
  const INSTR_LABEL = MidiInput.INSTR_LABEL;

  // ── Run / session state ──────────────────────────────────────────────────
  const runState = {
    instrument: null,           // 'kick' | 'snare' — COMPULSORY before a run; keeps boards separate
    inputSource: 'midi',        // 'midi' | 'audio' — how kicks are detected
    audioReady: false,          // audio input started + sensitivity usable
    mode: 'timetrial',          // 'timetrial' | 'suddendeath' (both free BPM+duration) | 'gauntlet'
    level: null,                // 1..6 (gauntlet only)
    subdivision: 'sixteenth',   // gated slot density (see game-subdivisions.js)
    gameBpm: 120,               // game mode: chosen BPM
    gameMins: 3,                // game mode: chosen duration (minutes)
    currentBpm: 0,              // mirrors the existing ramp engine
    meanOffset: 0,              // from calibration; subtracted from every hit
    kickNote: DEFAULT_KICK_NOTE,
    status: 'idle',             // 'idle'|'calibrating'|'running'|'failed'|'complete'
    suddenDeath: false,         // one bad beat ends the run (gauntlet always; game = Challenge)
    diedAtBpm: null,
    survivalSec: 0,             // Sudden Death: gated time survived (capped at the chosen target)
    gatingStartPerf: 0,         // perf-time the first gated beat went live (survival clock origin)
    hitsCleared: 0,             // cleared 16th-note slots this run
    totalRunBeats: 0,           // estimated total gated beats this run (gauge denominator)
    tally: { good: 0, neutral: 0, bad: 0, rush: 0, drag: 0 },   // per-beat verdict counts
    hitLog: [],                 // per-16th timeline: { off, rank } (for the result-card chart)
    runId: null,                // UUID for cloud dedup (generated at run start)
    startedAt: null,            // ISO wall-clock when gated play began
    calibration: null,          // { meanOffset, sd, sampleCount }
    // NOTE: dual-note / per-foot detection is explicitly out of scope for v1.
    // kickNote is a single number today; widening it to a Set later is the only
    // change the MIDI layer would need.
  };

  // ── MIDI layer (core/js/midi-input.js) ─────────────────────────────────────
  // Wire note-ons into the shared kick event buffer; status → UI.
  MidiInput.onNote((perfMs) => { pushKickEvent(perfMs); });
  MidiInput.onStatus((msg, isErr) => { setMidiStatus(msg, isErr); });
  MidiInput.setOnInputsChanged(() => {
    renderDeviceList();
    tryLoadMidiCalibration();
  });

  // ── Clock reconciliation ───────────────────────────────────────────────────
  let sync = null;              // { a0, p0 } captured fresh at each measurement phase

  async function captureSync() {
    const ctx = (typeof MetronomeEngine !== 'undefined') && MetronomeEngine.getAudioContext();
    if (!ctx) return false;

    // The audio clock ONLY advances while the context is 'running'. Sampling
    // currentTime while suspended reads 0, which anchors the sync to a perf time
    // that does NOT correspond to audio-time-0 — a constant clock-origin error.
    // Calibration would bake that constant into meanOffset, but a run captured
    // while the context is already running would NOT share it, so the offset
    // wouldn't transfer and every run window would be mis-centred by that gap
    // (the instant-fail this guards against). So resume first, confirm the clock
    // is actually ticking, THEN sample both clocks together.
    if (ctx.state !== 'running') {
      try { await ctx.resume(); } catch (e) {}
    }
    // A cold context can report 'running' while currentTime is still pinned at 0
    // until audio actually flows (the audio device has to spin up — noticeably
    // slower right after an output-device switch). Play one silent sample to force
    // the render thread to start, which kicks currentTime into advancing.
    try {
      const buf = ctx.createBuffer(1, 1, ctx.sampleRate || 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch (e) {}
    // Wait until the clock is actually ticking (currentTime > 0), capped at ~1s so
    // we never hang. With the kick-start above this is usually a few ms.
    for (let i = 0; i < 200 && ctx.currentTime === 0; i++) {
      await new Promise(r => setTimeout(r, 5));
    }
    // Fail CLOSED: never anchor the sync to a frozen (currentTime === 0) clock.
    // Doing so is the origin-error bug — it silently corrupts every expected time
    // (the "0 hits detected" symptom). Better to bail and let the user retry.
    if (ctx.currentTime === 0) {
      console.error('[roguelite] audio clock never started (currentTime stuck at 0) — retry');
      return false;
    }

    // Sample both clocks as close together as possible.
    const a0 = ctx.currentTime;
    const p0 = performance.now();
    sync = { a0, p0 };
    // Self-check: round-trip a known audio time through both conversions. This
    // catches a domain/formula regression immediately (it will NOT catch a wrong
    // event.timeStamp origin — only real hardware can show that, which is why we
    // also log raw offsets on the first calibration hits).
    const probe = a0 + 0.5;
    const round = perfMsToAudio(audioToPerfMs(probe, sync), sync);
    if (Math.abs(round - probe) > 1e-6) {
      console.error('[roguelite] clock reconciliation round-trip FAILED', { probe, round });
    } else {
      console.info('[roguelite] clock sync captured', sync,
        '(raw kick offsets logged below should be tens of ms, not thousands — ' +
        'if they are huge/constant the timeStamp origin is wrong, see code comment)');
    }
    return true;
  }

  // Re-anchor the audio↔perf map on EVERY scheduled tick. captureSync() takes one
  // sample at the start of a phase; reusing it for ~40s is fragile — if the audio
  // clock stalls even briefly (a device hiccup / momentary suspend) the anchor goes
  // stale and every computed click time is off by the stall, corrupting the whole
  // calibration (the ~160ms offset swings we saw). Sampling (currentTime, now)
  // adjacent inside each tick callback is just as simultaneous as captureSync but
  // immune to long-term drift: a stall can only ever skew one tick, not the session.
  function refreshSync() {
    const ctx = (typeof MetronomeEngine !== 'undefined') && MetronomeEngine.getAudioContext();
    if (ctx && ctx.state === 'running' && ctx.currentTime > 0) {
      sync = { a0: ctx.currentTime, p0: performance.now() };
    }
  }

  // ── Output-latency compensation (opt-in; default off via Settings) ───────────
  // The click is heard ctx.outputLatency after it's scheduled. Calibration bakes
  // the latency-at-cal into meanOffset; if the OS shifts the audio buffer later
  // (laptop power state, load…), that baked offset goes stale. When enabled we
  // re-sync the difference (now − cal) at each set's count-in — a SAFE point where
  // the player isn't being judged — so the window never moves mid-set.
  let latencyCalSec = null;          // ctx.outputLatency captured at calibration
  let latencyCompMs = 0;             // current applied compensation (ms)
  const LAT_COMP_THRESH_MS = 4;      // ignore sub-threshold drift (don't chase noise)
  const LAT_COMP_EASE = 0.35;        // gentle: ease this fraction toward target per set (not a full snap)
  const LAT_COMP_MAX_MS = 50;        // safety clamp: never apply more than ±this
  function currentOutputLatency() {
    const ctx = (typeof MetronomeEngine !== 'undefined') && MetronomeEngine.getAudioContext();
    return (ctx && typeof ctx.outputLatency === 'number' && ctx.outputLatency > 0) ? ctx.outputLatency : null;
  }
  function captureLatencyCal() { const l = currentOutputLatency(); if (l != null) latencyCalSec = l; }
  // Re-read at a safe point (count-in). Holds steady through the gated part of the set.
  function resyncLatencyComp() {
    if (!(window.__latencyCompEnabled && latencyCalSec != null)) { latencyCompMs = 0; return; }
    const l = currentOutputLatency();
    if (l == null) return;
    const target = (l - latencyCalSec) * 1000;
    // Gentle: ease only part of the way toward the new target each set (so it
    // nudges rather than jumps), and clamp so a bad reading can't skew timing.
    if (Math.abs(target - latencyCompMs) > LAT_COMP_THRESH_MS) {
      latencyCompMs += (target - latencyCompMs) * LAT_COMP_EASE;
    }
    latencyCompMs = Math.max(-LAT_COMP_MAX_MS, Math.min(LAT_COMP_MAX_MS, latencyCompMs));
    window.__latencyDebug = { outMs: +(l * 1000).toFixed(1), calMs: +(latencyCalSec * 1000).toFixed(1), compMs: +latencyCompMs.toFixed(1), targetMs: +target.toFixed(1) };
  }
  // Calibration offset + (optional) live latency compensation. Used for run gating.
  function effectiveOffset() {
    return runState.meanOffset + ((window.__latencyCompEnabled && latencyCalSec != null) ? latencyCompMs : 0);
  }

  // ── Kick event buffer ────────────────────────────────────────────────────
  // Each entry: { t (perf ms), consumed }. Shared by calibration and runs; reset
  // when each phase begins. Old entries are purged during runs to bound growth.
  let events = [];
  let lastKickTs = -Infinity;   // perf ms of the last ACCEPTED kick (for debounce)

  function pushKickEvent(perfMs) {
    events.push({ t: perfMs, consumed: false });
  }

  // ── DOM refs (populated in initUI) ─────────────────────────────────────────
  let el = {};
  let applyGameModeToggle = null;

  // ───────────────────────────────────────────────────────────────────────────
  // MIDI  (delegates to window.MidiInput)
  // ───────────────────────────────────────────────────────────────────────────

  function persistMidiCalibration() {
    const selectedInputId = MidiInput.getInputId();
    if (runState.inputSource !== 'midi' || !selectedInputId || !runState.calibration) return;
    if (runState.calibration.manual) return;
    if (!window.CalibrationStore) return;
    const midiInputs = MidiInput.getInputs();
    const dev = midiInputs.find(i => i.id === selectedInputId);
    CalibrationStore.save(selectedInputId, dev ? dev.name : selectedInputId, runState.calibration);
  }

  function tryLoadMidiCalibration() {
    if (runState.inputSource !== 'midi') return;
    const selectedInputId = MidiInput.getInputId();
    if (!selectedInputId || runState.status === 'calibrating' || runState.status === 'running') return;
    if (runState.calibration && runState.calibration.manual) return;
    const midiInputs = MidiInput.getInputs();
    if (!midiInputs.some(i => i.id === selectedInputId)) {
      runState.calibration = null;
      runState.meanOffset = 0;
      updateGates();
      return;
    }
    if (!window.CalibrationStore) { updateGates(); return; }
    const dev = midiInputs.find(i => i.id === selectedInputId);
    const stored = CalibrationStore.get(selectedInputId, dev ? dev.name : '');
    if (!stored || !stored.calibration) {
      runState.calibration = null;
      runState.meanOffset = 0;
      updateGates();
      return;
    }
    runState.calibration = { ...stored.calibration };
    runState.meanOffset = stored.calibration.meanOffset;
    captureLatencyCal();
    setStatus(el.calStatus,
      'Loaded saved calibration for ' + (dev ? dev.name : 'device') + ' — offset ' +
      signed(runState.meanOffset) + 'ms.', false);
    updateGates();
  }

  async function enableMidi() {
    await MidiInput.requestAccess();
  }

  function selectInput(id) {
    MidiInput.setInputId(id);
    tryLoadMidiCalibration();
  }

  function learnKick() {
    if (!runState.instrument) { setMidiStatus('Pick a drum (Kick or Snare) first.', true); return; }
    if (!MidiInput.hasAccess()) { setMidiStatus('Connect MIDI first.', true); return; }
    const learnNotes = runState.instrument === 'kick' ? KICK_LEARN_NOTES : SNARE_LEARN_NOTES;
    el.kickNote && (el.kickNote.textContent = 'Hit your ' + instrLabel().toLowerCase()
      + ' (MIDI notes ' + learnNotes.join(', ') + ')…');
    MidiInput.startLearn({
      allowedNotes: learnNotes,
      onLearned: (note) => {
        runState.kickNote = note;
        el.kickNote && (el.kickNote.textContent = instrLabel() + ' note: ' + note);
        updateGates();
      },
      onReject: () => {
        setMidiStatus(instrLabel() + ' learn only accepts MIDI notes ' + learnNotes.join(', ') + '. Hit your pad.', true);
      },
    });
  }

  // Current drum label ('Kick' | 'Snare'); falls back to 'Note' before a choice.
  function instrLabel() { return INSTR_LABEL[runState.instrument] || 'Note'; }

  // Compulsory drum choice. Sets the GM default note for that drum (until learned),
  // updates labels/gates. Switching drum resets the listened note to the default.
  function selectInstrument(instr) {
    if (instr !== 'kick' && instr !== 'snare') return;
    runState.instrument = instr;
    MidiInput.setInstrument(instr);
    runState.kickNote = MidiInput.getInstrumentNote();
    el.instrBtns && el.instrBtns.forEach(b => b.classList.toggle('active', b.dataset.instr === instr));
    el.kickNote && (el.kickNote.textContent = instrLabel() + ' note: ' + runState.kickNote + ' (default)');
    setMidiStatus(MidiInput.hasAccess()
      ? 'Now learn your ' + instrLabel().toLowerCase() + " note, or use the default."
      : 'Connect MIDI, then learn your ' + instrLabel().toLowerCase() + ' note.');
    updateGates();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // INPUT SOURCE  (MIDI vs Audio)
  // ───────────────────────────────────────────────────────────────────────────
  let sensitivityArmed = false;     // true while "set sensitivity" is listening
  let sensHits = 0;                 // onsets seen during sensitivity calibration
  let sensLevels = [];              // meter levels seen during it (to estimate the noise floor)
  let hitPeak = 0;                  // running peak of the hit currently being judged
  let hitCapturing = false;         // true during the ~90ms peak-capture window
  let gainTimer = null;             // pending verdict-latch timer
  const AUDIO_DEFAULT_THRESHOLD = 0.03;

  // Switch between MIDI and Audio. Offset calibration is per-source (the audio path
  // has different latency), so switching invalidates it — you recalibrate.
  function selectInputSource(src) {
    src = (src === 'audio') ? 'audio' : 'midi';
    if (src === runState.inputSource) { reflectInputSource(); return; }
    runState.inputSource = src;
    runState.calibration = null;      // per-source latency → must recalibrate
    if (src === 'midi' && window.AudioInput) { try { AudioInput.stop(); } catch (e) {} runState.audioReady = false; }
    reflectInputSource();
    if (src === 'midi') tryLoadMidiCalibration();
    else updateGates();
  }

  function reflectInputSource() {
    const audio = runState.inputSource === 'audio';
    el.inputBtns && el.inputBtns.forEach(b => b.classList.toggle('active', b.dataset.src === runState.inputSource));
    if (el.midiSteps)  el.midiSteps.style.display  = audio ? 'none' : '';
    if (el.audioSteps) el.audioSteps.style.display = audio ? '' : 'none';
    if (!audio) {
      const blocked = MidiInput.unavailableReason();
      if (blocked) setMidiStatus(blocked, true);
    }
  }

  // Open the audio interface/mic and start onset detection. Onsets feed the SAME
  // event buffer MIDI uses (pushKickEvent), in the perf-clock domain.
  async function enableAudio() {
    if (!runState.instrument) { setAudioStatus('Pick a drum (Kick or Snare) first.', true); return; }
    if (!window.AudioInput || !AudioInput.supported()) { setAudioStatus('Audio input not supported in this browser.', true); return; }
    MetronomeEngine.init();
    const ctx = MetronomeEngine.getAudioContext();
    const deviceId = el.audioDeviceSelect ? el.audioDeviceSelect.value : '';
    setAudioStatus('Starting…');
    const ok = await AudioInput.start(ctx, deviceId, {
      onOnset: onAudioOnset,
      onLevel: onAudioLevel,
      onError: (m) => { runState.audioReady = false; setAudioStatus(m, true); updateGates(); },
    });
    if (!ok) return;
    AudioInput.setThreshold(AUDIO_DEFAULT_THRESHOLD);
    runState.audioReady = true;
    await refreshAudioDevices();   // labels appear once permission is granted
    setAudioStatus('Listening. Hit your ' + instrLabel().toLowerCase() + ' — then set sensitivity.');
    updateGates();
  }

  async function refreshAudioDevices() {
    if (!el.audioDeviceSelect || !window.AudioInput) return;
    const devs = await AudioInput.listDevices();
    const cur = el.audioDeviceSelect.value;
    el.audioDeviceSelect.innerHTML = '';
    devs.forEach(d => {
      const o = document.createElement('option');
      o.value = d.deviceId; o.textContent = d.label;
      el.audioDeviceSelect.appendChild(o);
    });
    if (cur) el.audioDeviceSelect.value = cur;
    el.audioDeviceSelect.style.display = devs.length ? '' : 'none';
  }

  // Live onset during setup: flash the meter + count; if arming sensitivity, collect
  // the peak. During calibration/run it also feeds the detection buffer.
  function onAudioOnset(perfMs, peak) {
    if (sensitivityArmed) {
      sensHits++;
      setAudioStatus('Sensitivity: ' + sensHits + ' hits — keep going (any volume)…');
    }
    if (el.audioMeter) { el.audioMeter.classList.add('hit'); setTimeout(() => el.audioMeter && el.audioMeter.classList.remove('hit'), 90); }

    // Capture this hit's true peak over a short window after the attack, then LATCH
    // the gain verdict (text + peak tick) to it — so a hot/clip reading stays put
    // until the next hit re-judges, instead of fading back to green as it decays.
    hitPeak = Math.max(hitPeak, peak);
    hitCapturing = true;
    if (!gainTimer) {
      gainTimer = setTimeout(() => {
        gainTimer = null; hitCapturing = false;
        setGainVerdict(hitPeak);
        hitPeak = 0;
      }, 90);
    }

    // Debounce (worklet already masks retriggers; this guards the shared buffer).
    if (perfMs - lastKickTs < KICK_DEBOUNCE_MS) return;
    lastKickTs = perfMs;
    pushKickEvent(perfMs);
  }

  function onAudioLevel(peak) {
    if (sensitivityArmed) sensLevels.push(peak);   // sample the level (incl. the quiet between hits)
    if (hitCapturing && peak > hitPeak) hitPeak = peak;
    // Live level bar (full-scale 0→1; right edge = clipping). The verdict/tick are
    // latched per-hit in setGainVerdict, not here.
    if (el.audioMeterFill) el.audioMeterFill.style.width = Math.max(0, Math.min(100, peak * 100)) + '%';
  }

  // Latched gain-staging verdict for the last hit's peak. Good ceiling = 70%.
  function setGainVerdict(level) {
    let msg, cls;
    if (level < 0.10)      { msg = 'Low — raise your interface gain for a stronger signal.'; cls = ''; }
    else if (level < 0.70) { msg = 'Good level ✓ — your hits sit in the green.'; cls = 'good'; }
    else if (level < 0.95) { msg = 'Hot — ease the interface gain down a little.'; cls = 'hot'; }
    else                   { msg = 'Clipping — turn the gain down (distortion hurts detection).'; cls = 'clip'; }
    if (el.audioGain) {
      el.audioGain.textContent = msg;
      el.audioGain.className = 'rogue-gain-hint' + (cls ? ' ' + cls : '');
    }
    if (el.audioMeterPeak) {
      el.audioMeterPeak.style.left = Math.min(100, level * 100) + '%';
      el.audioMeterPeak.className = 'rogue-meter-peak' + (cls ? ' ' + cls : '');
    }
  }

  // Sensitivity = set the noise GATE just above the quiet level (the floor), NOT
  // relative to how hard you hit. So calibration volume doesn't matter and you keep
  // the full dynamic range in-game — soft ghost notes through loud accents all
  // register. (Ring rejection is handled separately by the worklet's mask curve.)
  function setSensitivity() {
    if (!runState.audioReady) { setAudioStatus('Enable audio first.', true); return; }
    sensHits = 0;
    sensLevels = [];
    sensitivityArmed = true;
    setAudioStatus('Hit your ' + instrLabel().toLowerCase() + ' for 8 seconds (any volume, leave a little space between hits)…');
    setTimeout(() => {
      sensitivityArmed = false;
      if (sensHits < 3) { setAudioStatus('Only ' + sensHits + ' clear hits — turn up your interface gain or hit a bit harder, then retry.', true); return; }
      // Noise floor = a low percentile of the observed levels (the quiet between hits).
      const sorted = sensLevels.slice().sort((a, b) => a - b);
      const floor = sorted.length ? sorted[Math.floor(sorted.length * 0.2)] : 0;
      const thresh = Math.max(0.012, floor * 3);   // a touch above the floor; rejects noise, passes soft hits
      AudioInput.setThreshold(thresh);
      setAudioStatus('Set — soft and loud hits both register now. Calibrate, then run.');
      updateGates();
    }, 8000);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CALIBRATION — TWO SEPARATE STEPS (orchestration via core/js/calibrator.js):
  //   Step 1 (quarters, REQUIRED): play QUARTERS → the gross offset.
  //   Step 2 (16ths, OPTIONAL): play 16ths → refined pocket + drift.
  // Skip both and type a known offset instead (see applyManualOffset).
  // ───────────────────────────────────────────────────────────────────────────
  let cal = null;

  function ensureCalibrator() {
    if (cal) return cal;
    cal = Calibrator.create({
      getMetronome: () => (typeof MetronomeEngine !== 'undefined' ? MetronomeEngine : null),
      getSync: () => sync,
      refreshSync,
      getEvents: () => events,
      clearEvents: () => { events = []; },
      getGrossOffset: () => (runState.calibration && runState.calibration.grossOffset != null)
        ? runState.calibration.grossOffset : 0,
      onStatusBanner: (msg, cls) => setStatusBanner(el.calStatus, msg, cls),
      onComplete: (result) => {
        runState.status = 'idle';
        runState.meanOffset = result.meanOffset;
        runState.calibration = {
          meanOffset: result.meanOffset,
          sd: result.sd,
          sampleCount: result.sampleCount,
          grossOffset: result.grossOffset,
          drift: result.drift || 0,
          refined: !!result.refined,
        };
        captureLatencyCal();
        persistMidiCalibration();
        if (result.pass === 1) {
          console.info('[roguelite] cal quarters gross offset:', signed(result.meanOffset) +
            'ms (' + result.sampleCount + ' hits)');
          setStatus(el.calStatus, 'Quarters calibrated @ ' + result.bpm + ' BPM. Offset ' +
            signed(result.meanOffset) + 'ms (subtracted). Optional: refine your 16th pocket.', false);
        } else {
          const drift = result.drift || 0;
          const dir = drift < 0 ? 'rushing' : 'dragging';
          setStatus(el.calStatus,
            'Pocket refined @ ' + result.bpm + ' BPM 16ths. Offset ' + signed(result.meanOffset) +
            'ms (subtracted). 16ths ' + dir + ' ' + Math.abs(drift).toFixed(0) +
            'ms vs quarters · consistency ±' + result.sd.toFixed(0) + 'ms over ' +
            result.sampleCount + ' hits.', false);
        }
        updateGates();
      },
      onFail: (msg, meta) => {
        runState.status = 'idle';
        const isStop = meta && meta.stopped;
        setStatus(el.calStatus, msg, !isStop);
        updateGates();
      },
      evalMarginMs: EVAL_MARGIN_MS,
    });
    return cal;
  }

  // Shared setup for either calibration step. Returns false if it couldn't start.
  async function beginCalStep() {
    if (typeof MetronomeEngine === 'undefined') return false;
    if (!runState.instrument) { setMidiStatus('Pick a drum (Kick or Snare) first.', true); return false; }
    if (runState.kickNote == null) { setMidiStatus('Learn your note first.', true); return false; }
    if (window.AppRamp && window.AppRamp.isRunning()) window.AppRamp.stop();
    MetronomeEngine.init();
    if (!(await captureSync())) { setCalStatus('Audio not ready — try again.', true); return false; }
    MetronomeEngine.setBeatsPerMeasure(CAL_BEATS);
    MetronomeEngine.setSubdivision('quarter');   // audible quarter pulse for both steps
    runState.status = 'calibrating';
    return true;
  }

  // Step 1 (required): quarters → gross offset.
  async function startCalQuarters() {
    if (!(await beginCalStep())) return;
    if (!ensureCalibrator().startPass1(parseIntOr(el.cal16Bpm, CAL_BPM_DEFAULT))) {
      runState.status = 'idle';
      setCalStatus('Could not start calibration.', true);
    }
    updateGates();
  }

  // Step 2 (optional): 16ths → refined pocket. Needs a gross offset (from step 1 or a
  // manually-entered offset) to de-alias against.
  async function startCal16() {
    if (!runState.calibration || runState.calibration.grossOffset == null) {
      setCalStatus('Calibrate the quarters offset first (or enter an offset).', true);
      return;
    }
    if (!(await beginCalStep())) return;
    if (!ensureCalibrator().startPass2(parseIntOr(el.cal16Bpm, CAL_BPM_DEFAULT))) {
      runState.status = 'idle';
      setCalStatus('Could not start calibration.', true);
    }
    updateGates();
  }

  // Skip calibration: a returning player who knows their hardware offset can type
  // it in directly. Sets the same state a finished calibration would (sampleCount 0
  // marks it manual, so the cards show consistency as '—').
  function applyManualOffset() {
    const v = el.manualOffset ? parseFloat(el.manualOffset.value) : NaN;
    if (!isFinite(v)) { setStatus(el.calStatus, 'Enter your offset in ms (a number, e.g. 102).', true); return; }
    runState.meanOffset = v;
    runState.calibration = { meanOffset: v, sd: 0, sampleCount: 0, grossOffset: v, drift: 0, manual: true };
    captureLatencyCal();
    setStatus(el.calStatus, 'Manual offset ' + signed(v) + 'ms applied — calibration skipped.', false);
    updateGates();
  }

  function abortCalibration(msg, isErr) {
    if (cal && cal.isActive()) cal.stop(msg);
    else {
      if (typeof MetronomeEngine !== 'undefined') {
        MetronomeEngine.onSchedule(null);
        MetronomeEngine.stop();
      }
      events = [];
      runState.status = 'idle';
      setStatus(el.calStatus, msg, isErr !== false);
      updateGates();
    }
  }

  // User pressed Stop during calibration.
  function stopCalibration() {
    if (runState.status !== 'calibrating') return;
    abortCalibration('Calibration stopped.', false);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // RUN  (reuses the existing ramp engine; gates every scheduled tick)
  // ───────────────────────────────────────────────────────────────────────────
  let pendingEvalTimers = [];
  let runBarCount = 0;        // bars seen in the current set (for the lead-in)
  let runGating = false;      // false during the lead-in, true once hits are gated
  let lastTickPerf = 0;       // perf-time of the previous run tick (for set-boundary gap detection)
  let pendingFirstGated = false;  // true → the next evaluated slot is a set's first (lenient)

  async function startRun() {
    if (runState.calibration == null) { setRunStatus('Calibrate first.', true); return; }
    if (!window.AppRamp) { setRunStatus('Ramp engine unavailable.', true); return; }
    if (runState.mode === 'gauntlet' && runState.level == null) {
      setRunStatus('Pick a level first.', true); return;
    }

    runState.hitsCleared = 0;
    runState.tally = { good: 0, neutral: 0, bad: 0, rush: 0, drag: 0 };
    runState.hitLog = [];
    runState.diedAtBpm = null;
    runState.survivalSec = 0;
    runState.gatingStartPerf = 0;
    runState.runId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID() : ('run-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    runState.startedAt = null;
    runState.status = 'running';
    window.__rogueSuppressDoneOverlay = false;
    window.__rogueSuppressCompleteCue = true;   // GameSfx owns completion audio for game runs

    events = [];
    clearPendingEvals();
    runBarCount = 0;
    runGating = false;
    lastTickPerf = 0;
    pendingFirstGated = false;

    // A run fully defines its own session by driving the existing Ramp Mode inputs
    // (the unchanged ramp engine reads them).
    const setInput = (id, val) => { const e = document.getElementById(id); if (e) e.value = String(val); };
    if (runState.mode === 'gauntlet') {
      // GAUNTLET: the level's fixed climb — start at bpmStart, +5 BPM across 5
      // one-minute sets, landing on the ceiling for the final set. Always sudden death.
      const level = LEVELS[runState.level];
      runState.suddenDeath = true;
      setInput('startBpm',     level.bpmStart);
      setInput('numSets',      RUN_NUM_SETS);
      setInput('bpmIncrement', RUN_BPM_INCREMENT);
      setInput('setMins',      RUN_SET_MINS);
      setInput('setSecs',      RUN_SET_SECS);
      setInput('restMins', 0);
      setInput('restSecs', RUN_REST_SECS);
      // Gauge denominator: sum of (set minutes × set BPM = quarter-beats) over all sets.
      let tb = 0;
      for (let i = 0; i < RUN_NUM_SETS; i++) tb += RUN_SET_MINS * (level.bpmStart + i * RUN_BPM_INCREMENT);
      runState.totalRunBeats = tb;
    } else {
      // TIME TRIAL / SUDDEN DEATH: one set at the chosen BPM (snapped to the 60–240
      // ladder) for the chosen duration. No climb. Sudden death ends on one bad beat
      // and scores survival time; time trial never fails and is graded E–SS.
      const bpm  = snapGameBpm(runState.gameBpm);
      const mins = Math.max(GAME_MINS_MIN, Math.min(GAME_MINS_MAX, runState.gameMins || 3));
      runState.gameBpm = bpm;
      runState.gameMins = mins;
      runState.suddenDeath = (runState.mode === 'suddendeath');
      setInput('startBpm',     bpm);
      setInput('numSets',      1);
      setInput('bpmIncrement', 0);
      setInput('setMins',      mins);
      setInput('setSecs',      0);
      setInput('restMins', 0);
      setInput('restSecs', 0);
      runState.totalRunBeats = mins * bpm;   // minutes × quarter-beats-per-minute
    }

    // Fresh clock reconciliation for this run (don't trust a sync captured back
    // at calibration time — recapture so audio↔perf is current).
    MetronomeEngine.init();
    if (!(await captureSync())) { runState.status = 'idle'; setRunStatus('Audio not ready — try again.', true); return; }

    // Audible click is a QUARTER-note pulse; the run subdivides each quarter into
    // four 16ths internally and gates each (see onRunTick). So keep the engine on
    // quarters — the player hears a clean quarter pulse while every 16th-note kick
    // is still tested. (Calibration also runs in quarters; the systematic offset
    // it measures is subdivision-independent.)
    MetronomeEngine.setSubdivision('quarter');

    // Subscribe to the click grid and kick off the existing ramp. ramp:start
    // (dispatched by app.js) confirms the run is live and gives us the start BPM.
    MetronomeEngine.onSchedule(onRunTick);
    enterHud();   // captures Ramp toggle state, then transforms the page into the HUD
    const ok = window.AppRamp.startRampSession();
    if (!ok) {
      MetronomeEngine.onSchedule(null);
      exitHud();
      runState.status = 'idle';
      setRunStatus('Could not start the ramp — check your Ramp Mode settings.', true);
      return;
    }
    let where;
    if (runState.mode === 'gauntlet') {
      where = 'Gauntlet L' + runState.level + ' · ' + LEVELS[runState.level].bpmStart + '–' +
        LEVELS[runState.level].bpmCeiling + ' BPM · ' +
        (typeof GameSubdivisions !== 'undefined' ? GameSubdivisions.labelFor(runState.subdivision) : '16th notes');
    } else {
      where = (runState.mode === 'suddendeath' ? 'Sudden Death' : 'Time Trial') +
        ' · ' + runState.gameBpm + ' BPM · ' + runState.gameMins + ' min · ' +
        (typeof GameSubdivisions !== 'undefined' ? GameSubdivisions.labelFor(runState.subdivision) : '16th notes');
    }
    setRunStatus(where + ' — ' + RUN_LEAD_IN_BARS + '-bar count-in, then ' +
      (typeof GameSubdivisions !== 'undefined' ? GameSubdivisions.playBanner(runState.subdivision) : 'Play 16ths') + '.');
    updateGates();
  }

  function onRunTick(tickTimeSec, soundType, beatIndex, tickInBeat) {
    if (runState.status !== 'running') return;
    refreshSync();                 // fresh audio↔perf anchor for this tick (drift-proof)
    const expectedPerf = audioToPerfMs(tickTimeSec, sync);

    // New set? Either the very first tick of the run, or the first tick after a
    // between-set rest (the metronome is stopped through the 10s rest, so there's
    // a multi-second gap). Every set gets its own fresh 2-bar count-in. Detecting
    // this here — off the actual tick stream — avoids racing the ramp's
    // start()/event ordering, and works even if two sets share a BPM.
    const firstTickOfRun = (lastTickPerf === 0);
    const newSet = firstTickOfRun || (expectedPerf - lastTickPerf) > RUN_SEGMENT_GAP_MS;
    lastTickPerf = expectedPerf;
    if (newSet) {
      runBarCount = 0;
      runGating = false;
      events = [];
      hudBeatRank = [0, 0, 0, 0];
      hudBeatOff  = [0, 0, 0, 0];
      resyncLatencyComp();   // safe point: re-read output latency before this set is gated
      // (The set countdown is held in maybeCompleteOnBpm — the ramp:start/bpmchange
      // handler — which fires after the timer exists; doing it here is too early.)
    }

    // Lead-in: the player can't be locked in on beat 1. Bars 1–2 of the set play
    // ungated as a count-in; gating starts on the downbeat of bar 3. A bar
    // boundary is the bar's first tick (downbeat): beatIndex 0, tickInBeat 0.
    // (The new-set tick above IS that set's first downbeat, so it counts as bar 1.)
    if (beatIndex === 0 && tickInBeat === 0) {
      runBarCount++;
      if (!runGating) {
        if (runBarCount <= RUN_LEAD_IN_BARS) {
          setRunBanner('COUNT-IN ' + runBarCount + ' / ' + RUN_LEAD_IN_BARS, 'countin');
          setHudVerdict(-1, 0, 'READY');
        } else {
          runGating = true;
          // Drop any kicks played during the count-in so they can't be matched
          // against the first gated tick.
          events = [];
          pendingFirstGated = true;   // first scored 16th of this set gets early grace
          // Start the survival clock on the first gated beat of the run (used by
          // Sudden Death). Only the first set arms it; later sets don't reset it.
          if (!runState.gatingStartPerf) {
            runState.gatingStartPerf = performance.now();
            runState.startedAt = new Date().toISOString();
          }
          // Count-in over — NOW start the set's 1-minute clock (see AppRamp hooks).
          if (window.AppRamp && window.AppRamp.beginSetCountdown) window.AppRamp.beginSetCountdown();
          setRunBanner(typeof GameSubdivisions !== 'undefined'
            ? GameSubdivisions.playBanner(runState.subdivision) : 'Play 16ths', 'live');
          refreshHudBpm();
        }
      }
    }
    if (!runGating) return;   // still counting in — don't gate these ticks

    // The audible click is a QUARTER-note pulse (engine runs in quarters), but the
    // run TESTS 16th notes — continuous double-bass. Subdivide this quarter into its
    // four 16ths and require a kick in each. Continuity game: the slot is ±half the
    // 16th spacing, so the 16ths TILE the timeline — timing wobble inside the slot
    // is fine; only a DROPPED 16th (empty slot = a skip / frozen foot) ends the run.
    const bpm = currentRunBpm();
    const ticks = runTicksPerBeat();
    const slotMs = 60000 / bpm / ticks;
    const presenceMs = slotMs * RUN_PRESENCE_FACTOR;
    const goodMs = presenceMs * goodFraction(bpm);   // GOOD vs RUSH/DRAG threshold (tempo-aware)
    const slotSec = slotMs / 1000;
    // Offset for this whole tick (calibration + any latency compensation). Captured
    // once and passed through so the eval timer and the classify centre always agree.
    const runOffset = effectiveOffset();
    for (let k = 0; k < ticks; k++) {
      const subPerf = audioToPerfMs(tickTimeSec + k * slotSec, sync);
      // Evaluate after the (offset-shifted) slot closes — classifySlot centres it at
      // subPerf + runOffset, so the eval timer must wait out runOffset too.
      const evalAt = subPerf + runOffset + presenceMs + EVAL_MARGIN_MS;
      const delay = Math.max(0, evalAt - performance.now());
      pendingEvalTimers.push(setTimeout(() => evaluateHit(subPerf, presenceMs, goodMs, beatIndex, k, ticks - 1, runOffset), delay));
    }
  }

  function evaluateHit(expectedPerf, presenceMs, goodMs, beatIndex, subslotIdx, lastSubslotIdx, offset) {
    if (runState.status !== 'running') return;
    if (!runGating) return;
    if (offset == null) offset = runState.meanOffset;

    // The first scored 16th of each set is lenient on the early side (a rushed start
    // would otherwise be orphaned → instant drop). Every other slot: exactly one
    // kick — 0 = 'drop', 1 = 'clear', 2+ = 'cram'.
    const firstGated = pendingFirstGated;
    pendingFirstGated = false;
    const c = firstGated
      ? classifyFirstSlot(expectedPerf, offset, presenceMs, events,
          presenceMs * RUN_FIRST_SLOT_EARLY_MULT)
      : classifySlot(expectedPerf, offset, presenceMs, events);

    // Verdict for this 16th: 0 = good (well inside the slot), 1 = neutral (rode the
    // edge — signed offset gives RUSH/DRAG), 2 = bad (drop/cram). The lenient first
    // slot, when present, always scores GOOD. A beat takes the WORST of its four.
    let rank, off = 0;
    if (c.result === 'clear') {
      off = c.offset;
      rank = firstGated ? 0 : ((Math.abs(off) > goodMs) ? 1 : 0);
    } else if (c.result === 'cram' && runState.inputSource === 'audio') {
      // Audio mode is PRESENCE-ONLY: a mic can double-trigger (beater bounce, snare
      // ring), and we can't reliably tell that from a real fast double — so extra
      // hits in a slot count as present (a clear), never a fail. Only a DROP fails.
      // (MIDI keeps the strict 'cram' rule below, since its events are clean.)
      off = (c.offset != null) ? c.offset : 0;
      rank = (Math.abs(off) > goodMs) ? 1 : 0;
    } else {
      rank = 2;
    }
    if (subslotIdx === 0) { hudBeatRank[beatIndex] = rank; hudBeatOff[beatIndex] = off; }
    else if (rank > hudBeatRank[beatIndex]) { hudBeatRank[beatIndex] = rank; hudBeatOff[beatIndex] = off; }
    else if (rank === 1 && hudBeatRank[beatIndex] === 1 && Math.abs(off) > Math.abs(hudBeatOff[beatIndex])) {
      hudBeatOff[beatIndex] = off;   // keep the most extreme neutral direction this beat
    }
    setHudVerdict(hudBeatRank[beatIndex], hudBeatOff[beatIndex]);

    // Timeline log: one entry per evaluated 16th, for the result-card chart. A drop
    // has no timing offset (nothing landed) → off=null so the chart can mark a gap.
    runState.hitLog.push({ rank, off: (c.result === 'clear' || (c.result === 'cram' && c.offset != null)) ? off : null });

    // Consume matched kicks so they can't satisfy later slots. (In audio mode a
    // 'cram' is a present slot — count it cleared and consume all its hits.)
    if (c.result === 'clear') { events[c.indices[0]].consumed = true; runState.hitsCleared++; }
    else if (c.result === 'cram') {
      c.indices.forEach(i => { events[i].consumed = true; });
      if (runState.inputSource === 'audio' && rank !== 2) runState.hitsCleared++;
    }

    if (RL_DEBUG) {
      const centre = expectedPerf + offset;
      const near = events
        .map(e => ({ off: +(e.t - centre).toFixed(1), consumed: e.consumed }))
        .filter(e => Math.abs(e.off) <= 250)
        .sort((a, b) => Math.abs(a.off) - Math.abs(b.off));
      console.info('[rl]', c.result.toUpperCase(), 'count=' + c.count,
        'off=' + (c.offset != null ? c.offset.toFixed(1) : '—'),
        'slot±' + presenceMs.toFixed(0) + 'ms @' + currentRunBpm() + 'bpm',
        'cleared=' + runState.hitsCleared);
      if (c.result !== 'clear') {
        console.warn('[rl] ' + c.result.toUpperCase() +
          ' — nearby events (ms from slot centre):', near);
      }
    }

    // Sudden death (Challenge / Gauntlet): a bad beat ends the run immediately.
    if (rank === 2 && runState.suddenDeath) {
      addLaneCell('rogue-bad');
      runState.tally.bad++;
      failRun(c);   // 'drop' (skip/freeze) or 'cram' (over-rush)
      return;
    }

    // Otherwise the run continues. At beat completion, append the lane cell and
    // tally the beat by its worst 16th (rush/drag split for neutral).
    if (subslotIdx === lastSubslotIdx) {
      tallyBeat(hudBeatRank[beatIndex], hudBeatOff[beatIndex]);
      addLaneCell(verdictClass(hudBeatRank[beatIndex], hudBeatOff[beatIndex]));
    }
    updateScoreHud();
    // Purge consumed/stale events a few slots behind the current expected time.
    pruneEvents(expectedPerf - presenceMs * (lastSubslotIdx + 1));
  }

  function tallyBeat(rank, off) {
    const t = runState.tally;
    if (rank === 2) { t.bad++; return; }
    if (rank === 1) { t.neutral++; if (off < 0) t.rush++; else t.drag++; return; }
    t.good++;
  }

  function pruneEvents(beforePerf) {
    if (events.length < 64) return;
    events = events.filter(e => !e.consumed && e.t >= beforePerf);
  }

  // Survival = gated time elapsed since the first gated beat, capped at the chosen
  // target (so dying at 4:36 of a 5:00 run records 4:36; surviving the full run
  // records the target). Picking a longer target raises the ceiling on this score.
  function recordSurvival() {
    if (!runState.gatingStartPerf) { runState.survivalSec = 0; return; }
    const elapsed = (performance.now() - runState.gatingStartPerf) / 1000;
    const cap = (runState.mode === 'gauntlet') ? Infinity : runState.gameMins * 60;
    runState.survivalSec = Math.max(0, Math.min(cap, elapsed));
  }

  function failRun(classification) {
    if (runState.status !== 'running') return;
    runState.status = 'failed';
    runState.diedAtBpm = currentRunBpm();
    recordSurvival();
    clearPendingEvals();
    MetronomeEngine.onSchedule(null);
    if (window.AppRamp) window.AppRamp.stop();   // stop the ramp; NOT the level-up path

    // Fail cue: reuse the existing set-end cue as the closest "stop" sound the
    // app owns (there is no dedicated game-over asset in this build).
    try { MetronomeEngine.playSetEndCue(); } catch (e) {}

    saveRunRecord().finally(() => {
      showGameOver(classification);
      updateGates();
    });
  }

  // The ramp finished cleanly on its own (ran out of sets) before reaching the
  // ceiling. finishSession() in app.js has ALREADY played the completion cue and
  // is about to (synchronously) read __rogueSuppressDoneOverlay — so here we just
  // claim the completion and suppress the default overlay. Do NOT stop the ramp
  // again or replay the cue.
  function onRampComplete() {
    if (runState.status !== 'running') return;
    window.__rogueSuppressDoneOverlay = true;   // stays true; reset on overlay close / next run
    completeRun(false);
  }

  // A BPM set finished (timer expired) but the ramp continues — rest, then next set.
  // Stop scoring immediately so tail slots and stray hits after the set-end cue
  // can't fail a run the player already survived.
  function onRampSetComplete() {
    if (runState.status !== 'running') return;
    clearPendingEvals();
    runGating = false;
    events = [];
  }

  // Called on ramp:start and ramp:bpmchange. The fixed climb lands the final set
  // exactly ON the ceiling, and completion means SURVIVING that set — so reaching
  // the ceiling must NOT end the run here; the natural ramp finish (onRampComplete)
  // claims it after the last set plays out. We keep a strict '>' guard only as a
  // safety net: if some config ever overshoots the ceiling mid-climb, stop there.
  // (The per-set 2-bar count-in is handled in onRunTick, not here — see there.)
  function maybeCompleteOnBpm(bpm) {
    if (typeof bpm === 'number') runState.currentBpm = bpm;
    if (runState.status !== 'running') return;
    refreshHudBpm();   // show the upcoming set BPM during its count-in
    // Every set begins here (ramp:start for set 1, ramp:bpmchange for later sets) —
    // and crucially this fires AFTER app.js has marked the set running and started its
    // countdown. Hold that countdown through the 2-bar count-in; it starts fresh at
    // gating-live (see onRunTick → beginSetCountdown). Doing this in onRunTick instead
    // is too early — it runs during ME.start(), before the set/timer exist, so the
    // clock would tick down through the count-in and then visibly snap back.
    if (window.AppRamp && window.AppRamp.holdSetCountdown) window.AppRamp.holdSetCountdown();
    // Only GAUNTLET has a ceiling; free modes finish by their duration (natural end).
    if (runState.mode !== 'gauntlet') return;
    const ceiling = LEVELS[runState.level].bpmCeiling;
    if (runState.currentBpm > ceiling) completeRun(true);
  }

  function completeRun(stopRamp) {
    if (runState.status !== 'running') return;
    runState.status = 'complete';
    recordSurvival();   // survived the full target → caps at the chosen duration
    clearPendingEvals();
    MetronomeEngine.onSchedule(null);

    if (stopRamp) {
      // Ceiling reached mid-ramp: stop the metronome. (AppRamp.stop() → ramp:stop
      // is a no-op now because status is already 'complete'.) The completion sound
      // is handled by GameSfx in the reveal sequence, not the old practice cue.
      if (window.AppRamp && window.AppRamp.isRunning()) window.AppRamp.stop();
    }

    saveRunRecord().finally(() => {
      showComplete();
      updateGates();
    });
  }

  function currentRunBpm() {
    if (window.AppRamp) return window.AppRamp.getCurrentBpm() || runState.currentBpm;
    return runState.currentBpm;
  }

  function refreshHudBpm() {
    if (!el.hudBpm) return;
    const bpm = currentRunBpm();
    if (!bpm) return;
    el.hudBpm.textContent = (runState.mode === 'gauntlet' ? 'L' + runState.level + ' · ' : '') +
      bpm + ' BPM';
  }

  function clearPendingEvals() {
    pendingEvalTimers.forEach(t => clearTimeout(t));
    pendingEvalTimers = [];
  }

  // Manual stop of the ramp (user pressed STOP) while a run is live → abandon run.
  function onRampStop() {
    if (runState.status === 'running') {
      runState.status = 'idle';
      clearPendingEvals();
      MetronomeEngine.onSchedule(null);
      exitHud();
      setRunStatus('Run stopped.');
      updateGates();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // DIAGNOSTICS / overlays  (factual and clinical — the number is the feedback)
  // ───────────────────────────────────────────────────────────────────────────
  // Single source of truth for a run's final grade.
  //  • Time Trial: accuracy — green % of all beats played (it never fails).
  //  • Sudden Death / Gauntlet: weighted endurance — 70% how far you got (16th slots
  //    cleared ÷ full-run slots) + 30% hit accuracy (green % of beats played).
  //    Clearing the run gives 100% on the duration side; accuracy still matters.
  function runTicksPerBeat() {
    return (typeof GameSubdivisions !== 'undefined')
      ? GameSubdivisions.ticksFor(runState.subdivision)
      : 4;
  }

  function runResultRankPct() {
    const ticksPerBeat = runTicksPerBeat();
    return runResultPct({
      mode: runState.mode,
      status: runState.status,
      hitsCleared: runState.hitsCleared,
      totalRunBeats: runState.totalRunBeats,
      tally: runState.tally,
      ticksPerBeat,
    });
  }

  // Persist the just-finished run to the cloud (no-op if signed out / Cloud absent),
  // and compute any newly-unlocked trophies for the run-end popup when valid.
  async function saveRunRecord() {
    const submit = window.Cloud && (window.Cloud.submitRun || window.Cloud.saveRun);
    if (typeof window === 'undefined' || !submit) return;
    const { rank, pct } = runResultRankPct();
    const isGauntlet = runState.mode === 'gauntlet';
    const played_sec = runState.gatingStartPerf
      ? Math.round((performance.now() - runState.gatingStartPerf) / 1000)
      : 0;
    const rec = {
      run_id: runState.runId,
      started_at: runState.startedAt,
      played_sec,
      instrument: runState.instrument || 'kick',
      mode: runState.mode,
      bpm: isGauntlet ? null : snapGameBpm(runState.gameBpm),
      level: isGauntlet ? runState.level : null,
      subdivision: runState.subdivision || 'sixteenth',
      rank: rank,
      green_pct: pct,
      duration_sec: isGauntlet ? null : runState.gameMins * 60,
      survival_sec: (runState.mode === 'suddendeath') ? Math.round(runState.survivalSec) : null,
      cleared: runState.status === 'complete',
    };
    try {
      const result = await submit(rec);
      if (result && result.valid !== false && !result.error && !result.skipped) {
        evaluateTrophies({ ...rec, valid: true });
      } else if (result && result.reject_reason) {
        console.warn('[roguelite] run not submitted:', result.reject_reason);
      }
    } catch (e) { /* never let a save error break the game */ }
  }

  // ── Trophy notifications ─────────────────────────────────────────────────────
  // Keep a local copy of the signed-in user's runs + their trophy tier-state. On
  // each finished run we append the record locally and diff, so newly-unlocked
  // trophies (and tier-ups) can be celebrated immediately — no refetch needed.
  let trophyRuns = null;        // null until signed-in + loaded
  let trophyBaseline = null;    // { id: reachedTier } before this run
  let pendingTrophies = [];     // newly-unlocked this run, consumed by the overlay

  function loadTrophyBaseline(user) {
    if (!window.Achievements) return;
    if (!user || !window.Cloud) { trophyRuns = null; trophyBaseline = null; return; }
    window.Cloud.myRuns().then(runs => {
      const valid = runs.filter(r => r.valid !== false);
      trophyRuns = valid.slice();
      trophyBaseline = window.Achievements.reachedMap(valid);
    }).catch(() => {});
  }

  function evaluateTrophies(rec) {
    if (!window.Achievements || !trophyRuns) return;   // signed out / not loaded yet
    trophyRuns.push(rec);
    const after = window.Achievements.reachedMap(trophyRuns);
    pendingTrophies = window.Achievements.diff(trophyBaseline || {}, after);
    trophyBaseline = after;
  }

  // ── Reveal sequence: results → Style Rank animates in → trophies pop 1-by-1 ────
  // SFX (window.GameSfx, see sfx.js). Phases:
  //   overlay appears → run-complete stinger (mode/rank-band) OR 'fail'
  //   +250ms          → rank-reveal flourish ('rank'+rank), synced to the burst
  //   each trophy pop → 'trophyPop'
  function sfx(name) { try { if (window.GameSfx) window.GameSfx(name); } catch (e) {} }

  let trophyQueue = [];
  let revealTimer = null;
  let rankTimer = null;

  // Run after a results overlay is shown. isWin=false for a failed run (no
  // celebratory rank flourish — just the fail stinger).
  // Timeline: 0ms run-complete/fail stinger · 950ms rank bursts in (+ flourish on
  // a win) · 2250ms first trophy pops.
  function revealResults(isWin) {
    const { rank } = runResultRankPct();
    if (isWin) {
      if (window.GameSfx && window.GameSfx.completeKey) {
        sfx(window.GameSfx.completeKey(runState.mode, runState.suddenDeath, rank));
      }
    } else {
      sfx('fail');
    }
    // Reveal the rank emblem a beat after the card lands (visual + sound together).
    const rankEl = el.overlay && el.overlay.querySelector('.rogue-result-rank');
    clearTimeout(rankTimer);
    rankTimer = setTimeout(() => {
      if (rankEl) rankEl.classList.add('revealed');
      if (isWin) sfx('rank' + rank);
    }, 950);
    clearTimeout(revealTimer);
    if (pendingTrophies.length) {
      trophyQueue = pendingTrophies.slice();
      pendingTrophies = [];
      revealTimer = setTimeout(startTrophySequence, 2250);
    }
  }

  function startTrophySequence() {
    if (el.overlay) el.overlay.classList.add('blurred');   // blur the results behind
    showNextTrophy();
  }

  function showNextTrophy() {
    if (!trophyQueue.length || !window.Achievements || !el.trophyPop) { endTrophySequence(); return; }
    const t = trophyQueue.shift();
    const A = window.Achievements;
    el.tpBadge.innerHTML = A.badgeHtml(t.ach, t.reached, false);
    el.tpName.textContent = t.ach.name;
    el.tpTier.textContent = A.tierName(t.ach, t.reached);
    el.tpDesc.textContent = t.ach.desc || '';
    el.trophyPop.classList.remove('out');
    el.trophyPop.classList.add('visible');
    if (el.tpCard) { el.tpCard.classList.remove('pop'); void el.tpCard.offsetWidth; el.tpCard.classList.add('pop'); }
    sfx('trophyPop');
  }

  // Tap / click / key advances to the next trophy, or back to the results.
  function dismissTrophy() {
    if (!el.trophyPop || !el.trophyPop.classList.contains('visible')) return;
    el.trophyPop.classList.add('out');
    setTimeout(() => { el.trophyPop.classList.remove('visible', 'out'); showNextTrophy(); }, 180);
  }

  function endTrophySequence() {
    trophyQueue = [];
    if (el.trophyPop) el.trophyPop.classList.remove('visible', 'out');
    if (el.overlay) el.overlay.classList.remove('blurred');
  }

  function dismissResultsOverlay() {
    clearTimeout(revealTimer);
    clearTimeout(rankTimer);
    endTrophySequence();
    if (el.overlay) el.overlay.classList.remove('visible', 'blurred');
    runState.status = 'idle';
    window.__rogueSuppressDoneOverlay = false;
    window.__rogueSuppressCompleteCue = false;
  }

  // Result table: Good / Neutral / Bad rows (hexagon + label + count), then the
  // green percentage. Neutral row also shows the rush/drag split.
  function resultTable() {
    const t = runState.tally;
    const split = t.neutral ? ' <span class="rl-split">(' + t.rush + ' rush · ' + t.drag + ' drag)</span>' : '';
    const row = (cls, label, n, extra) =>
      '<div class="rogue-result-row">' +
        '<span class="rogue-hex ' + cls + '"></span>' +
        '<span class="rl-lbl">' + label + (extra || '') + '</span>' +
        '<span class="rl-n">' + n + '</span>' +
      '</div>';
    const { rank, pct } = runResultRankPct();
    // Every rank E..SS has a hero emblem PNG (assets/img/rank/<x>.png). If the art is ever
    // missing, onerror swaps the <img> back to the plain glowing letter.
    const rankCell =
      '<span class="rogue-result-rank ' + rankClass(rank) + ' has-art" data-rank="' + rank + '">' +
        '<img class="rank-art" src="/assets/img/rank/' + rank.toLowerCase() + '.png?v=3" alt="Rank ' + rank + '" ' +
        'onerror="var p=this.parentNode;p.classList.remove(\'has-art\');p.textContent=\'' + rank + '\';"></span>';
    return '<div class="rogue-result">' +
        row('rogue-good', 'Good', t.good) +
        row('rogue-drag', 'Neutral', t.neutral, split) +
        row('rogue-bad',  'Bad', t.bad) +
        '<div class="rogue-result-score">' +
          rankCell +
          '<span class="rogue-result-pct">' + pct + '%</span>' +
        '</div>' +
      '</div>';
  }

  // Per-hit timeline chart (collapsible). A line chart of every evaluated 16th by
  // its signed timing offset: above the centre line = RUSH (early), below = DRAG
  // (late). Each segment/point is colour-coded by verdict — green (good), orange
  // (neutral & rushing), yellow (neutral & dragging), red (bad). A dropped 16th
  // (nothing landed) breaks the line and is marked × on the centre line. Pure
  // string-built SVG — no chart library, no canvas.
  function hitTimelineChart() {
    const log = runState.hitLog || [];
    if (!log.length) return '';
    const W = 520, H = 132, padL = 44, padR = 12, padT = 14, padB = 14;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const mid = padT + plotH / 2;
    let maxAbs = 30;                                   // floor so a tight run still reads
    log.forEach(h => { if (h.off != null) maxAbs = Math.max(maxAbs, Math.abs(h.off)); });
    maxAbs = Math.ceil(maxAbs / 10) * 10;
    const n = log.length;
    const x = i => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = off => mid + (off / maxAbs) * (plotH / 2);   // +off (late/drag) plots below
    const colorFor = h => {
      if (h.off == null || h.rank === 2) return '#ff5566';     // bad / drop
      if (h.rank === 0) return '#00e87a';                      // good
      return h.off < 0 ? '#ff9d3a' : '#ffd24a';                // neutral: rush / drag
    };
    let segs = '', dots = '';
    for (let i = 0; i < n; i++) {
      const h = log[i];
      if (h.off == null) {                                     // dropped 16th → × marker
        const cx = x(i).toFixed(1);
        dots += '<path d="M' + (cx - 3) + ' ' + (mid - 3) + ' l6 6 M' + (cx - 3) + ' ' +
          (mid + 3) + ' l6 -6" stroke="#ff5566" stroke-width="1.5"/>';
        continue;
      }
      const cx = x(i), cy = y(h.off);
      if (i > 0 && log[i - 1].off != null) {                   // connect from previous point
        const px = x(i - 1), py = y(log[i - 1].off);
        segs += '<line x1="' + px.toFixed(1) + '" y1="' + py.toFixed(1) + '" x2="' + cx.toFixed(1) +
          '" y2="' + cy.toFixed(1) + '" stroke="' + colorFor(h) + '" stroke-width="1.6"/>';
      }
      dots += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="2" fill="' + colorFor(h) + '"/>';
    }
    const grid =
      '<line x1="' + padL + '" y1="' + mid + '" x2="' + (W - padR) + '" y2="' + mid + '" stroke="rgba(150,180,200,.35)" stroke-width="1"/>' +
      '<line x1="' + padL + '" y1="' + padT + '" x2="' + padL + '" y2="' + (H - padB) + '" stroke="rgba(150,180,200,.18)" stroke-width="1"/>';
    const labels =
      '<text x="4" y="' + (padT + 8) + '" fill="#8ab0c8" font-size="10" font-weight="700">RUSH</text>' +
      '<text x="6" y="' + (mid + 3) + '" fill="#8ab0c8" font-size="9">0</text>' +
      '<text x="4" y="' + (H - padB + 2) + '" fill="#8ab0c8" font-size="10" font-weight="700">DRAG</text>';
    const svg =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" class="rl-timeline-svg" preserveAspectRatio="xMidYMid meet" role="img" ' +
      'aria-label="Per-hit timing timeline">' + grid + segs + dots + labels + '</svg>';
    return '<details class="rl-timeline"><summary>Show hit timeline (' + n + ' sixteenths)</summary>' +
      svg + '</details>';
  }

  function showGameOver(c) {
    const line = (c && c.result === 'cram')
      ? 'Crammed an extra hit into one 16th — rushed too hard.'
      : 'Dropped a 16th — a hit went missing (a skip, a frozen limb, or too soft).';
    el.overlayTitle.textContent = 'RUN OVER';
    el.overlayTitle.className = 'rogue-overlay-title fail';
    // Sudden Death headlines SURVIVAL TIME (the leaderboard metric); other modes
    // headline the BPM where it broke.
    const headline = runState.suddenDeath
      ? '<div class="rogue-diag-big">' + fmtMMSS(runState.survivalSec) + '</div>' +
        '<div class="rogue-diag-sub">survived · ' + runState.diedAtBpm + ' BPM · target ' +
        runState.gameMins + ':00</div>'
      : '<div class="rogue-diag-big">' + runState.diedAtBpm + ' BPM</div>';
    el.overlayBody.innerHTML =
      headline +
      '<div class="rogue-diag-line">' + line + '</div>' +
      resultTable() +
      hitTimelineChart();
    el.overlay.classList.add('visible');
    revealResults(false);
  }

  function showComplete() {
    el.overlayTitle.className = 'rogue-overlay-title win';
    let ctx;
    if (runState.mode === 'gauntlet') {
      el.overlayTitle.textContent = 'GAUNTLET CLEARED';
      ctx = 'Survived all 5 sets to ' + LEVELS[runState.level].bpmCeiling + ' BPM';
    } else if (runState.suddenDeath) {
      el.overlayTitle.textContent = 'SUDDEN DEATH CLEARED';
      ctx = 'Survived ' + fmtMMSS(runState.survivalSec) + ' · ' + runState.gameBpm +
        ' BPM · no dropped beat';
    } else {
      el.overlayTitle.textContent = 'RESULTS';
      ctx = runState.gameBpm + ' BPM · ' + runState.gameMins + ' min';
    }
    el.overlayBody.innerHTML =
      '<div class="rogue-diag-line">' + ctx + '</div>' + resultTable() + hitTimelineChart();
    el.overlay.classList.add('visible');
    revealResults(true);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // UI
  // ───────────────────────────────────────────────────────────────────────────
  function setMidiStatus(msg, isErr) { setStatus(el.midiStatus, msg, isErr); }
  function setAudioStatus(msg, isErr) { setStatus(el.audioStatus, msg, isErr); }
  function setCalStatus(msg, isErr)  { setStatus(el.calStatus, msg, isErr); }
  function setRunStatus(msg, isErr)  { setStatus(el.runStatus, msg, isErr); }
  function setStatus(node, msg, isErr) {
    if (!node) return;
    node.textContent = msg;
    node.classList.toggle('error', !!isErr);
    node.classList.remove('countin', 'live');
  }

  // Prominent count-off / live banner (CSS: .rogue-status.countin, .rogue-status.live).
  function setStatusBanner(node, msg, cls) {
    if (!node) return;
    node.textContent = msg;
    node.classList.remove('error');
    node.classList.toggle('countin', cls === 'countin');
    node.classList.toggle('live', cls === 'live');
  }

  // ── Focused HUD (active only while a run is live: body.rogue-run) ────────────
  // Verdict model: rank 0 = good, 1 = neutral (rode the edge), 2 = bad (drop/cram).
  // For neutral, the SIGNED offset gives direction — early (<0) = RUSH (orange),
  // late (>0) = DRAG (yellow). Good = green, bad = red.
  const LANE_VISIBLE = 10;            // full hexagons shown in the scrolling lane
  let hudBeatRank = [0, 0, 0, 0];     // worst rank per beat (this bar)
  let hudBeatOff  = [0, 0, 0, 0];     // signed offset of the worst neutral 16th (direction)
  let prevRampToggle = false;         // restore Ramp Mode toggle after a run

  function verdictClass(rank, off) {
    if (rank === 2) return 'rogue-bad';
    if (rank === 1) return off < 0 ? 'rogue-rush' : 'rogue-drag';
    return 'rogue-good';
  }
  function verdictWord(rank, off) {
    if (rank === 2) return 'BAD';
    if (rank === 1) return off < 0 ? 'RUSH' : 'DRAG';
    return 'GOOD';
  }

  function rankClass(rank) { return 'rank-' + rank.toLowerCase(); }   // rank-ss … rank-e
  const RANK_COLOR = { SS: '#ffe066', S: '#00c8ff', A: '#00e87a', B: '#4aa8ff', C: '#b06fff', D: '#8ab0c8', E: '#ff3838' };

  // Live gauge: endurance modes = weighted duration + accuracy; time trial = good
  // quarter-beats ÷ full-run target. Only ever fills (never drops).
  function scoreRank() {
    const g = liveGaugePct({
      mode: runState.mode,
      hitsCleared: runState.hitsCleared,
      totalRunBeats: runState.totalRunBeats,
      tally: runState.tally,
      ticksPerBeat: runTicksPerBeat(),
    });
    return { gauge: g, rank: rankFor(g) };
  }

  // Drive both the setup-panel banner (hidden in HUD mode) and the big HUD banner.
  function setRunBanner(msg, cls) {
    setStatusBanner(el.runStatus, msg, cls);
    if (el.hudBanner) {
      el.hudBanner.textContent = msg;
      el.hudBanner.className = 'rogue-hud-banner' + (cls ? ' ' + cls : '');
    }
  }

  // rank -1 = neutral text (e.g. 'READY'); otherwise good/rush/drag/bad word+colour.
  function setHudVerdict(rank, off, text) {
    if (!el.hudVerdict) return;
    el.hudVerdict.textContent = text || (rank >= 0 ? verdictWord(rank, off) : '—');
    el.hudVerdict.className = 'rogue-hud-verdict' + (rank >= 0 ? ' ' + verdictClass(rank, off) : '');
  }

  // Live score: the style gauge as a filling meter + its rank, updated each beat.
  function updateScoreHud() {
    const { gauge, rank } = scoreRank();
    if (el.hudRank) {
      el.hudRank.textContent = rank;
      el.hudRank.className = 'rogue-hud-rank ' + rankClass(rank);
    }
    if (el.hudGaugeFill) {
      el.hudGaugeFill.style.width = gauge + '%';
      el.hudGaugeFill.style.background = RANK_COLOR[rank] || 'var(--cyan)';
    }
  }

  // Scrolling beat-history lane: one hexagon per completed beat, newest sliding in
  // on the right, the oldest fading out on the left. Exactly LANE_VISIBLE on screen.
  function addLaneCell(cls) {
    if (!el.lane) return;
    el.lane.querySelectorAll('.rogue-lane-cell.leaving').forEach(c => c.remove());
    const cell = document.createElement('div');
    cell.className = 'rogue-lane-cell ' + cls;
    el.lane.appendChild(cell);
    while (el.lane.children.length > LANE_VISIBLE + 1) el.lane.removeChild(el.lane.firstChild);
    if (el.lane.children.length > LANE_VISIBLE) {
      const old = el.lane.firstChild;
      old.classList.add('leaving');                       // fade/shrink out
      setTimeout(() => { if (old.parentNode) old.remove(); }, 240);
    }
  }
  function resetLane() { if (el.lane) el.lane.innerHTML = ''; }

  function enterHud() {
    const tgl = document.getElementById('intervalToggle');
    prevRampToggle = tgl ? tgl.checked : false;
    hudBeatRank = [0, 0, 0, 0];
    hudBeatOff  = [0, 0, 0, 0];
    resetLane();
    setHudVerdict(-1, 0, 'READY');
    updateScoreHud();   // resets to E / — (no beats yet)
    if (el.hudBpm) el.hudBpm.textContent = '';
    document.body.classList.add('rogue-run');
  }

  function exitHud() {
    document.body.classList.remove('rogue-run');
    resetLane();
    // Leave Ramp Mode the way the user had it before the run (the run flips it on
    // internally; restore so the setup view isn't cluttered by the ramp config).
    const tgl = document.getElementById('intervalToggle');
    if (tgl && tgl.checked !== prevRampToggle) {
      tgl.checked = prevRampToggle;
      tgl.dispatchEvent(new Event('change'));
    }
  }

  function renderDeviceList() {
    if (!el.deviceSelect) return;
    const midiInputs = MidiInput.getInputs();
    const selectedInputId = MidiInput.getInputId();
    el.deviceSelect.innerHTML = '';
    midiInputs.forEach(i => {
      const opt = document.createElement('option');
      opt.value = i.id; opt.textContent = i.name;
      if (i.id === selectedInputId) opt.selected = true;
      el.deviceSelect.appendChild(opt);
    });
    el.deviceSelect.style.display = midiInputs.length > 1 ? '' : 'none';
  }

  // Enable/disable the step buttons so the flow is enforced:
  // pick drum → MIDI → learn note → calibrate → choose mode/params → run.
  function updateGates() {
    const hasInstr = !!runState.instrument;     // compulsory
    const hasMidi = !!MidiInput.hasAccess() && MidiInput.getInputs().length > 0;
    const isAudio = runState.inputSource === 'audio';
    // A usable input: MIDI connected (+ note), or audio started.
    const hasInput = isAudio ? !!runState.audioReady : (hasMidi && runState.kickNote != null);
    const canCal = hasInstr && hasInput;        // calibration reads the same event buffer either way
    const hasCal = runState.calibration != null;
    const hasAnchor = hasCal && runState.calibration.grossOffset != null;   // enables 16ths refine
    // Free modes always have params (BPM input defaults); GAUNTLET needs a level picked.
    const hasTarget = (runState.mode !== 'gauntlet') || (runState.level != null);
    const busy = runState.status === 'calibrating' || runState.status === 'running';

    if (el.learnBtn)       el.learnBtn.disabled       = !hasMidi || !hasInstr || busy;
    if (el.audioEnableBtn) el.audioEnableBtn.disabled = !hasInstr || busy;
    if (el.audioSensBtn)   el.audioSensBtn.disabled   = !runState.audioReady || busy;
    if (el.calQuartersBtn) el.calQuartersBtn.disabled = !canCal || busy;
    if (el.cal16Btn)      el.cal16Btn.disabled      = !canCal || !hasAnchor || busy;
    if (el.calStopBtn)    el.calStopBtn.style.display = (runState.status === 'calibrating') ? '' : 'none';
    if (el.manualBtn)     el.manualBtn.disabled     = !hasInstr || busy;
    // Run needs a drum, the offset (calibrated or manual), a target, and a live input.
    if (el.runBtn)   el.runBtn.disabled   = !(hasInstr && hasCal && hasTarget && hasInput) || busy;
    el.levelBtns && el.levelBtns.forEach(b => { b.disabled = busy; });
    el.modeBtns   && el.modeBtns.forEach(b => { b.disabled = busy; });
    el.instrBtns  && el.instrBtns.forEach(b => { b.disabled = busy; });
    el.inputBtns  && el.inputBtns.forEach(b => { b.disabled = busy; });
    document.querySelectorAll('.rogue-subdiv-btn').forEach(b => { b.disabled = busy; });
  }

  function selectLevel(n) {
    runState.level = n;
    el.levelBtns.forEach(b => b.classList.toggle('active', parseInt(b.dataset.level, 10) === n));
    updateGates();
  }

  function selectMode(m) {
    runState.mode = (m === 'gauntlet' || m === 'suddendeath') ? m : 'timetrial';
    const isGauntlet = runState.mode === 'gauntlet';
    el.modeBtns && el.modeBtns.forEach(b => b.classList.toggle('active', b.dataset.rmode === runState.mode));
    // TIME TRIAL and SUDDEN DEATH both use the BPM-ladder + duration params.
    if (el.gameParams)     el.gameParams.style.display     = isGauntlet ? 'none' : '';
    if (el.gauntletParams) el.gauntletParams.style.display = isGauntlet ? '' : 'none';
    if (el.gameModeHint) {
      el.gameModeHint.textContent = (runState.mode === 'suddendeath')
        ? 'Sudden Death: one dropped note ends it — rank blends survival (70%) and accuracy (30%).'
        : 'Time Trial: play the full duration; graded E–SS.';
    }
    renderSubdivisions();
    updateGates();
  }

  function selectSubdivision(id) {
    runState.subdivision = (typeof GameSubdivisions !== 'undefined')
      ? GameSubdivisions.clampForMode(id, runState.mode)
      : 'sixteenth';
    renderSubdivisions();
    updateGates();
  }

  function renderSubdivisions() {
    const GS = typeof GameSubdivisions !== 'undefined' ? GameSubdivisions : null;
    if (!GS) return;
    runState.subdivision = GS.clampForMode(runState.subdivision, runState.mode);
    const allowed = GS.allowedForMode(runState.mode);
    const isGauntlet = runState.mode === 'gauntlet';
    const container = isGauntlet ? el.gauntletSubdivRow : el.gameSubdivRow;
    const other = isGauntlet ? el.gameSubdivRow : el.gauntletSubdivRow;
    if (other) other.style.display = 'none';
    if (!container) return;
    container.style.display = '';
    container.innerHTML = '';
    const label = document.createElement('span');
    label.className = 'rogue-field-label';
    label.textContent = 'Subdivision';
    container.appendChild(label);
    const btns = document.createElement('div');
    btns.className = 'rogue-subdivision-buttons';
    allowed.forEach(id => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rogue-subdiv-btn' + (runState.subdivision === id ? ' active' : '');
      btn.dataset.subdiv = id;
      btn.title = GS.labelFor(id);
      btn.innerHTML = '<span class="sub-icon">' + GS.iconFor(id) + '</span>';
      btn.addEventListener('click', () => selectSubdivision(id));
      btns.appendChild(btn);
    });
    container.appendChild(btns);
  }

  // ── Beta access gate (Game Mode only) ───────────────────────────────────────
  function showBetaGate(state) {
    if (!el.betaGate) return;
    el.betaGate.hidden = false;
    el.betaGate.querySelectorAll('.beta-gate-state').forEach(s => { s.hidden = (s.dataset.state !== state); });
  }
  function hideBetaGate() { if (el.betaGate) el.betaGate.hidden = true; }

  // Wait for the Cloud facade to finish loading. Cloud scripts load async (Supabase
  // CDN → cloud-supabase.js → cloud.js) while this file runs on `defer`, so after a
  // sign-in reload `window.Cloud` may not exist yet when the gate first runs. Poll
  // briefly and resolve once it's ready (or null on timeout). Same pattern as
  // wireTrophies / index.html mountAuth.
  function waitForCloud(timeoutMs) {
    const cap = timeoutMs || 5000;
    const start = Date.now();
    return new Promise(resolve => {
      (function poll() {
        if (window.Cloud && window.Cloud.claimBetaSpot) return resolve(window.Cloud);
        if (Date.now() - start >= cap) return resolve(null);
        setTimeout(poll, 50);
      })();
    });
  }

  // Resolve whether the user may enter Game Mode. Shows the gate as needed.
  // Returns true only if a beta spot is confirmed.
  async function ensureBetaAccess() {
    if (!BETA_GATE || betaOk) return true;
    // Fail CLOSED: if Cloud never loads we can't verify the beta spot, so deny
    // access rather than letting everyone in (the free metronome is unaffected —
    // this only runs when toggling Game Mode on).
    const C = await waitForCloud();
    if (!C) { showBetaGate('error'); return false; }
    const u = C.getSessionUser ? await C.getSessionUser() : (C.currentUser && C.currentUser());
    if (!u) {
      try { sessionStorage.setItem('cloud:reopenGameMode', '1'); } catch (e) {}
      showBetaGate('signin');
      // Localhost: skip the Google button — open the dev user picker immediately.
      if (window.__CLOUD_MODE__ === 'mock' && C.signIn) C.signIn();
      return false;
    }
    showBetaGate('checking');
    let res = 'error';
    try { res = await C.claimBetaSpot(); } catch (e) {}
    if (res === 'ok') { betaOk = true; hideBetaGate(); return true; }
    showBetaGate(res === 'full' ? 'full' : res === 'not-allowed' ? 'notallowed' : 'error');
    return false;
  }

  // After sign-in (Google redirect on prod, dev picker on localhost), restore Game Mode.
  async function reopenGameModeAfterSignIn() {
    try {
      if (sessionStorage.getItem('cloud:reopenGameMode') !== '1') return;
      sessionStorage.removeItem('cloud:reopenGameMode');
      if (!applyGameModeToggle || !el.toggle) return;
      el.toggle.checked = true;
      await applyGameModeToggle();
    } catch (e) {}
  }

  // BPM ladder stepper (Time Trial / Sudden Death): snaps to 10s, clamps 60–240.
  function stepGameBpm(delta) {
    runState.gameBpm = snapGameBpm(runState.gameBpm + delta);
    renderGameBpm();
  }
  function renderGameBpm() {
    if (el.gameBpmVal) el.gameBpmVal.textContent = runState.gameBpm;
    if (el.gameBpmDec) el.gameBpmDec.disabled = runState.gameBpm <= GAME_BPM_MIN;
    if (el.gameBpmInc) el.gameBpmInc.disabled = runState.gameBpm >= GAME_BPM_MAX;
  }
  function stepGameMins(delta) {
    runState.gameMins = Math.max(GAME_MINS_MIN, Math.min(GAME_MINS_MAX, runState.gameMins + delta));
    renderGameMins();
  }
  function renderGameMins() {
    if (el.gameMinsVal) el.gameMinsVal.textContent = runState.gameMins;
    if (el.gameMinsDec) el.gameMinsDec.disabled = runState.gameMins <= GAME_MINS_MIN;
    if (el.gameMinsInc) el.gameMinsInc.disabled = runState.gameMins >= GAME_MINS_MAX;
  }

  function initUI() {
    el = {
      toggle:       document.getElementById('rogueToggle'),
      body:         document.getElementById('rogueBody'),
      betaGate:     document.getElementById('betaGate'),
      betaGateClose:document.getElementById('betaGateClose'),
      betaSignIn:   document.getElementById('betaSignIn'),
      betaWaitForm: document.getElementById('betaWaitForm'),
      betaWaitEmail:document.getElementById('betaWaitEmail'),
      betaWaitMsg:  document.getElementById('betaWaitMsg'),
      betaInviteForm: document.getElementById('betaInviteForm'),
      betaInviteEmail:document.getElementById('betaInviteEmail'),
      betaInviteMsg:  document.getElementById('betaInviteMsg'),
      betaRetry:    document.getElementById('betaRetry'),
      instrBtns:    Array.from(document.querySelectorAll('.rogue-instr-btn')),
      instrStatus:  document.getElementById('rogueInstrStatus'),
      inputBtns:    Array.from(document.querySelectorAll('.rogue-input-btn')),
      midiSteps:    document.getElementById('rogueMidiSteps'),
      audioSteps:   document.getElementById('rogueAudioSteps'),
      audioEnableBtn: document.getElementById('rogueAudioEnableBtn'),
      audioSensBtn:   document.getElementById('rogueAudioSensBtn'),
      audioDeviceSelect: document.getElementById('rogueAudioDeviceSelect'),
      audioStatus:    document.getElementById('rogueAudioStatus'),
      audioMeter:     document.getElementById('rogueAudioMeter'),
      audioMeterFill: document.getElementById('rogueAudioMeterFill'),
      audioMeterPeak: document.getElementById('rogueAudioMeterPeak'),
      audioGain:      document.getElementById('rogueAudioGain'),
      modeBtns:       Array.from(document.querySelectorAll('.rogue-mode-btn')),
      gameParams:     document.getElementById('rogueGameParams'),
      gauntletParams: document.getElementById('rogueGauntletParams'),
      gameBpmVal:     document.getElementById('rogueGameBpmVal'),
      gameBpmDec:     document.getElementById('rogueGameBpmDec'),
      gameBpmInc:     document.getElementById('rogueGameBpmInc'),
      gameModeHint:   document.getElementById('rogueGameModeHint'),
      gameSubdivRow:  document.getElementById('rogueGameSubdivRow'),
      gauntletSubdivRow: document.getElementById('rogueGauntletSubdivRow'),
      gameMinsVal:    document.getElementById('rogueGameMinsVal'),
      gameMinsDec:    document.getElementById('rogueGameMinsDec'),
      gameMinsInc:    document.getElementById('rogueGameMinsInc'),
      midiBtn:      document.getElementById('rogueMidiBtn'),
      deviceSelect: document.getElementById('rogueDeviceSelect'),
      midiStatus:   document.getElementById('rogueMidiStatus'),
      learnBtn:     document.getElementById('rogueLearnBtn'),
      kickNote:     document.getElementById('rogueKickNote'),
      calQuartersBtn: document.getElementById('rogueCalQuartersBtn'),
      cal16Btn:     document.getElementById('rogueCal16Btn'),
      cal16Bpm:     document.getElementById('rogueCal16Bpm'),
      calStatus:    document.getElementById('rogueCalStatus'),
      calStopBtn:   document.getElementById('rogueCalStopBtn'),
      manualOffset: document.getElementById('rogueManualOffset'),
      manualBtn:    document.getElementById('rogueManualBtn'),
      runBtn:       document.getElementById('rogueRunBtn'),
      runStatus:    document.getElementById('rogueRunStatus'),
      levelBtns:    Array.from(document.querySelectorAll('.rogue-level-btn')),
      overlay:      document.getElementById('rogueOverlay'),
      overlayTitle: document.getElementById('rogueOverlayTitle'),
      overlayBody:  document.getElementById('rogueOverlayBody'),
      overlayClose: document.getElementById('rogueOverlayClose'),
      overlayReplay: document.getElementById('rogueOverlayReplay'),
      hudVerdict:   document.getElementById('rogueHudVerdict'),
      hudBanner:    document.getElementById('rogueHudBanner'),
      hudBpm:       document.getElementById('rogueHudBpm'),
      hudRank:      document.getElementById('rogueHudRank'),
      hudGaugeFill: document.getElementById('rogueHudGaugeFill'),
      lane:         document.getElementById('rogueLane'),
      trophyPop:    document.getElementById('rogueTrophyPop'),
      tpCard:       document.getElementById('rtpCard'),
      tpBadge:      document.getElementById('rtpBadge'),
      tpName:       document.getElementById('rtpName'),
      tpTier:       document.getElementById('rtpTier'),
      tpDesc:       document.getElementById('rtpDesc'),
    };
    if (!el.toggle) return; // markup not present — nothing to wire

    // Trophy popup: tap / click / any key advances to the next one (or back to results).
    if (el.trophyPop) el.trophyPop.addEventListener('click', dismissTrophy);
    document.addEventListener('keydown', () => {
      if (el.trophyPop && el.trophyPop.classList.contains('visible')) dismissTrophy();
    });

    el.kickNote && (el.kickNote.textContent = 'Note: pick a drum first');

    const applyToggle = async () => {
      // Gate Game Mode behind the beta sign-in + spot claim. If denied, snap the
      // toggle back off and leave the rest of the app (free metronome) untouched.
      if (el.toggle.checked && BETA_GATE && !betaOk) {
        const granted = await ensureBetaAccess();
        if (!granted) { el.toggle.checked = false; el.body.classList.remove('visible'); window.__gameModeActive = false; return; }
      }
      el.body.classList.toggle('visible', el.toggle.checked);
      window.__gameModeActive = el.toggle.checked;   // routes keyboard shortcuts here
      // Leaving Game Mode restores the normal practice-complete cue.
      if (!el.toggle.checked) window.__rogueSuppressCompleteCue = false;
      // Welcome greeting fires when Game Mode is turned on (once per session — the
      // engine's welcomePlayed guard means it won't repeat as you keep playing).
      if (el.toggle.checked && typeof MetronomeEngine !== 'undefined') {
        try { MetronomeEngine.playWelcomeGreeting(); } catch (e) {}
      }
    };
    applyGameModeToggle = applyToggle;
    el.toggle.addEventListener('change', applyToggle);

    // Localhost beta gate: dev picker instead of Google OAuth.
    if (window.__CLOUD_MODE__ === 'mock') {
      if (el.betaSignIn) el.betaSignIn.textContent = 'Dev sign in ▾';
      const signinMsg = el.betaGate && el.betaGate.querySelector('.beta-gate-state[data-state="signin"] .beta-gate-msg');
      if (signinMsg) signinMsg.textContent = 'Game Mode uses a local mock database in dev. Pick a dev user to continue.';
    }

    // Beta gate controls.
    if (el.betaGateClose) el.betaGateClose.addEventListener('click', () => { hideBetaGate(); el.toggle.checked = false; el.body.classList.remove('visible'); window.__gameModeActive = false; try { sessionStorage.removeItem('cloud:reopenGameMode'); } catch (e) {} });
    if (el.betaSignIn) el.betaSignIn.addEventListener('click', () => { try { window.Cloud && window.Cloud.signIn(); } catch (e) {} });
    if (el.betaRetry) el.betaRetry.addEventListener('click', () => { el.toggle.checked = true; applyToggle(); });
    if (el.betaWaitForm) el.betaWaitForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = el.betaWaitEmail ? el.betaWaitEmail.value : '';
      if (el.betaWaitMsg) el.betaWaitMsg.textContent = 'Adding you…';
      let err = null;
      try { const r = await (window.Cloud && window.Cloud.joinWaitlist(email)); err = r && r.error; } catch (x) { err = x; }
      if (el.betaWaitMsg) el.betaWaitMsg.textContent = err ? 'Could not save — check the email and retry.' : "You're on the list! We'll be in touch.";
      if (!err && el.betaWaitForm) el.betaWaitForm.reset();
    });
    // Invite-only (not-allowlisted) waitlist form — same wiring as the "full" form.
    if (el.betaInviteForm) el.betaInviteForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = el.betaInviteEmail ? el.betaInviteEmail.value : '';
      if (el.betaInviteMsg) el.betaInviteMsg.textContent = 'Adding you…';
      let err = null;
      try { const r = await (window.Cloud && window.Cloud.joinWaitlist(email)); err = r && r.error; } catch (x) { err = x; }
      if (el.betaInviteMsg) el.betaInviteMsg.textContent = err ? 'Could not save — check the email and retry.' : "You're on the list! We'll be in touch.";
      if (!err && el.betaInviteForm) el.betaInviteForm.reset();
    });
    // Android-Chrome label fallback, matching the existing toggles.
    const lbl = el.toggle.closest('.toggle-switch');
    if (lbl) lbl.addEventListener('click', () => setTimeout(applyToggle, 0));

    // Returning from a Google sign-in redirect reloads the page; re-open Game Mode
    // so the user lands back where they were (the sign-in button lives in here).
    // On localhost the dev picker fires cloud:signedIn instead (no page reload).
    document.addEventListener('cloud:signedIn', () => { reopenGameModeAfterSignIn(); });
    reopenGameModeAfterSignIn();

    el.instrBtns.forEach(b => b.addEventListener('click', () => selectInstrument(b.dataset.instr)));

    // Input + calibration chrome (core mount helpers bind to existing Game Mode IDs).
    if (typeof InputControls !== 'undefined') {
      InputControls.mount(el.body || document, {
        onSourceChange: selectInputSource,
        onConnectMidi: enableMidi,
        onLearn: learnKick,
        onDeviceChange: selectInput,
        onEnableAudio: enableAudio,
        onSensitivity: setSensitivity,
        onAudioDeviceChange: () => { if (runState.audioReady) enableAudio(); },
        getState: () => ({ inputSource: runState.inputSource }),
      });
    } else {
      el.inputBtns.forEach(b => b.addEventListener('click', () => selectInputSource(b.dataset.src)));
      el.midiBtn  && el.midiBtn.addEventListener('click', () => enableMidi());
      el.learnBtn && el.learnBtn.addEventListener('click', () => learnKick());
      el.audioEnableBtn && el.audioEnableBtn.addEventListener('click', () => enableAudio());
      el.audioSensBtn   && el.audioSensBtn.addEventListener('click', () => setSensitivity());
      el.audioDeviceSelect && el.audioDeviceSelect.addEventListener('change', () => { if (runState.audioReady) enableAudio(); });
      el.deviceSelect && el.deviceSelect.addEventListener('change', () => selectInput(el.deviceSelect.value));
    }
    reflectInputSource();

    if (typeof CalibrationControls !== 'undefined') {
      CalibrationControls.mount(el.body || document, {
        onCalQuarters: () => startCalQuarters(),
        onCal16: () => startCal16(),
        onStop: () => stopCalibration(),
        onManual: () => applyManualOffset(),
      });
    } else {
      el.calStopBtn && el.calStopBtn.addEventListener('click', () => stopCalibration());
      el.calQuartersBtn && el.calQuartersBtn.addEventListener('click', () => startCalQuarters());
      el.cal16Btn && el.cal16Btn.addEventListener('click', () => startCal16());
      el.manualBtn && el.manualBtn.addEventListener('click', () => applyManualOffset());
    }

    el.runBtn   && el.runBtn.addEventListener('click', () => startRun());
    el.levelBtns.forEach(b => b.addEventListener('click', () => selectLevel(parseInt(b.dataset.level, 10))));
    el.modeBtns.forEach(b => b.addEventListener('click', () => selectMode(b.dataset.rmode)));
    el.gameBpmDec && el.gameBpmDec.addEventListener('click', () => stepGameBpm(-GAME_BPM_STEP));
    el.gameBpmInc && el.gameBpmInc.addEventListener('click', () => stepGameBpm(+GAME_BPM_STEP));
    el.gameMinsDec && el.gameMinsDec.addEventListener('click', () => stepGameMins(-1));
    el.gameMinsInc && el.gameMinsInc.addEventListener('click', () => stepGameMins(+1));
    renderGameBpm();
    renderGameMins();
    selectMode(runState.mode);
    el.overlayClose && el.overlayClose.addEventListener('click', () => {
      dismissResultsOverlay();
      exitHud();   // leave the HUD and restore the normal (decluttered) setup view
      setRunStatus('Start another run.');
      updateGates();
    });
    el.overlayReplay && el.overlayReplay.addEventListener('click', async () => {
      dismissResultsOverlay();
      updateGates();
      await startRun();
    });

    // Load the trophy baseline once Cloud is ready (it loads after this script);
    // refreshes whenever auth changes.
    (function wireTrophies() {
      if (window.Cloud && window.Cloud.onAuth) window.Cloud.onAuth(loadTrophyBaseline);
      else setTimeout(wireTrophies, 200);
    })();

    // Ramp lifecycle from app.js.
    document.addEventListener('ramp:start',     e => maybeCompleteOnBpm(e.detail && e.detail.bpm));
    document.addEventListener('ramp:bpmchange', e => maybeCompleteOnBpm(e.detail && e.detail.bpm));
    document.addEventListener('ramp:setcomplete', () => onRampSetComplete());
    document.addEventListener('ramp:complete', () => onRampComplete());
    document.addEventListener('ramp:stop', () => onRampStop());

    // ── Game-mode keyboard shortcuts (only while Game Mode is on) ──
    //   ← / →  BPM down / up · ↑ / ↓  minutes up / down · Space  start / stop run.
    // Inactive while a results overlay is showing (keys dismiss trophies instead).
    document.addEventListener('keydown', (e) => {
      if (!window.__gameModeActive) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (el.overlay && el.overlay.classList.contains('visible')) return;   // results up
      const running = runState.status === 'running';
      switch (e.key) {
        case 'ArrowLeft':  if (!running) { e.preventDefault(); stepGameBpm(-GAME_BPM_STEP); } break;
        case 'ArrowRight': if (!running) { e.preventDefault(); stepGameBpm(+GAME_BPM_STEP); } break;
        case 'ArrowUp':    if (!running) { e.preventDefault(); stepGameMins(+1); } break;
        case 'ArrowDown':  if (!running) { e.preventDefault(); stepGameMins(-1); } break;
        case ' ':
          e.preventDefault();
          if (running) { if (window.AppRamp) window.AppRamp.stop(); }
          else if (el.runBtn && !el.runBtn.disabled) startRun();
          break;
      }
    });

    updateGates();
  }

  // ── small utils ────────────────────────────────────────────────────────────
  function parseIntOr(node, fallback) {
    const v = node ? parseInt(node.value, 10) : NaN;
    return Number.isNaN(v) ? fallback : v;
  }
  function signed(n) { return (n >= 0 ? '+' : '') + n.toFixed(1); }
  function fmtMMSS(sec) {
    const s = Math.max(0, Math.round(sec));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initUI);
    } else {
      initUI();
    }
  }

  return {
    // public surface (mostly for debugging / future wiring)
    LEVELS, runState, enableMidi, learnKick, selectInstrument, startCalQuarters, startCal16, startRun,
    _math: TimingMath, _loadTrophyBaseline: loadTrophyBaseline,
  };
})();

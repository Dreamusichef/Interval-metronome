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
     - document 'ramp:start|bpmchange|complete|stop' events → ramp lifecycle

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

/* ───────────────────────────────────────────────────────────────────────────
   PURE TIMING MATH
   No DOM, no MIDI, no engine. Kept pure so it can be unit-tested in node
   (see roguelite.selftest.cjs) — the detection/calibration formulas are the
   one place a sign error or a clock-domain bug would silently corrupt
   everything, so they get tested in isolation.
   ─────────────────────────────────────────────────────────────────────────── */

/*
  Clock reconciliation.

  Two clocks are in play:
    A — the audio clock: audioCtx.currentTime, in SECONDS. The metronome
        schedules every tick against this.
    P — the perf clock: performance.now(), in MILLISECONDS. Web MIDI
        event.timeStamp lives here (a DOMHighResTimeStamp off performance.timeOrigin).

  We can only compare a MIDI event to an expected click if both are in the same
  domain. We capture one (a0, p0) sample — "audio time a0 corresponds to perf
  time p0" — and convert linearly. The two clocks tick at the same rate (real
  seconds), so a single offset sample is enough over a calibration/run window;
  long-session drift is documented below.

  CRITICAL: getting this wrong shifts every offset by a constant. Calibration
  would then absorb that constant into meanOffset and the bug would be INVISIBLE
  in the numbers — runs would still "work" but be measuring the wrong thing.
  That's why audioToPerf/perfToAudio are tiny, pure, and tested, and why the
  live layer logs raw offsets on the first calibration hits as a sanity check.
*/
function audioToPerfMs(audioSec, sync) {
  return (audioSec - sync.a0) * 1000 + sync.p0;
}
function perfMsToAudio(perfMs, sync) {
  return (perfMs - sync.p0) / 1000 + sync.a0;
}

/*
  Calibration: collect signed offsets (event − expectedClick, ms) and reduce to
  the per-session constant we subtract from every hit (meanOffset) plus the
  spread (sd) we SHOW the player but never gate on.

  Matching rule: for each expected click, take the nearest kick event; if none
  within captureWindowMs (generous, e.g. ±150ms), skip that click — it doesn't
  count as a hit and doesn't penalise (this is calibration, not a run).

  Returns { meanOffset, sd, sampleCount }. sd is the population standard
  deviation of the matched offsets.
*/
function computeCalibration(expectedPerfTimes, eventPerfTimes, captureWindowMs) {
  const offsets = [];
  for (const expected of expectedPerfTimes) {
    let best = null;
    let bestAbs = Infinity;
    for (const ev of eventPerfTimes) {
      const d = ev - expected;
      const a = Math.abs(d);
      if (a < bestAbs) { bestAbs = a; best = d; }
    }
    if (best !== null && bestAbs <= captureWindowMs) offsets.push(best);
  }
  const sampleCount = offsets.length;
  if (sampleCount === 0) return { meanOffset: 0, sd: 0, sampleCount: 0 };
  const mean = offsets.reduce((s, x) => s + x, 0) / sampleCount;
  const variance = offsets.reduce((s, x) => s + (x - mean) * (x - mean), 0) / sampleCount;
  return { meanOffset: mean, sd: Math.sqrt(variance), sampleCount };
}

/*
  Classify a single expected hit during a run.

  The capture window is ±windowMs around (expectedPerf + meanOffset) — i.e. we
  shift the expected time by the systematic offset, then ask how far the nearest
  kick landed.

    - 'clear'   nearest event within ±windowMs of the corrected centre.
    - 'out'     nearest event exists nearby (within searchWindowMs) but beyond
                ±windowMs — a real but mistimed hit. FAILS.
    - 'miss'    no event anywhere near the corrected centre. FAILS.

  `events` is an array of { t, consumed } (perf ms). We match the nearest
  UNCONSUMED event and return its index so the caller can mark it consumed —
  this stops one kick from satisfying two adjacent subdivisions at high tempo.

  Returns { result, offset, eventIndex }. offset is signed corrected ms
  (event − correctedCentre); positive = late (rushed-late / dragging),
  negative = early (rushing ahead). null when result is 'miss'.
*/
function classifyHit(expectedPerf, meanOffset, windowMs, events, searchWindowMs) {
  const centre = expectedPerf + meanOffset;
  let bestIdx = -1;
  let bestAbs = Infinity;
  let bestSigned = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].consumed) continue;
    const d = events[i].t - centre;
    const a = Math.abs(d);
    if (a < bestAbs) { bestAbs = a; bestIdx = i; bestSigned = d; }
  }
  if (bestIdx === -1 || bestAbs > searchWindowMs) {
    return { result: 'miss', offset: null, eventIndex: -1 };
  }
  if (bestAbs <= windowMs) {
    return { result: 'clear', offset: bestSigned, eventIndex: bestIdx };
  }
  return { result: 'out', offset: bestSigned, eventIndex: bestIdx };
}

const RL_TimingMath = { audioToPerfMs, perfMsToAudio, computeCalibration, classifyHit };

// node export for the self-test; harmless/ignored in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RL_TimingMath;
}

/* ───────────────────────────────────────────────────────────────────────────
   THE FEATURE
   ─────────────────────────────────────────────────────────────────────────── */
const RogueliteMode = (() => {

  // Challenge levels — the ONLY difficulty knobs, all in one place so they can be
  // tuned against real student data without hunting through logic.
  //   bpmStart   = where the run's ramp begins (overrides Ramp Mode's Starting BPM)
  //   bpmCeiling = top of the level's range; reaching it = run complete
  //   windowMs   = ± timing tolerance that gates every hit (the real difficulty knob)
  // BPM ranges are fixed by spec; the windows taper 40ms → 15ms across the levels
  // (5ms/level) as a starting guess — retune these freely.
  const LEVELS = {
    1: { bpmStart:  80, bpmCeiling: 100, windowMs: 40 },
    2: { bpmStart: 100, bpmCeiling: 120, windowMs: 35 },
    3: { bpmStart: 120, bpmCeiling: 140, windowMs: 30 },
    4: { bpmStart: 140, bpmCeiling: 160, windowMs: 25 },
    5: { bpmStart: 160, bpmCeiling: 180, windowMs: 20 },
    6: { bpmStart: 180, bpmCeiling: 200, windowMs: 15 },
  };

  // Calibration constants. Fixed moderate tempo; ignore the first 2 bars, measure
  // bars 3–16 (14 bars × 4 quarter-note clicks = 56 expected samples).
  const CAL_BPM = 100;
  const CAL_BARS = 16;
  const CAL_IGNORE_BARS = 2;
  const CAL_BEATS = 4;                 // 4/4
  const CAL_CAPTURE_WINDOW_MS = 150;   // generous match window during calibration

  // Run constants.
  const RUN_SEARCH_WINDOW_MS = 150;    // beyond this, a missing event is a 'miss' not an 'out'
  const EVAL_MARGIN_MS = 35;           // evaluate a tick this long after its window closes
  const RUN_LEAD_IN_BARS = 2;          // bars 1–2 of every set play ungated (count-in)
  const RUN_REST_SECS = 10;            // fixed rest between sets during a run
  // A gap between consecutive ticks longer than this means a new set just began
  // (the metronome stops for the between-set rest). Far larger than any in-set gap
  // — slowest case is 80 BPM quarters at 750ms — so it cleanly flags set boundaries.
  const RUN_SEGMENT_GAP_MS = 1500;

  // Default single combined-kick MIDI note (GM kick). Overridable via "learn".
  const DEFAULT_KICK_NOTE = 36;

  // ── Run / session state ──────────────────────────────────────────────────
  const runState = {
    level: null,                // 1..6
    currentBpm: 0,              // mirrors the existing ramp engine
    meanOffset: 0,              // from calibration; subtracted from every hit
    windowMs: 0,                // from level config
    kickNote: DEFAULT_KICK_NOTE,
    status: 'idle',             // 'idle'|'calibrating'|'running'|'failed'|'complete'
    diedAtBpm: null,
    hitsCleared: 0,
    calibration: null,          // { meanOffset, sd, sampleCount }
    // NOTE: dual-note / per-foot detection is explicitly out of scope for v1.
    // kickNote is a single number today; widening it to a Set later is the only
    // change the MIDI layer would need.
  };

  // ── MIDI layer state ───────────────────────────────────────────────────────
  let midiAccess = null;
  let midiInputs = [];          // [{ id, name }]
  let selectedInputId = null;
  let learning = false;         // true while waiting to capture the next note-on as the kick note
  let onLearned = null;

  // ── Clock reconciliation ───────────────────────────────────────────────────
  let sync = null;              // { a0, p0 } captured fresh at each measurement phase

  function captureSync() {
    const ctx = (typeof MetronomeEngine !== 'undefined') && MetronomeEngine.getAudioContext();
    if (!ctx) return false;
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

  // ── Kick event buffer ────────────────────────────────────────────────────
  // Each entry: { t (perf ms), consumed }. Shared by calibration and runs; reset
  // when each phase begins. Old entries are purged during runs to bound growth.
  let events = [];

  function pushKickEvent(perfMs) {
    events.push({ t: perfMs, consumed: false });
  }

  // ── DOM refs (populated in initUI) ─────────────────────────────────────────
  let el = {};

  // ───────────────────────────────────────────────────────────────────────────
  // MIDI
  // ───────────────────────────────────────────────────────────────────────────
  async function enableMidi() {
    if (!navigator.requestMIDIAccess) {
      setMidiStatus('Web MIDI not supported in this browser.', true);
      return;
    }
    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    } catch (e) {
      setMidiStatus('MIDI access denied: ' + (e && e.message ? e.message : e), true);
      return;
    }
    midiAccess.onstatechange = refreshInputs;
    refreshInputs();
  }

  function refreshInputs() {
    midiInputs = [];
    if (midiAccess) {
      for (const input of midiAccess.inputs.values()) {
        midiInputs.push({ id: input.id, name: input.name || input.id });
      }
    }
    // Auto-select if exactly one input; otherwise keep current or first.
    if (midiInputs.length && !midiInputs.some(i => i.id === selectedInputId)) {
      selectedInputId = midiInputs[0].id;
    }
    attachToSelectedInput();
    renderDeviceList();
    if (!midiInputs.length) {
      setMidiStatus('No MIDI inputs found. Connect your module and try again.', true);
    } else {
      const cur = midiInputs.find(i => i.id === selectedInputId);
      setMidiStatus('Connected: ' + (cur ? cur.name : '—'), false);
    }
    updateGates();
  }

  function attachToSelectedInput() {
    if (!midiAccess) return;
    for (const input of midiAccess.inputs.values()) {
      input.onmidimessage = (input.id === selectedInputId) ? handleMidiMessage : null;
    }
  }

  function selectInput(id) {
    selectedInputId = id;
    attachToSelectedInput();
    const cur = midiInputs.find(i => i.id === selectedInputId);
    setMidiStatus('Connected: ' + (cur ? cur.name : '—'), false);
  }

  function handleMidiMessage(event) {
    const data = event.data;
    if (!data || data.length < 3) return;
    const status = data[0] & 0xf0;
    const note = data[1];
    const velocity = data[2];
    // note-on with velocity > 0 only (note-on velocity 0 == note-off).
    if (status !== 0x90 || velocity === 0) return;

    // Use event.timeStamp (perf-clock DOMHighResTimeStamp). Guard against browsers
    // that hand back 0 or a wildly different origin: if it isn't within ~1s of the
    // moment we received it, fall back to performance.now() at receipt. (A wrong
    // *constant* origin would otherwise be silently absorbed by calibration — the
    // exact masking bug §6 warns about.)
    const recv = performance.now();
    let ts = event.timeStamp;
    if (!(typeof ts === 'number') || ts <= 0 || Math.abs(ts - recv) > 1000) ts = recv;

    if (learning) {
      learning = false;
      runState.kickNote = note;
      el.kickNote && (el.kickNote.textContent = 'Kick note: ' + note);
      if (onLearned) { const cb = onLearned; onLearned = null; cb(note); }
      updateGates();
      return;
    }

    if (note === runState.kickNote) pushKickEvent(ts);
  }

  function learnKick() {
    if (!midiAccess) { setMidiStatus('Connect MIDI first.', true); return; }
    learning = true;
    el.kickNote && (el.kickNote.textContent = 'Hit your kick…');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CALIBRATION  (16 bars @ CAL_BPM, 4/4 quarters; ignore bars 1–2, measure 3–16)
  // ───────────────────────────────────────────────────────────────────────────
  let calState = null;

  function startCalibration() {
    if (typeof MetronomeEngine === 'undefined') return;
    if (runState.kickNote == null) { setMidiStatus('Learn your kick note first.', true); return; }
    if (window.AppRamp && window.AppRamp.isRunning()) window.AppRamp.stop();

    MetronomeEngine.init();
    if (!captureSync()) { setCalStatus('Audio not ready — try again.', true); return; }

    // Force a clean 4/4 quarter-note click for calibration.
    MetronomeEngine.setBeatsPerMeasure(CAL_BEATS);
    MetronomeEngine.setSubdivision('quarter');
    MetronomeEngine.setBpm(CAL_BPM);

    const totalTicks = CAL_BARS * CAL_BEATS;            // 64
    const ignoreTicks = CAL_IGNORE_BARS * CAL_BEATS;    // 8
    events = [];
    calState = {
      tickCount: 0,
      totalTicks,
      ignoreTicks,
      expected: [],     // perf-ms times of MEASURED clicks (bars 3–16)
      lastTickPerf: 0,
      loggedRaw: 0,
    };

    runState.status = 'calibrating';
    setCalStatus('Calibrating… bar 1 / ' + CAL_BARS);
    updateGates();

    MetronomeEngine.onSchedule(onCalTick);
    MetronomeEngine.start();
  }

  function onCalTick(tickTimeSec) {
    if (!calState) return;
    const idx = calState.tickCount++;
    const perf = audioToPerfMs(tickTimeSec, sync);
    calState.lastTickPerf = perf;

    const bar = Math.floor(idx / CAL_BEATS) + 1;
    if (bar <= CAL_BARS) setCalStatus('Calibrating… bar ' + bar + ' / ' + CAL_BARS);

    // Measured window: bars 3–16.
    if (idx >= calState.ignoreTicks && idx < calState.totalTicks) {
      calState.expected.push(perf);

      // Sanity log: dump the raw (uncorrected) offset of the nearest kick for the
      // first few measured clicks. These should read as tens of ms. Thousands ⇒
      // the timeStamp origin / clock reconciliation is wrong (see §6 comment).
      if (calState.loggedRaw < 3) {
        const nearest = nearestRawOffset(perf);
        if (nearest !== null) {
          calState.loggedRaw++;
          console.info('[roguelite] calibration raw offset (uncorrected):',
            nearest.toFixed(1) + 'ms');
        }
      }
    }

    if (idx + 1 === calState.totalTicks) {
      // Exactly the last measured tick — finalise once, just after its window
      // closes. (=== not >=: the engine keeps emitting ticks until we stop it,
      // and we must not schedule finishCalibration more than once.)
      const delay = (calState.lastTickPerf + CAL_CAPTURE_WINDOW_MS + EVAL_MARGIN_MS) - performance.now();
      setTimeout(finishCalibration, Math.max(0, delay));
    }
  }

  function nearestRawOffset(expectedPerf) {
    let best = null, bestAbs = Infinity;
    for (const ev of events) {
      const d = ev.t - expectedPerf, a = Math.abs(d);
      if (a < bestAbs) { bestAbs = a; best = d; }
    }
    return (best !== null && bestAbs <= CAL_CAPTURE_WINDOW_MS) ? best : null;
  }

  function finishCalibration() {
    if (!calState) return;
    MetronomeEngine.onSchedule(null);
    MetronomeEngine.stop();

    const expectedTimes = calState.expected;
    const eventTimes = events.map(e => e.t);
    const result = computeCalibration(expectedTimes, eventTimes, CAL_CAPTURE_WINDOW_MS);

    runState.calibration = result;
    runState.meanOffset = result.meanOffset;
    runState.status = 'idle';
    calState = null;
    events = [];

    if (result.sampleCount < 8) {
      setCalStatus('Only ' + result.sampleCount + ' hits detected — play a kick on every ' +
        'click and recalibrate.', true);
    } else {
      setCalStatus(
        'Calibrated. Systematic offset ' + signed(result.meanOffset) +
        'ms (subtracted automatically). Your timing spread was ±' +
        result.sd.toFixed(0) + 'ms over ' + result.sampleCount + ' hits.', false);
    }
    updateGates();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // RUN  (reuses the existing ramp engine; gates every scheduled tick)
  // ───────────────────────────────────────────────────────────────────────────
  let pendingEvalTimers = [];
  let runBarCount = 0;        // bars seen in the current set (for the lead-in)
  let runGating = false;      // false during the lead-in, true once hits are gated
  let lastTickPerf = 0;       // perf-time of the previous run tick (for set-boundary gap detection)

  function startRun() {
    if (runState.level == null) { setRunStatus('Pick a level first.', true); return; }
    if (runState.calibration == null) { setRunStatus('Calibrate first.', true); return; }
    if (!window.AppRamp) { setRunStatus('Ramp engine unavailable.', true); return; }

    const level = LEVELS[runState.level];
    runState.windowMs = level.windowMs;
    runState.hitsCleared = 0;
    runState.diedAtBpm = null;
    runState.status = 'running';
    window.__rogueSuppressDoneOverlay = false;

    events = [];
    clearPendingEvals();
    runBarCount = 0;
    runGating = false;
    lastTickPerf = 0;

    // The level sets where the climb begins — drive it through the existing
    // Starting-BPM input so the ramp engine starts there. The climb rate (BPM
    // increment, set length, number of sets) still comes from Ramp Mode; the
    // level's ceiling is the completion target.
    const startInput = document.getElementById('startBpm');
    if (startInput) startInput.value = String(level.bpmStart);

    // Rest between sets is fixed at 10s for runs — every set then begins with the
    // engine stopped/restarted, which gives each set its own clean 2-bar count-in
    // (the rest also forces a downbeat realignment we hang the lead-in off of).
    const restM = document.getElementById('restMins');
    const restS = document.getElementById('restSecs');
    if (restM) restM.value = '0';
    if (restS) restS.value = String(RUN_REST_SECS);

    // Fresh clock reconciliation for this run (don't trust a sync captured back
    // at calibration time — recapture so audio↔perf is current).
    MetronomeEngine.init();
    if (!captureSync()) { runState.status = 'idle'; setRunStatus('Audio not ready — try again.', true); return; }

    // Subscribe to the click grid and kick off the existing ramp. ramp:start
    // (dispatched by app.js) confirms the run is live and gives us the start BPM.
    MetronomeEngine.onSchedule(onRunTick);
    const ok = window.AppRamp.startRampSession();
    if (!ok) {
      MetronomeEngine.onSchedule(null);
      runState.status = 'idle';
      setRunStatus('Could not start the ramp — check your Ramp Mode settings.', true);
      return;
    }
    setRunStatus('Level ' + runState.level + ' (' + level.bpmStart + '–' +
      level.bpmCeiling + ' BPM, ±' + level.windowMs + 'ms). ' +
      RUN_LEAD_IN_BARS + '-bar count-in, then one bad hit ends it.');
    updateGates();
  }

  function onRunTick(tickTimeSec, soundType, beatIndex, tickInBeat) {
    if (runState.status !== 'running') return;
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
      if (!firstTickOfRun) {
        const lvl = LEVELS[runState.level];
        setRunStatus('Level ' + runState.level + ' · set @ ' + currentRunBpm() + ' BPM (±' +
          lvl.windowMs + 'ms). ' + RUN_LEAD_IN_BARS + '-bar count-in…');
      }
    }

    // Lead-in: the player can't be locked in on beat 1. Bars 1–2 of the set play
    // ungated as a count-in; gating starts on the downbeat of bar 3. A bar
    // boundary is the bar's first tick (downbeat): beatIndex 0, tickInBeat 0.
    // (The new-set tick above IS that set's first downbeat, so it counts as bar 1.)
    if (beatIndex === 0 && tickInBeat === 0) {
      runBarCount++;
      if (!runGating && runBarCount > RUN_LEAD_IN_BARS) {
        runGating = true;
        // Drop any kicks played during the count-in so they can't be matched
        // against the first gated tick.
        events = [];
        const lvl = LEVELS[runState.level];
        setRunStatus('GATING LIVE — Level ' + runState.level + ' · ' + currentRunBpm() +
          ' BPM (±' + lvl.windowMs + 'ms). One bad hit ends it.');
      }
    }
    if (!runGating) return;   // still counting in — don't gate these ticks


    // Every scheduled tick is an expected kick (continuous double-bass playing).
    // v1: silent beats are still expected hits — you play through them.
    const evalAt = expectedPerf + runState.windowMs + EVAL_MARGIN_MS;
    const delay = Math.max(0, evalAt - performance.now());
    const timer = setTimeout(() => evaluateHit(expectedPerf), delay);
    pendingEvalTimers.push(timer);
  }

  function evaluateHit(expectedPerf) {
    if (runState.status !== 'running') return;

    const c = classifyHit(expectedPerf, runState.meanOffset, runState.windowMs,
      events, RUN_SEARCH_WINDOW_MS);

    if (c.result === 'clear') {
      events[c.eventIndex].consumed = true;
      runState.hitsCleared++;
      // Purge consumed/stale events well behind the current expected time.
      pruneEvents(expectedPerf - RUN_SEARCH_WINDOW_MS * 2);
      return;
    }
    // 'out' (matched but beyond window) or 'miss' (no event nearby) — both fail.
    failRun(c);
  }

  function pruneEvents(beforePerf) {
    if (events.length < 64) return;
    events = events.filter(e => !e.consumed && e.t >= beforePerf);
  }

  function failRun(classification) {
    if (runState.status !== 'running') return;
    runState.status = 'failed';
    runState.diedAtBpm = currentRunBpm();
    clearPendingEvals();
    MetronomeEngine.onSchedule(null);
    if (window.AppRamp) window.AppRamp.stop();   // stop the ramp; NOT the level-up path

    // Fail cue: reuse the existing set-end cue as the closest "stop" sound the
    // app owns (there is no dedicated game-over asset in this build).
    try { MetronomeEngine.playSetEndCue(); } catch (e) {}

    showGameOver(classification);
    updateGates();
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

  // Called on ramp:start and ramp:bpmchange. If the climb has reached the level
  // ceiling, the run is complete and we stop the still-running ramp ourselves.
  // (The per-set 2-bar count-in is handled in onRunTick, not here — see there.)
  function maybeCompleteOnBpm(bpm) {
    if (typeof bpm === 'number') runState.currentBpm = bpm;
    if (runState.status !== 'running') return;
    const ceiling = LEVELS[runState.level].bpmCeiling;
    if (runState.currentBpm >= ceiling) completeRun(true);
  }

  function completeRun(stopRamp) {
    if (runState.status !== 'running') return;
    runState.status = 'complete';
    clearPendingEvals();
    MetronomeEngine.onSchedule(null);

    if (stopRamp) {
      // Ceiling reached mid-ramp: stop the metronome and fire the existing
      // completion / level-up audio ourselves. (AppRamp.stop() → ramp:stop is a
      // no-op now because status is already 'complete'.)
      if (window.AppRamp && window.AppRamp.isRunning()) window.AppRamp.stop();
      try { MetronomeEngine.playPracticeCompleteCue(); } catch (e) {}
    }
    // For the natural-finish path the cue already fired in finishSession().

    showComplete();
    updateGates();
  }

  function currentRunBpm() {
    if (window.AppRamp) return window.AppRamp.getCurrentBpm() || runState.currentBpm;
    return runState.currentBpm;
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
      setRunStatus('Run stopped.');
      updateGates();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // DIAGNOSTICS / overlays  (factual and clinical — the number is the feedback)
  // ───────────────────────────────────────────────────────────────────────────
  function showGameOver(c) {
    let line;
    if (c.result === 'miss') {
      line = 'Missed kick — no hit inside the ±' + runState.windowMs + 'ms window.';
    } else {
      const off = c.offset;
      const dir = off > 0 ? 'you dragged' : 'you rushed';
      line = signed(off) + 'ms — ' + dir + ' (window ±' + runState.windowMs + 'ms).';
    }
    const sd = runState.calibration ? runState.calibration.sd.toFixed(0) : '—';
    el.overlayTitle.textContent = 'RUN OVER';
    el.overlayTitle.className = 'rogue-overlay-title fail';
    el.overlayBody.innerHTML =
      '<div class="rogue-diag-big">' + runState.diedAtBpm + ' BPM</div>' +
      '<div class="rogue-diag-line">' + escapeHtml(line) + '</div>' +
      '<div class="rogue-diag-sub">Hits cleared this run: ' + runState.hitsCleared + '</div>' +
      '<div class="rogue-diag-sub">Calibration spread: ±' + sd + 'ms</div>';
    el.overlay.classList.add('visible');
  }

  function showComplete() {
    const ceiling = LEVELS[runState.level].bpmCeiling;
    const sd = runState.calibration ? runState.calibration.sd.toFixed(0) : '—';
    el.overlayTitle.textContent = 'RUN COMPLETE';
    el.overlayTitle.className = 'rogue-overlay-title win';
    el.overlayBody.innerHTML =
      '<div class="rogue-diag-big">' + ceiling + ' BPM</div>' +
      '<div class="rogue-diag-line">Clean run to the ceiling.</div>' +
      '<div class="rogue-diag-sub">Hits cleared: ' + runState.hitsCleared + '</div>' +
      '<div class="rogue-diag-sub">Calibration spread: ±' + sd + 'ms</div>';
    el.overlay.classList.add('visible');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // UI
  // ───────────────────────────────────────────────────────────────────────────
  function setMidiStatus(msg, isErr) { setStatus(el.midiStatus, msg, isErr); }
  function setCalStatus(msg, isErr)  { setStatus(el.calStatus, msg, isErr); }
  function setRunStatus(msg, isErr)  { setStatus(el.runStatus, msg, isErr); }
  function setStatus(node, msg, isErr) {
    if (!node) return;
    node.textContent = msg;
    node.classList.toggle('error', !!isErr);
  }

  function renderDeviceList() {
    if (!el.deviceSelect) return;
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
  // MIDI → learn kick → calibrate → pick level → run.
  function updateGates() {
    const hasMidi = !!midiAccess && midiInputs.length > 0;
    const hasKick = hasMidi && runState.kickNote != null;
    const hasCal = runState.calibration != null;
    const hasLevel = runState.level != null;
    const busy = runState.status === 'calibrating' || runState.status === 'running';

    if (el.learnBtn) el.learnBtn.disabled = !hasMidi || busy;
    if (el.calBtn)   el.calBtn.disabled   = !hasKick || busy;
    if (el.runBtn)   el.runBtn.disabled   = !(hasCal && hasLevel) || busy;
    el.levelBtns && el.levelBtns.forEach(b => { b.disabled = busy; });
  }

  function selectLevel(n) {
    runState.level = n;
    el.levelBtns.forEach(b => b.classList.toggle('active', parseInt(b.dataset.level, 10) === n));
    updateGates();
  }

  function initUI() {
    el = {
      toggle:       document.getElementById('rogueToggle'),
      body:         document.getElementById('rogueBody'),
      midiBtn:      document.getElementById('rogueMidiBtn'),
      deviceSelect: document.getElementById('rogueDeviceSelect'),
      midiStatus:   document.getElementById('rogueMidiStatus'),
      learnBtn:     document.getElementById('rogueLearnBtn'),
      kickNote:     document.getElementById('rogueKickNote'),
      calBtn:       document.getElementById('rogueCalBtn'),
      calStatus:    document.getElementById('rogueCalStatus'),
      runBtn:       document.getElementById('rogueRunBtn'),
      runStatus:    document.getElementById('rogueRunStatus'),
      levelBtns:    Array.from(document.querySelectorAll('.rogue-level-btn')),
      overlay:      document.getElementById('rogueOverlay'),
      overlayTitle: document.getElementById('rogueOverlayTitle'),
      overlayBody:  document.getElementById('rogueOverlayBody'),
      overlayClose: document.getElementById('rogueOverlayClose'),
    };
    if (!el.toggle) return; // markup not present — nothing to wire

    el.kickNote && (el.kickNote.textContent = 'Kick note: ' + runState.kickNote + ' (default)');

    const applyToggle = () => {
      el.body.classList.toggle('visible', el.toggle.checked);
    };
    el.toggle.addEventListener('change', applyToggle);
    // Android-Chrome label fallback, matching the existing toggles.
    const lbl = el.toggle.closest('.toggle-switch');
    if (lbl) lbl.addEventListener('click', () => setTimeout(applyToggle, 0));

    el.midiBtn  && el.midiBtn.addEventListener('click', () => enableMidi());
    el.learnBtn && el.learnBtn.addEventListener('click', () => learnKick());
    el.calBtn   && el.calBtn.addEventListener('click', () => startCalibration());
    el.runBtn   && el.runBtn.addEventListener('click', () => startRun());
    el.deviceSelect && el.deviceSelect.addEventListener('change', () => selectInput(el.deviceSelect.value));
    el.levelBtns.forEach(b => b.addEventListener('click', () => selectLevel(parseInt(b.dataset.level, 10))));
    el.overlayClose && el.overlayClose.addEventListener('click', () => {
      el.overlay.classList.remove('visible');
      runState.status = 'idle';
      window.__rogueSuppressDoneOverlay = false;
      setRunStatus('Pick a level and start another run.');
      updateGates();
    });

    // Ramp lifecycle from app.js.
    document.addEventListener('ramp:start',     e => maybeCompleteOnBpm(e.detail && e.detail.bpm));
    document.addEventListener('ramp:bpmchange', e => maybeCompleteOnBpm(e.detail && e.detail.bpm));
    document.addEventListener('ramp:complete', () => onRampComplete());
    document.addEventListener('ramp:stop', () => onRampStop());

    updateGates();
  }

  // ── small utils ────────────────────────────────────────────────────────────
  function signed(n) { return (n >= 0 ? '+' : '') + n.toFixed(1); }
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
    LEVELS, runState, enableMidi, learnKick, startCalibration, startRun,
    _math: RL_TimingMath,
  };
})();

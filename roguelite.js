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

/*
  Continuity-game slot classifier (the actual run gate).

  The run subdivides each quarter into four 16th SLOTS, each ±halfWindowMs wide and
  centred at (expectedPerf + meanOffset). At halfWindow = half the 16th spacing the
  slots tile the timeline, so every kick belongs to exactly one slot. The rule is
  EXACTLY ONE kick per slot:
    - 0 unconsumed kicks in the slot → 'drop'  (a skip / frozen foot)            FAILS
    - 1                              → 'clear'                                    passes
    - 2+                             → 'cram'   (over-rushed / extra stroke)      FAILS

  Half-open window [centre-h, centre+h) so a kick on the boundary lands in exactly
  one slot. Returns { result, count, indices } (indices into events).
*/
function classifySlot(expectedPerf, meanOffset, halfWindowMs, events) {
  const centre = expectedPerf + meanOffset;
  const indices = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].consumed) continue;
    const d = events[i].t - centre;
    if (d >= -halfWindowMs && d < halfWindowMs) indices.push(i);
  }
  if (indices.length === 0) return { result: 'drop', count: 0, indices, offset: null };
  if (indices.length === 1) {
    return { result: 'clear', count: 1, indices, offset: events[indices[0]].t - centre };
  }
  return { result: 'cram', count: indices.length, indices, offset: null };
}

/*
  Lenient classifier for the FIRST gated 16th of a set only.

  Starting a continuous-16ths run is the hardest moment to land cleanly, and the
  normal slot is unforgiving on the EARLY side: a kick played before (centre - h)
  is orphaned (there's no earlier gated slot to claim it) → the slot reads empty →
  a drop. So for this one slot we widen the EARLY edge to (centre - earlyReachMs)
  while keeping the late edge at (centre + halfWindowMs) — generous late would
  steal the SECOND slot's kick. Present (however early) → 'clear'; nothing at all →
  'drop'. Never 'cram'. Returns the same shape as classifySlot.
*/
function classifyFirstSlot(expectedPerf, meanOffset, halfWindowMs, events, earlyReachMs) {
  const centre = expectedPerf + meanOffset;
  let bestIdx = -1, bestAbs = Infinity, bestSigned = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].consumed) continue;
    const d = events[i].t - centre;
    if (d >= -earlyReachMs && d < halfWindowMs) {
      const a = Math.abs(d);
      if (a < bestAbs) { bestAbs = a; bestIdx = i; bestSigned = d; }
    }
  }
  if (bestIdx === -1) return { result: 'drop', count: 0, indices: [], offset: null };
  return { result: 'clear', count: 1, indices: [bestIdx], offset: bestSigned };
}

const RL_TimingMath = { audioToPerfMs, perfMsToAudio, computeCalibration, classifyHit, classifySlot, classifyFirstSlot };

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

  // Calibration is a TWO-PASS process (same audible quarter-note click throughout):
  //   Pass 1 — you play QUARTERS. At 80 BPM the clicks are 750ms apart, so your
  //            ~100ms offset is unambiguous: this fixes the GROSS offset (hardware
  //            + MIDI latency). Without this anchor, pass 2 can't be de-aliased.
  //   Pass 2 — you play continuous 16ths. We shift the 16th grid by the pass-1
  //            gross offset so every kick matches its CORRECT 16th (no 150ms
  //            aliasing), then measure the 16th distribution: its mean is your
  //            habitual 16th rush ("drift"), its spread (sd) is your consistency.
  // The run subtracts the pass-2 16th mean (gross + drift) so runs centre on 0 and
  // gate your consistency; the drift is shown as feedback, not gated.
  const CAL_BEATS = 4;                 // 4/4
  const CAL_BPM = 80;                  // both passes (quarter-note click)
  const CAL_COUNTOFF_BARS = 2;         // ungated count-off at the start of each pass
  const CAL_P1_MEASURE_BARS = 4;       // pass 1: quarters measured (4×4 = 16 samples)
  const CAL_P2_MEASURE_BARS = 8;       // pass 2: 16ths measured (8×4×4 = 128 samples)
  const CAL_CAPTURE_WINDOW_MS = 150;   // generous match window for the (quarter) gross pass
  const CAL_MIN_SAMPLES = 8;           // below this, calibration is rejected

  // Run constants.
  // Presence gate: each 16th "owns" a slot of ±(this fraction × 16th-spacing). At
  // 0.5 the slots TILE the timeline — a kick lands in exactly one 16th, and a
  // dropped 16th leaves a real, detectable gap. This is the only fail condition.
  const RUN_PRESENCE_FACTOR = 0.5;
  // HUD feedback: a 'clear' hit is GREEN if it landed within this fraction of the
  // slot half-width, YELLOW ("edge") in the outer remainder. 0.65 → green inside
  // 65% of the slot, yellow in the outer 35%.
  const RUN_GOOD_FRACTION = 0.65;
  // The FIRST gated 16th of each set gets a generous early grace (× the slot
  // half-width) so a rushed start isn't orphaned and instantly failed. Early side
  // only — the late edge stays normal so it can't steal the second slot's kick.
  const RUN_FIRST_SLOT_EARLY_MULT = 3;
  const EVAL_MARGIN_MS = 35;           // evaluate a slot this long after it closes
  // Collapse hardware double-triggers: two note-ons for the SAME kick closer than
  // this are treated as one. Kept small so a genuine fast double-stroke (which we
  // WANT to fail as a 'cram') still registers as two. Tunable per module.
  const KICK_DEBOUNCE_MS = 15;
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

  // TEMPORARY: per-hit run diagnostics. Logs every gated 16th and, on a fail,
  // dumps the surrounding kick events so we can see WHY an intermittent run died
  // (mis-paired kick vs genuine out-of-window vs double-trigger). Set false to
  // silence once the timing is dialled in.
  const RL_DEBUG = true;

  // Default single combined-kick MIDI note (GM kick). Overridable via "learn".
  const DEFAULT_KICK_NOTE = 36;

  // ── Run / session state ──────────────────────────────────────────────────
  const runState = {
    mode: 'game',               // 'game' (free BPM+duration) | 'gauntlet' (level climb)
    level: null,                // 1..6 (gauntlet only)
    gameBpm: 120,               // game mode: chosen BPM
    gameMins: 3,                // game mode: chosen duration (minutes)
    currentBpm: 0,              // mirrors the existing ramp engine
    meanOffset: 0,              // from calibration; subtracted from every hit
    kickNote: DEFAULT_KICK_NOTE,
    status: 'idle',             // 'idle'|'calibrating'|'running'|'failed'|'complete'
    suddenDeath: false,         // one bad beat ends the run (gauntlet always; game = Challenge)
    diedAtBpm: null,
    hitsCleared: 0,             // cleared 16th-note slots this run
    tally: { good: 0, neutral: 0, fail: 0 },   // per-beat verdict counts (for the result card)
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

    if (note === runState.kickNote) {
      // Debounce hardware double-triggers (one physical hit → two note-ons within a
      // few ms) so they don't count as a 'cram'. Genuine strokes are far enough
      // apart to pass. (No effect on calibration matching — it just drops dupes.)
      if (ts - lastKickTs < KICK_DEBOUNCE_MS) return;
      lastKickTs = ts;
      pushKickEvent(ts);
    }
  }

  function learnKick() {
    if (!midiAccess) { setMidiStatus('Connect MIDI first.', true); return; }
    learning = true;
    el.kickNote && (el.kickNote.textContent = 'Hit your kick…');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CALIBRATION — two passes (audible quarter-note click @ CAL_BPM throughout):
  //   Pass 1: play QUARTERS  → unambiguous GROSS offset (hardware + MIDI latency)
  //   Pass 2: play 16ths     → de-aliased by the gross offset; gives 16th mean
  //                            (habitual drift) + spread (consistency)
  // ───────────────────────────────────────────────────────────────────────────
  let calState = null;   // per-pass collection state
  let calData = null;    // cross-pass accumulator: { grossOffset }

  async function startCalibration() {
    if (typeof MetronomeEngine === 'undefined') return;
    if (runState.kickNote == null) { setMidiStatus('Learn your kick note first.', true); return; }
    if (window.AppRamp && window.AppRamp.isRunning()) window.AppRamp.stop();

    MetronomeEngine.init();
    if (!(await captureSync())) { setCalStatus('Audio not ready — try again.', true); return; }

    // Audible click is a clean 4/4 quarter pulse for BOTH passes. The clock keeps
    // running between passes (engine.stop() halts the scheduler, not the context),
    // so a single sync capture stays valid across the whole calibration.
    MetronomeEngine.setBeatsPerMeasure(CAL_BEATS);
    MetronomeEngine.setSubdivision('quarter');
    MetronomeEngine.setBpm(CAL_BPM);

    runState.status = 'calibrating';
    calData = { grossOffset: 0 };
    startCalPass(1);
  }

  function startCalPass(pass) {
    const measureBars = (pass === 1) ? CAL_P1_MEASURE_BARS : CAL_P2_MEASURE_BARS;
    const totalBars = CAL_COUNTOFF_BARS + measureBars;
    events = [];
    calState = {
      pass,
      tickCount: 0,
      countoffTicks: CAL_COUNTOFF_BARS * CAL_BEATS,
      totalTicks: totalBars * CAL_BEATS,
      measureBars,
      lastTickPerf: 0,
      loggedRaw: 0,
      expected: [],   // pass 1: quarter perf times; pass 2: derived 16th perf times
    };
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
    const inCountoff = idx < calState.countoffTicks;

    // Obvious banner so the count-off vs the measured phase is unmistakable.
    if (inCountoff) {
      const what = calState.pass === 1 ? 'play QUARTERS' : 'play 16ths';
      setStatusBanner(el.calStatus, 'PASS ' + calState.pass + '/2 · COUNT-OFF ' + bar + '/' +
        CAL_COUNTOFF_BARS + ' — get ready to ' + what, 'countin');
    } else if (idx < calState.totalTicks) {
      const mbar = bar - CAL_COUNTOFF_BARS;
      setStatusBanner(el.calStatus, 'PASS ' + calState.pass + '/2 · ' +
        (calState.pass === 1 ? 'QUARTERS' : '16THS') + ' — measuring bar ' + mbar + '/' +
        calState.measureBars, 'live');
    }

    // Collect expected times during the measured window.
    if (idx >= calState.countoffTicks && idx < calState.totalTicks) {
      if (calState.pass === 1) {
        calState.expected.push(perf);                 // one sample per quarter click
      } else {
        const s = 60 / CAL_BPM / 4;                   // 16th interval (sec)
        for (let k = 0; k < 4; k++) {
          calState.expected.push(audioToPerfMs(tickTimeSec + k * s, sync));
        }
      }
      // Sanity log: raw nearest-kick offset on the first few measured clicks. Should
      // read as tens-to-low-hundreds of ms; thousands ⇒ clock reconciliation broken.
      if (calState.loggedRaw < 3) {
        const nearest = nearestRawOffset(perf);
        if (nearest !== null) {
          calState.loggedRaw++;
          console.info('[roguelite] cal pass ' + calState.pass +
            ' raw offset (uncorrected):', nearest.toFixed(1) + 'ms');
        }
      }
    }

    if (idx + 1 === calState.totalTicks) {
      // Exactly the last measured tick — finalise once, just after its window closes.
      const delay = (calState.lastTickPerf + CAL_CAPTURE_WINDOW_MS + EVAL_MARGIN_MS) - performance.now();
      setTimeout(finishCalPass, Math.max(0, delay));
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

  function finishCalPass() {
    if (!calState) return;
    MetronomeEngine.onSchedule(null);
    MetronomeEngine.stop();

    const pass = calState.pass;
    const expectedTimes = calState.expected;
    const eventTimes = events.map(e => e.t);

    if (pass === 1) {
      // Gross offset from the quarter grid (750ms spacing → no aliasing).
      const gross = computeCalibration(expectedTimes, eventTimes, CAL_CAPTURE_WINDOW_MS);
      if (gross.sampleCount < CAL_MIN_SAMPLES) {
        abortCalibration('Pass 1: only ' + gross.sampleCount + ' quarter hits detected — ' +
          'play a kick on every click, then recalibrate.');
        return;
      }
      calData.grossOffset = gross.meanOffset;
      console.info('[roguelite] cal pass 1 gross offset:', signed(gross.meanOffset) +
        'ms (' + gross.sampleCount + ' hits)');
      setStatusBanner(el.calStatus, 'PASS 1 done · offset ' + signed(gross.meanOffset) +
        'ms. Get ready — PASS 2: continuous 16ths…', 'countin');
      // Short breather, then pass 2 (engine restarts inside startCalPass).
      setTimeout(() => { if (runState.status === 'calibrating') startCalPass(2); }, 1500);
      return;
    }

    // Pass 2: shift the 16th grid by the gross offset so each kick matches its
    // CORRECT 16th, then measure with a tight (< half-spacing) window.
    const G = calData.grossOffset;
    const shifted = expectedTimes.map(t => t + G);
    const spacing16 = 60000 / CAL_BPM / 4;
    const tight = spacing16 * 0.45;
    const fine = computeCalibration(shifted, eventTimes, tight);

    calState = null;
    events = [];
    runState.status = 'idle';

    if (fine.sampleCount < CAL_MIN_SAMPLES) {
      abortCalibration('Pass 2: only ' + fine.sampleCount + ' of your 16ths matched — ' +
        'play continuous 16ths on the click, then recalibrate.');
      return;
    }

    const meanOffset = G + fine.meanOffset;   // absolute 16th-grid mean → the run subtracts this
    const drift = meanOffset - G;             // 16th vs quarter (negative = rushing 16ths)
    runState.meanOffset = meanOffset;
    runState.calibration = { meanOffset, sd: fine.sd, sampleCount: fine.sampleCount, grossOffset: G, drift };

    const dir = drift < 0 ? 'rushing' : 'dragging';
    setStatus(el.calStatus,
      'Calibrated. Offset ' + signed(meanOffset) + 'ms (subtracted). 16ths ' + dir + ' ' +
      Math.abs(drift).toFixed(0) + 'ms vs your quarters · consistency ±' + fine.sd.toFixed(0) +
      'ms over ' + fine.sampleCount + ' hits.', false);
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
    setStatus(el.calStatus, 'Manual offset ' + signed(v) + 'ms applied — calibration skipped.', false);
    updateGates();
  }

  function abortCalibration(msg) {
    MetronomeEngine.onSchedule(null);
    MetronomeEngine.stop();
    calState = null;
    events = [];
    runState.status = 'idle';
    setStatus(el.calStatus, msg, true);
    updateGates();
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
    runState.tally = { good: 0, neutral: 0, fail: 0 };
    runState.diedAtBpm = null;
    runState.status = 'running';
    window.__rogueSuppressDoneOverlay = false;

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
    } else {
      // GAME: one set at the user's chosen BPM for the chosen duration. No climb.
      // Sudden death only if Challenge is on.
      const bpm  = Math.max(20, Math.min(400, parseIntOr(el.gameBpm, 120)));
      const mins = Math.max(1, Math.min(60, parseIntOr(el.gameMins, 3)));
      runState.gameBpm = bpm;
      runState.gameMins = mins;
      runState.suddenDeath = !!(el.challenge && el.challenge.checked);
      setInput('startBpm',     bpm);
      setInput('numSets',      1);
      setInput('bpmIncrement', 0);
      setInput('setMins',      mins);
      setInput('setSecs',      0);
      setInput('restMins', 0);
      setInput('restSecs', 0);
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
    const where = (runState.mode === 'gauntlet')
      ? ('Gauntlet L' + runState.level + ' · ' + LEVELS[runState.level].bpmStart + '–' +
         LEVELS[runState.level].bpmCeiling + ' BPM')
      : ('Game · ' + runState.gameBpm + ' BPM · ' + runState.gameMins + ' min' +
         (runState.suddenDeath ? ' · Challenge' : ''));
    setRunStatus(where + ' — ' + RUN_LEAD_IN_BARS + '-bar count-in, then play continuous 16ths.');
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
      hudBeatRank = [0, 0, 0, 0];
      // Don't let the 2-bar count-in eat into the set's clock — hold the set
      // countdown now; it starts fresh (full minute) when gating goes live.
      if (window.AppRamp && window.AppRamp.holdSetCountdown) window.AppRamp.holdSetCountdown();
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
          setHudVerdict(-1, 'READY');
        } else {
          runGating = true;
          // Drop any kicks played during the count-in so they can't be matched
          // against the first gated tick.
          events = [];
          pendingFirstGated = true;   // first scored 16th of this set gets early grace
          // Count-in over — NOW start the set's 1-minute clock (see AppRamp hooks).
          if (window.AppRamp && window.AppRamp.beginSetCountdown) window.AppRamp.beginSetCountdown();
          setRunBanner('Keep the 16ths going', 'live');
          if (el.hudBpm) {
            el.hudBpm.textContent = (runState.mode === 'gauntlet' ? 'L' + runState.level + ' · ' : '') +
              currentRunBpm() + ' BPM';
          }
        }
      }
    }
    if (!runGating) return;   // still counting in — don't gate these ticks

    // The audible click is a QUARTER-note pulse (engine runs in quarters), but the
    // run TESTS 16th notes — continuous double-bass. Subdivide this quarter into its
    // four 16ths and require a kick in each. Continuity game: the slot is ±half the
    // 16th spacing, so the 16ths TILE the timeline — timing wobble inside the slot
    // is fine; only a DROPPED 16th (empty slot = a skip / frozen foot) ends the run.
    const sixteenthMs = 60000 / currentRunBpm() / 4;
    const presenceMs = sixteenthMs * RUN_PRESENCE_FACTOR;
    const sixteenthSec = sixteenthMs / 1000;
    for (let k = 0; k < 4; k++) {
      const subPerf = audioToPerfMs(tickTimeSec + k * sixteenthSec, sync);
      // Evaluate after the (offset-shifted) slot closes — classifySlot centres it at
      // subPerf + meanOffset, so the eval timer must wait out meanOffset too.
      const evalAt = subPerf + runState.meanOffset + presenceMs + EVAL_MARGIN_MS;
      const delay = Math.max(0, evalAt - performance.now());
      pendingEvalTimers.push(setTimeout(() => evaluateHit(subPerf, presenceMs, beatIndex, k), delay));
    }
  }

  function evaluateHit(expectedPerf, presenceMs, beatIndex, sixteenthIdx) {
    if (runState.status !== 'running') return;

    // The first scored 16th of each set is lenient on the early side (a rushed start
    // would otherwise be orphaned → instant drop). Every other slot: exactly one
    // kick — 0 = 'drop', 1 = 'clear', 2+ = 'cram'.
    const firstGated = pendingFirstGated;
    pendingFirstGated = false;
    const c = firstGated
      ? classifyFirstSlot(expectedPerf, runState.meanOffset, presenceMs, events,
          presenceMs * RUN_FIRST_SLOT_EARLY_MULT)
      : classifySlot(expectedPerf, runState.meanOffset, presenceMs, events);

    // Verdict for the HUD: 0 = good (well inside the slot), 1 = neutral (rode the
    // slot edge), 2 = fail. A beat's lane cell shows the WORST of its four 16ths.
    // The lenient first slot, when present, always scores GOOD (it's a freebie).
    let rank;
    if (c.result === 'clear') {
      rank = firstGated ? 0 : ((Math.abs(c.offset) > presenceMs * RUN_GOOD_FRACTION) ? 1 : 0);
    } else {
      rank = 2;
    }
    if (sixteenthIdx === 0) hudBeatRank[beatIndex] = rank;
    else hudBeatRank[beatIndex] = Math.max(hudBeatRank[beatIndex], rank);
    setHudVerdict(c.result === 'clear' ? hudBeatRank[beatIndex] : 2);

    // Consume matched kicks so they can't satisfy later slots.
    if (c.result === 'clear') { events[c.indices[0]].consumed = true; runState.hitsCleared++; }
    else if (c.result === 'cram') { c.indices.forEach(i => { events[i].consumed = true; }); }

    if (RL_DEBUG) {
      const centre = expectedPerf + runState.meanOffset;
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

    // Roguelite (sudden death): a bad beat ends the run immediately.
    if (rank === 2 && runState.suddenDeath) {
      addLaneCell(2);
      runState.tally.fail++;
      failRun(c);   // 'drop' (skip/freeze) or 'cram' (over-rush)
      return;
    }

    // Otherwise the run continues. At beat completion, append the lane cell and
    // tally the beat by its worst 16th (in score mode a 'fail' beat just counts).
    if (sixteenthIdx === 3) {
      const beatRank = hudBeatRank[beatIndex];
      addLaneCell(beatRank);
      runState.tally[TALLY_KEY[beatRank]]++;
    }
    // Purge consumed/stale events a few slots behind the current expected time.
    pruneEvents(expectedPerf - presenceMs * 4);
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

  // Called on ramp:start and ramp:bpmchange. The fixed climb lands the final set
  // exactly ON the ceiling, and completion means SURVIVING that set — so reaching
  // the ceiling must NOT end the run here; the natural ramp finish (onRampComplete)
  // claims it after the last set plays out. We keep a strict '>' guard only as a
  // safety net: if some config ever overshoots the ceiling mid-climb, stop there.
  // (The per-set 2-bar count-in is handled in onRunTick, not here — see there.)
  function maybeCompleteOnBpm(bpm) {
    if (typeof bpm === 'number') runState.currentBpm = bpm;
    if (runState.status !== 'running') return;
    // Only GAUNTLET has a ceiling; GAME finishes by its duration (natural ramp end).
    if (runState.mode !== 'gauntlet') return;
    const ceiling = LEVELS[runState.level].bpmCeiling;
    if (runState.currentBpm > ceiling) completeRun(true);
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
      exitHud();
      setRunStatus('Run stopped.');
      updateGates();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // DIAGNOSTICS / overlays  (factual and clinical — the number is the feedback)
  // ───────────────────────────────────────────────────────────────────────────
  function tallyLine() {
    const t = runState.tally;
    return '<div class="rogue-diag-sub">Beats: ' + t.good + ' good · ' + t.neutral +
      ' neutral · ' + t.fail + ' fail</div>';
  }

  function showGameOver(c) {
    const sd = (runState.calibration && runState.calibration.sampleCount) ? runState.calibration.sd.toFixed(0) : '—';
    const line = (c && c.result === 'cram')
      ? 'Crammed an extra kick into one 16th — rushed too hard (2+ hits in one slot).'
      : 'Dropped a 16th — a kick went missing (a skip or a frozen foot).';
    el.overlayTitle.textContent = 'RUN OVER';
    el.overlayTitle.className = 'rogue-overlay-title fail';
    el.overlayBody.innerHTML =
      '<div class="rogue-diag-big">' + runState.diedAtBpm + ' BPM</div>' +
      '<div class="rogue-diag-line">' + line + '</div>' +
      tallyLine() +
      '<div class="rogue-diag-sub">Your calibration consistency: ±' + sd + 'ms</div>';
    el.overlay.classList.add('visible');
  }

  function showComplete() {
    const sd = (runState.calibration && runState.calibration.sampleCount) ? runState.calibration.sd.toFixed(0) : '—';
    const t = runState.tally;
    const totalBeats = t.good + t.neutral + t.fail;
    const pctGreen = totalBeats ? Math.round(t.good / totalBeats * 100) : 0;
    const consistency = '<div class="rogue-diag-sub">Your calibration consistency: ±' + sd + 'ms</div>';
    el.overlayTitle.className = 'rogue-overlay-title win';

    if (runState.mode === 'gauntlet') {
      // Survived the level climb to the ceiling.
      el.overlayTitle.textContent = 'GAUNTLET CLEARED';
      el.overlayBody.innerHTML =
        '<div class="rogue-diag-big">' + LEVELS[runState.level].bpmCeiling + ' BPM</div>' +
        '<div class="rogue-diag-line">Survived all 5 sets to the ceiling.</div>' +
        tallyLine() + consistency;
    } else if (runState.suddenDeath) {
      // GAME + Challenge: lasted the full duration without a fatal beat.
      el.overlayTitle.textContent = 'CHALLENGE CLEARED';
      el.overlayBody.innerHTML =
        '<div class="rogue-diag-big">' + runState.gameBpm + ' BPM</div>' +
        '<div class="rogue-diag-line">Held it ' + runState.gameMins + ' min with no dropped beat.</div>' +
        tallyLine() + consistency;
    } else {
      // GAME: the scored result card.
      el.overlayTitle.textContent = 'RESULTS';
      el.overlayBody.innerHTML =
        '<div class="rogue-diag-big">' + pctGreen + '% green</div>' +
        '<div class="rogue-diag-line">' + runState.gameBpm + ' BPM · ' + runState.gameMins +
          ' min · ' + totalBeats + ' beats</div>' +
        tallyLine() + consistency;
    }
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
  const RANK_CLASS = ['rogue-good', 'rogue-edge', 'rogue-fail'];
  const VERDICT_WORD = ['GOOD', 'NEUTRAL', 'FAIL'];   // green / yellow / red
  const TALLY_KEY = ['good', 'neutral', 'fail'];      // rank → runState.tally key
  const LANE_MAX = 24;                                 // beats kept in the scrolling lane
  let hudBeatRank = [0, 0, 0, 0];                      // worst rank per beat (this bar)
  let prevRampToggle = false;                          // restore Ramp Mode toggle after a run

  // Drive both the setup-panel banner (hidden in HUD mode) and the big HUD banner.
  function setRunBanner(msg, cls) {
    setStatusBanner(el.runStatus, msg, cls);
    if (el.hudBanner) {
      el.hudBanner.textContent = msg;
      el.hudBanner.className = 'rogue-hud-banner' + (cls ? ' ' + cls : '');
    }
  }

  // rank -1 = neutral text (e.g. 'READY'); 0/1/2 = good/neutral/fail colour + word.
  function setHudVerdict(rank, text) {
    if (!el.hudVerdict) return;
    el.hudVerdict.textContent = text || (rank >= 0 ? VERDICT_WORD[rank] : '—');
    el.hudVerdict.className = 'rogue-hud-verdict' + (rank >= 0 ? ' ' + RANK_CLASS[rank] : '');
  }

  // Scrolling beat-history lane: one hexagon cell per completed beat, newest on the
  // right, older ones sliding off the left — a running visual trail of the run.
  function addLaneCell(rank) {
    if (!el.lane) return;
    const cell = document.createElement('div');
    cell.className = 'rogue-lane-cell ' + RANK_CLASS[rank];
    el.lane.appendChild(cell);
    while (el.lane.children.length > LANE_MAX) el.lane.removeChild(el.lane.firstChild);
  }
  function resetLane() { if (el.lane) el.lane.innerHTML = ''; }

  function enterHud() {
    const tgl = document.getElementById('intervalToggle');
    prevRampToggle = tgl ? tgl.checked : false;
    hudBeatRank = [0, 0, 0, 0];
    resetLane();
    setHudVerdict(-1, 'READY');
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
  // MIDI → learn kick → calibrate → choose mode/params → run.
  function updateGates() {
    const hasMidi = !!midiAccess && midiInputs.length > 0;
    const hasKick = hasMidi && runState.kickNote != null;
    const hasCal = runState.calibration != null;
    // GAME always has params (BPM input defaults); GAUNTLET needs a level picked.
    const hasTarget = (runState.mode === 'game') || (runState.level != null);
    const busy = runState.status === 'calibrating' || runState.status === 'running';

    if (el.learnBtn)  el.learnBtn.disabled  = !hasMidi || busy;
    if (el.calBtn)    el.calBtn.disabled    = !hasKick || busy;
    if (el.manualBtn) el.manualBtn.disabled = busy;
    // Run needs the offset (calibrated or manual), a target, AND a live MIDI input
    // (manual offset can be set with no kit attached, so check MIDI explicitly).
    if (el.runBtn)   el.runBtn.disabled   = !(hasCal && hasTarget && hasMidi) || busy;
    el.levelBtns && el.levelBtns.forEach(b => { b.disabled = busy; });
    el.modeBtns   && el.modeBtns.forEach(b => { b.disabled = busy; });
  }

  function selectLevel(n) {
    runState.level = n;
    el.levelBtns.forEach(b => b.classList.toggle('active', parseInt(b.dataset.level, 10) === n));
    updateGates();
  }

  function selectMode(m) {
    runState.mode = (m === 'gauntlet') ? 'gauntlet' : 'game';
    el.modeBtns && el.modeBtns.forEach(b => b.classList.toggle('active', b.dataset.rmode === runState.mode));
    if (el.gameParams)     el.gameParams.style.display     = (runState.mode === 'game')     ? '' : 'none';
    if (el.gauntletParams) el.gauntletParams.style.display = (runState.mode === 'gauntlet') ? '' : 'none';
    updateGates();
  }

  function initUI() {
    el = {
      toggle:       document.getElementById('rogueToggle'),
      body:         document.getElementById('rogueBody'),
      modeBtns:       Array.from(document.querySelectorAll('.rogue-mode-btn')),
      gameParams:     document.getElementById('rogueGameParams'),
      gauntletParams: document.getElementById('rogueGauntletParams'),
      gameBpm:        document.getElementById('rogueGameBpm'),
      gameMins:       document.getElementById('rogueGameMins'),
      challenge:      document.getElementById('rogueChallenge'),
      midiBtn:      document.getElementById('rogueMidiBtn'),
      deviceSelect: document.getElementById('rogueDeviceSelect'),
      midiStatus:   document.getElementById('rogueMidiStatus'),
      learnBtn:     document.getElementById('rogueLearnBtn'),
      kickNote:     document.getElementById('rogueKickNote'),
      calBtn:       document.getElementById('rogueCalBtn'),
      calStatus:    document.getElementById('rogueCalStatus'),
      manualOffset: document.getElementById('rogueManualOffset'),
      manualBtn:    document.getElementById('rogueManualBtn'),
      runBtn:       document.getElementById('rogueRunBtn'),
      runStatus:    document.getElementById('rogueRunStatus'),
      levelBtns:    Array.from(document.querySelectorAll('.rogue-level-btn')),
      overlay:      document.getElementById('rogueOverlay'),
      overlayTitle: document.getElementById('rogueOverlayTitle'),
      overlayBody:  document.getElementById('rogueOverlayBody'),
      overlayClose: document.getElementById('rogueOverlayClose'),
      hudVerdict:   document.getElementById('rogueHudVerdict'),
      hudBanner:    document.getElementById('rogueHudBanner'),
      hudBpm:       document.getElementById('rogueHudBpm'),
      lane:         document.getElementById('rogueLane'),
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
    el.manualBtn && el.manualBtn.addEventListener('click', () => applyManualOffset());
    el.runBtn   && el.runBtn.addEventListener('click', () => startRun());
    el.deviceSelect && el.deviceSelect.addEventListener('change', () => selectInput(el.deviceSelect.value));
    el.levelBtns.forEach(b => b.addEventListener('click', () => selectLevel(parseInt(b.dataset.level, 10))));
    el.modeBtns.forEach(b => b.addEventListener('click', () => selectMode(b.dataset.rmode)));
    el.overlayClose && el.overlayClose.addEventListener('click', () => {
      el.overlay.classList.remove('visible');
      runState.status = 'idle';
      window.__rogueSuppressDoneOverlay = false;
      exitHud();   // leave the HUD and restore the normal (decluttered) setup view
      setRunStatus('Start another run.');
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
  function parseIntOr(node, fallback) {
    const v = node ? parseInt(node.value, 10) : NaN;
    return Number.isNaN(v) ? fallback : v;
  }
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

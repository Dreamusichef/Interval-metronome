'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   CALIBRATOR — two-pass (quarters → optional 16ths) offset calibration.
   Owns the pass state machine + pure finish math. App supplies metronome,
   clock sync, event buffer, and status/result callbacks via create(deps).
   Dual export (window + module).
   ════════════════════════════════════════════════════════════════════════════ */

const Calibrator = (() => {
  const CAL_BEATS = 4;                 // 4/4
  const CAL_BPM_DEFAULT = 100;         // fallback calibration tempo
  const CAL_COUNTOFF_BARS = 2;         // ungated count-off at the start of each step
  const CAL_MEASURE_BARS = 8;          // 2 count-off + 8 measured = 10-bar test
  const CAL_CAPTURE_WINDOW_MS = 150;   // generous match window for the quarter gross pass
  const CAL_MIN_SAMPLES = 8;           // below this, calibration is rejected

  function getTimingMath() {
    if (typeof TimingMath !== 'undefined') return TimingMath;
    if (typeof window !== 'undefined' && window.TimingMath) return window.TimingMath;
    if (typeof require === 'function') {
      try { return require('./timing-math.js'); } catch (e) {}
    }
    return null;
  }

  function nearestRawOffset(expectedPerf, eventTimes, captureWindowMs) {
    const win = captureWindowMs == null ? CAL_CAPTURE_WINDOW_MS : captureWindowMs;
    let best = null, bestAbs = Infinity;
    for (const t of eventTimes) {
      const d = t - expectedPerf, a = Math.abs(d);
      if (a < bestAbs) { bestAbs = a; best = d; }
    }
    return (best !== null && bestAbs <= win) ? best : null;
  }

  /** Pure pass-1 finish: quarters → gross offset. */
  function finishPass1Math(expectedTimes, eventTimes) {
    const TM = getTimingMath();
    const compute = TM && TM.computeCalibration;
    if (!compute) return { ok: false, reason: 'TimingMath unavailable' };
    const gross = compute(expectedTimes, eventTimes, CAL_CAPTURE_WINDOW_MS);
    if (gross.sampleCount < CAL_MIN_SAMPLES) {
      return {
        ok: false,
        reason: 'Quarters: only ' + gross.sampleCount + ' hits detected — play a hit on every click, then try again.',
        sampleCount: gross.sampleCount,
      };
    }
    const G = gross.meanOffset;
    return {
      ok: true,
      pass: 1,
      meanOffset: G,
      sd: gross.sd,
      sampleCount: gross.sampleCount,
      grossOffset: G,
      drift: 0,
      refined: false,
    };
  }

  /**
   * Pure pass-2 finish: 16ths refined against gross offset G.
   * Returns ok:false keepQuarters when refine fails but quarters should stay.
   */
  function finishPass2Math(expectedTimes, eventTimes, grossOffset, bpm) {
    const TM = getTimingMath();
    const compute = TM && TM.computeCalibration;
    if (!compute) return { ok: false, reason: 'TimingMath unavailable', keepQuarters: true };
    const G = grossOffset != null ? grossOffset : 0;
    const spacing16 = 60000 / bpm / 4;
    const tight = spacing16 * 0.45;
    const rough = compute(expectedTimes.map(t => t + G), eventTimes, tight);

    let meanOffset, sd, sampleCount;
    if (rough.sampleCount >= CAL_MIN_SAMPLES) {
      const M0 = G + rough.meanOffset;
      const refined = compute(expectedTimes.map(t => t + M0), eventTimes, tight);
      meanOffset = M0 + refined.meanOffset;
      sd = refined.sd;
      sampleCount = refined.sampleCount;
    } else {
      meanOffset = G + rough.meanOffset;
      sd = rough.sd;
      sampleCount = rough.sampleCount;
    }

    if (sampleCount < CAL_MIN_SAMPLES) {
      return {
        ok: false,
        keepQuarters: true,
        reason: '16ths: only ' + sampleCount + ' matched — keeping your quarters offset. Play continuous 16ths and try the refine again.',
        sampleCount,
      };
    }

    const drift = meanOffset - G;
    return {
      ok: true,
      pass: 2,
      meanOffset,
      sd,
      sampleCount,
      grossOffset: G,
      drift,
      refined: true,
    };
  }

  /**
   * deps = {
   *   getMetronome,          // () => MetronomeEngine-like { setBpm, onSchedule, start, stop }
   *   getSync,               // () => { a0, p0 }
   *   refreshSync,           // () => void
   *   getEvents,             // () => [{ t, consumed? }, ...] or number[] of perf ms
   *   clearEvents,           // () => void
   *   getGrossOffset,        // () => number|null  (pass-2 de-alias anchor)
   *   onStatus,              // (msg, isErr) => void
   *   onStatusBanner,        // (msg, cls) => void   cls = 'countin'|'live'
   *   onComplete,            // (result) => void     result includes bpm + pass fields
   *   onFail,                // (msg, { keepQuarters? }) => void
   *   evalMarginMs,          // optional, default 35
   * }
   */
  function create(deps) {
    deps = deps || {};
    let calState = null;
    const evalMarginMs = deps.evalMarginMs != null ? deps.evalMarginMs : 35;

    function eventPerfTimes() {
      const ev = typeof deps.getEvents === 'function' ? deps.getEvents() : [];
      return ev.map(e => (typeof e === 'number' ? e : e.t));
    }

    function startPass(pass, bpm) {
      const metro = typeof deps.getMetronome === 'function' ? deps.getMetronome() : null;
      if (!metro) return false;
      const totalBars = CAL_COUNTOFF_BARS + CAL_MEASURE_BARS;
      const useBpm = Math.max(40, Math.min(200, bpm == null ? CAL_BPM_DEFAULT : bpm));
      metro.setBpm(useBpm);
      if (typeof deps.clearEvents === 'function') deps.clearEvents();
      calState = {
        pass,
        bpm: useBpm,
        tickCount: 0,
        countoffTicks: CAL_COUNTOFF_BARS * CAL_BEATS,
        totalTicks: totalBars * CAL_BEATS,
        measureBars: CAL_MEASURE_BARS,
        lastTickPerf: 0,
        loggedRaw: 0,
        expected: [],
      };
      metro.onSchedule(onCalTick);
      metro.start();
      return true;
    }

    function onCalTick(tickTimeSec) {
      if (!calState) return;
      const TM = getTimingMath();
      if (!TM) return;
      if (typeof deps.refreshSync === 'function') deps.refreshSync();
      const sync = typeof deps.getSync === 'function' ? deps.getSync() : null;
      if (!sync) return;

      const idx = calState.tickCount++;
      const perf = TM.audioToPerfMs(tickTimeSec, sync);
      calState.lastTickPerf = perf;

      const bar = Math.floor(idx / CAL_BEATS) + 1;
      const inCountoff = idx < calState.countoffTicks;
      const label = calState.pass === 1 ? 'QUARTERS' : '16THS';

      if (typeof deps.onStatusBanner === 'function') {
        if (inCountoff) {
          deps.onStatusBanner(
            label + ' · COUNT-OFF ' + bar + '/' + CAL_COUNTOFF_BARS +
              ' — get ready to play ' + (calState.pass === 1 ? 'QUARTERS' : '16ths'),
            'countin'
          );
        } else if (idx < calState.totalTicks) {
          const mbar = bar - CAL_COUNTOFF_BARS;
          deps.onStatusBanner(
            label + ' — measuring bar ' + mbar + '/' + calState.measureBars,
            'live'
          );
        }
      }

      if (idx >= calState.countoffTicks && idx < calState.totalTicks) {
        if (calState.pass === 1) {
          calState.expected.push(perf);
        } else {
          const s = 60 / calState.bpm / 4;
          for (let k = 0; k < 4; k++) {
            calState.expected.push(TM.audioToPerfMs(tickTimeSec + k * s, sync));
          }
        }
        if (calState.loggedRaw < 3) {
          const nearest = nearestRawOffset(perf, eventPerfTimes());
          if (nearest !== null) {
            calState.loggedRaw++;
            console.info('[calibrator] cal pass ' + calState.pass +
              ' raw offset (uncorrected):', nearest.toFixed(1) + 'ms');
          }
        }
      }

      if (idx + 1 === calState.totalTicks) {
        const delay = (calState.lastTickPerf + CAL_CAPTURE_WINDOW_MS + evalMarginMs) - performance.now();
        setTimeout(finishCalPass, Math.max(0, delay));
      }
    }

    function finishCalPass() {
      if (!calState) return;
      const metro = typeof deps.getMetronome === 'function' ? deps.getMetronome() : null;
      if (metro) {
        metro.onSchedule(null);
        metro.stop();
      }

      const pass = calState.pass;
      const passBpm = calState.bpm;
      const expectedTimes = calState.expected;
      const times = eventPerfTimes();
      calState = null;
      if (typeof deps.clearEvents === 'function') deps.clearEvents();

      if (pass === 1) {
        const result = finishPass1Math(expectedTimes, times);
        if (!result.ok) {
          if (typeof deps.onFail === 'function') deps.onFail(result.reason, result);
          return;
        }
        result.bpm = passBpm;
        if (typeof deps.onComplete === 'function') deps.onComplete(result);
        return;
      }

      const G = typeof deps.getGrossOffset === 'function' ? deps.getGrossOffset() : 0;
      const result = finishPass2Math(expectedTimes, times, G, passBpm);
      if (!result.ok) {
        if (typeof deps.onFail === 'function') deps.onFail(result.reason, result);
        return;
      }
      result.bpm = passBpm;
      if (typeof deps.onComplete === 'function') deps.onComplete(result);
    }

    function stop(msg) {
      if (!calState) return false;
      const metro = typeof deps.getMetronome === 'function' ? deps.getMetronome() : null;
      if (metro) {
        metro.onSchedule(null);
        metro.stop();
      }
      calState = null;
      if (typeof deps.clearEvents === 'function') deps.clearEvents();
      if (typeof deps.onFail === 'function') {
        deps.onFail(msg || 'Calibration stopped.', { stopped: true });
      }
      return true;
    }

    function isActive() {
      return !!calState;
    }

    return {
      startPass1(bpm) { return startPass(1, bpm); },
      startPass2(bpm) { return startPass(2, bpm); },
      startPass,
      stop,
      isActive,
      onCalTick,   // exposed for tests / alternate wiring
    };
  }

  return {
    CAL_BEATS,
    CAL_BPM_DEFAULT,
    CAL_COUNTOFF_BARS,
    CAL_MEASURE_BARS,
    CAL_CAPTURE_WINDOW_MS,
    CAL_MIN_SAMPLES,
    nearestRawOffset,
    finishPass1Math,
    finishPass2Math,
    create,
  };
})();

if (typeof window !== 'undefined') window.Calibrator = Calibrator;
if (typeof module !== 'undefined' && module.exports) module.exports = Calibrator;

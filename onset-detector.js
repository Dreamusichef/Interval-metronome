/* ════════════════════════════════════════════════════════════════════════════
   ONSET DETECTOR — AudioWorklet processor for audio-input mode.

   Runs on the audio thread (128-sample blocks ≈ 2.7ms at 48kHz), so it can
   timestamp a drum attack to within a few ms — far tighter than polling on the
   main thread (~16ms). Detects the rising edge of a transient (kick or snare),
   with hysteresis + a refractory window so one physical hit = one onset.

   Designed for a clean, isolated single-drum signal (the user only ever plays one
   drum into one mic/channel — no bleed), so it's a general transient detector, not
   instrument-specific. A gentle DC blocker removes rumble/offset.

   Messages OUT (to main thread):
     { type: 'onset', time, peak }   time = AudioContext currentTime of the attack
     { type: 'level', peak }         periodic, for the live input meter
   Messages IN (from main thread):
     { threshold, releaseFactor, refractoryMs }   live-tunable detection params
   ════════════════════════════════════════════════════════════════════════════ */
'use strict';

class OnsetDetector extends AudioWorkletProcessor {
  constructor() {
    super();
    this.threshold = 0.06;        // peak level that counts as a hit (set via sensitivity calibration)
    this.releaseFactor = 0.5;     // must fall below threshold*releaseFactor before re-arming (hysteresis)
    this.refractorySec = 0.040;   // min gap between onsets (< 62.5ms so 240bpm 16ths still register)
    this.armed = true;            // ready to fire (false until envelope falls below the release level)
    this.lastOnset = -1e9;        // AudioContext time of the last onset
    this.dcPrevIn = 0;            // DC blocker state
    this.dcPrevOut = 0;
    this.meterPeak = 0;           // running peak for the level meter
    this.meterBlocks = 0;

    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (typeof d.threshold === 'number') this.threshold = d.threshold;
      if (typeof d.releaseFactor === 'number') this.releaseFactor = d.releaseFactor;
      if (typeof d.refractoryMs === 'number') this.refractorySec = d.refractoryMs / 1000;
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0];                 // mono (first channel)
    if (!ch) return true;

    const sr = sampleRate;
    const t0 = currentTime;              // time of the first sample of this block
    const release = this.threshold * this.releaseFactor;
    let blockPeak = 0;

    for (let i = 0; i < ch.length; i++) {
      // DC blocker: y = x - x1 + R*y1  (removes offset/rumble, keeps transients)
      const x = ch[i];
      const y = x - this.dcPrevIn + 0.995 * this.dcPrevOut;
      this.dcPrevIn = x;
      this.dcPrevOut = y;
      const mag = y < 0 ? -y : y;
      if (mag > blockPeak) blockPeak = mag;

      if (this.armed) {
        if (mag >= this.threshold) {
          const t = t0 + i / sr;
          if (t - this.lastOnset >= this.refractorySec) {
            this.lastOnset = t;
            this.armed = false;
            this.port.postMessage({ type: 'onset', time: t, peak: mag });
          } else {
            this.armed = false;          // within refractory — swallow, wait for re-arm
          }
        }
      } else if (mag < release) {
        this.armed = true;               // fell back below release → ready for the next hit
      }
    }

    // Throttle level updates to ~30/sec for the meter (every ~8 blocks).
    if (blockPeak > this.meterPeak) this.meterPeak = blockPeak;
    if (++this.meterBlocks >= 8) {
      this.port.postMessage({ type: 'level', peak: this.meterPeak });
      this.meterPeak = 0;
      this.meterBlocks = 0;
    }
    return true;
  }
}

registerProcessor('onset-detector', OnsetDetector);

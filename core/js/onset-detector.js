/* ════════════════════════════════════════════════════════════════════════════
   ONSET DETECTOR — AudioWorklet processor for audio-input mode.

   Runs on the audio thread (128-sample blocks ≈ 2.7ms at 48kHz), so it timestamps
   a drum attack to within a few ms — far tighter than main-thread polling (~16ms).

   DETECTION = RETRIGGER-CANCEL MASK (what hardware drum triggers do). The naive
   "level crossed a fixed threshold" fires repeatedly during one hit because the
   ring / snare-wire rattle keeps re-crossing it. Instead, when a hit fires we
   record its PEAK and start a threshold CURVE that begins at that peak and decays
   over ~maskMs. The decaying tail of the same hit always sits UNDER this curve, so
   it can't re-fire; but a genuine next hit is a fresh peak that rises ABOVE the
   (by-then-decayed) curve, so it fires — even fast 16ths. A short mask-time blocks
   the attack body from firing on consecutive samples.

   Watches ALL input channels (max-abs) so a signal on any channel is seen (e.g. a
   Scarlett's ¼" instrument jack on channel 2).

   Messages OUT: { type:'onset', time, peak } · { type:'level', peak } · { type:'info', channels }
   Messages IN : { threshold, maskMs, minMaskMs }   live-tunable
   ════════════════════════════════════════════════════════════════════════════ */
'use strict';

class OnsetDetector extends AudioWorkletProcessor {
  constructor() {
    super();
    this.threshold = 0.04;        // noise-floor gate: peak must exceed this to count (set via sensitivity)
    this.maskTau = 0.110;         // s — retrigger-cancel curve decay (covers snare ring/rattle)
    this.minMaskSec = 0.030;      // s — dead time right after a hit (< 60ms so 250bpm 16ths register)

    this.fastEnv = 0;             // ~2ms follower (instantaneous level)
    this.curPeak = 0;             // peak of the current hit (anchors the mask curve)
    this.lastOnset = -1e9;
    this.dcPrevIn = 0;
    this.dcPrevOut = 0;
    this.meterPeak = 0;
    this.meterBlocks = 0;
    this.announced = false;
    this.fastCoef = -1;

    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (typeof d.threshold === 'number') this.threshold = d.threshold;
      if (typeof d.maskMs === 'number') this.maskTau = d.maskMs / 1000;
      if (typeof d.minMaskMs === 'number') this.minMaskSec = d.minMaskMs / 1000;
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const nCh = input.length;
    const ch0 = input[0];
    if (!ch0 || ch0.length === 0) return true;
    const len = ch0.length;
    if (!this.announced) { this.announced = true; this.port.postMessage({ type: 'info', channels: nCh }); }

    const sr = sampleRate;
    if (this.fastCoef < 0) this.fastCoef = Math.exp(-1 / (sr * 0.002));   // ~2ms release
    const t0 = currentTime;
    let blockPeak = 0;

    for (let i = 0; i < len; i++) {
      // Most extreme sample across channels (any channel may carry the signal).
      let x = 0, xa = 0;
      for (let c = 0; c < nCh; c++) {
        const v = input[c][i];
        const a = v < 0 ? -v : v;
        if (a > xa) { xa = a; x = v; }
      }
      // DC blocker, then rectify, then fast envelope (instant attack, ~2ms release).
      const yv = x - this.dcPrevIn + 0.995 * this.dcPrevOut;
      this.dcPrevIn = x;
      this.dcPrevOut = yv;
      const rect = yv < 0 ? -yv : yv;
      if (rect > blockPeak) blockPeak = rect;
      this.fastEnv = rect > this.fastEnv ? rect : rect + (this.fastEnv - rect) * this.fastCoef;

      const t = t0 + i / sr;
      const dt = t - this.lastOnset;
      if (this.fastEnv > this.curPeak) this.curPeak = this.fastEnv;   // track this hit's true peak

      // Retrigger-cancel curve: starts at the last hit's peak, decays over maskTau.
      const mask = this.curPeak * Math.exp(-dt / this.maskTau);
      const floor = mask > this.threshold ? mask : this.threshold;

      // Fire only past the dead time AND above the decaying curve + gate.
      if (dt >= this.minMaskSec && this.fastEnv >= floor && this.fastEnv >= this.threshold) {
        this.lastOnset = t;
        this.curPeak = this.fastEnv;     // re-anchor the curve to this new hit
        this.port.postMessage({ type: 'onset', time: t, peak: this.fastEnv });
      }
    }

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

/* ════════════════════════════════════════════════════════════════════════════
   ONSET DETECTOR — AudioWorklet processor for audio-input mode.

   Runs on the audio thread (128-sample blocks ≈ 2.7ms at 48kHz), so it can
   timestamp a drum attack to within a few ms — far tighter than polling on the
   main thread (~16ms).

   DETECTION = TRANSIENT FLUX, not a bare threshold. A naive "level crossed a
   threshold" fires many times during one hit because the ring/decay keeps
   re-crossing. Instead we track a FAST envelope (the instantaneous level) and a
   SLOW envelope (the recent background), and fire only when the fast level SURGES
   above the slow background by a ratio — i.e. on a real attack. A decay falls
   toward the background (no surge), so it can't re-fire; but a genuine next hit —
   even mid-decay — surges above the elevated background and fires. This handles
   both ringy snares and fast 16ths. A short refractory guards the attack itself.

   Watches ALL input channels (max-abs across them) so a signal on any channel is
   seen (e.g. a Scarlett's ¼" instrument jack lands on channel 2).

   Messages OUT: { type:'onset', time, peak } · { type:'level', peak } · { type:'info', channels }
   Messages IN : { threshold, riseRatio, refractoryMs }   live-tunable
   ════════════════════════════════════════════════════════════════════════════ */
'use strict';

class OnsetDetector extends AudioWorkletProcessor {
  constructor() {
    super();
    this.threshold = 0.045;       // noise gate: fast level must exceed this to count (set via sensitivity)
    this.riseRatio = 2.2;         // fast must exceed slow*riseRatio to be an attack (ring rejection)
    this.refractorySec = 0.035;   // min gap between onsets (< 60ms so 250bpm 16ths still register)

    this.fastEnv = 0;             // ~2ms follower — the instantaneous level
    this.slowEnv = 0;             // ~120ms follower — the recent background
    this.armed = true;
    this.lastOnset = -1e9;
    this.dcPrevIn = 0;
    this.dcPrevOut = 0;
    this.meterPeak = 0;
    this.meterBlocks = 0;
    this.announced = false;
    this.fastCoef = -1;           // computed from sampleRate on first block
    this.slowCoef = -1;

    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (typeof d.threshold === 'number') this.threshold = d.threshold;
      if (typeof d.riseRatio === 'number') this.riseRatio = d.riseRatio;
      if (typeof d.refractoryMs === 'number') this.refractorySec = d.refractoryMs / 1000;
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
    if (this.fastCoef < 0) {
      this.fastCoef = Math.exp(-1 / (sr * 0.002));   // ~2ms  release on the fast follower
      this.slowCoef = Math.exp(-1 / (sr * 0.120));   // ~120ms smoothing on the background
    }
    const t0 = currentTime;
    const ratio = this.riseRatio;
    let blockPeak = 0;

    for (let i = 0; i < len; i++) {
      // Most extreme sample across channels (any channel may carry the signal).
      let x = 0, xa = 0;
      for (let c = 0; c < nCh; c++) {
        const v = input[c][i];
        const a = v < 0 ? -v : v;
        if (a > xa) { xa = a; x = v; }
      }
      // DC blocker, then rectify.
      const y = x - this.dcPrevIn + 0.995 * this.dcPrevOut;
      this.dcPrevIn = x;
      this.dcPrevOut = y;
      const rect = y < 0 ? -y : y;
      if (rect > blockPeak) blockPeak = rect;

      // Fast follower: instant attack, ~2ms release. Slow follower: smooth background.
      this.fastEnv = rect > this.fastEnv ? rect : rect + (this.fastEnv - rect) * this.fastCoef;
      this.slowEnv = rect + (this.slowEnv - rect) * this.slowCoef;

      const surge = this.slowEnv * ratio + 1e-5;     // level that counts as "rose above background"
      if (this.armed) {
        if (this.fastEnv >= this.threshold && this.fastEnv >= surge) {
          const t = t0 + i / sr;
          this.armed = false;
          if (t - this.lastOnset >= this.refractorySec) {
            this.lastOnset = t;
            this.port.postMessage({ type: 'onset', time: t, peak: this.fastEnv });
          }
        }
      } else if (this.fastEnv < surge) {
        // The surge has subsided relative to the (now-elevated) background → ready
        // for the next attack. Happens within a few ms, so fast hits still register;
        // a slow decay never re-surges, so the ring can't re-fire.
        this.armed = true;
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

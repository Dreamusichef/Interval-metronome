'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   AUDIO INPUT — capture an audio interface / mic and turn drum hits into onset
   events, as an alternative to MIDI. Opens the game to acoustic kits, triggered
   kits via a Focusrite-style interface, and to Safari/Firefox (no Web MIDI there).

   Uses the metronome's shared AudioContext so onset times are on the SAME clock
   the click is scheduled against. Browser DSP (echo-cancel / noise-suppress /
   auto-gain) is forced OFF — those smear transients and add variable latency.

   The systematic latency of the audio path is removed by the existing offset
   calibration (it measures total offset and subtracts the mean), exactly like
   MIDI — so audio "just works" within that model; only hit-to-hit variance is
   tested. Onset detection itself lives in onset-detector.js (AudioWorklet).

   Public API (window.AudioInput):
     listDevices()                         → [{deviceId, label}]
     start(audioCtx, deviceId, handlers)   handlers = { onOnset(perfMs, peak), onLevel(peak), onError(msg) }
     stop()
     setThreshold(v) / setRefractory(ms)
     isActive()
   ════════════════════════════════════════════════════════════════════════════ */
const AudioInput = (() => {
  let stream = null;
  let sourceNode = null;
  let workletNode = null;
  let ctx = null;
  let active = false;
  let handlers = {};
  let moduleAdded = false;

  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
              window.AudioWorkletNode);
  }

  function resolveWorkletUrl() {
    if (typeof document !== 'undefined') {
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const src = scripts[i].src || '';
        if (/audio-input\.js/.test(src)) {
          return src.replace(/audio-input\.js[^/]*$/, 'onset-detector.js?v=1');
        }
      }
    }
    return 'js/onset-detector.js?v=1';
  }

  async function listDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter(d => d.kind === 'audioinput')
                .map(d => ({ deviceId: d.deviceId, label: d.label || 'Audio input' }));
    } catch (e) { return []; }
  }

  // Open the chosen input and wire mic → onset-detector worklet. handlers.onOnset
  // receives a perf-clock timestamp (same domain as Web MIDI event.timeStamp), so
  // it drops straight into the existing kick-event pipeline.
  async function start(audioCtx, deviceId, h) {
    handlers = h || {};
    ctx = audioCtx;
    if (!supported()) { fail('Audio input needs a modern browser (Chrome, Edge, Firefox, or Safari).'); return false; }
    await stop();

    // Capture with all browser processing disabled — we want the raw transient.
    // No channelCount constraint: keep the device's native channels (e.g. the
    // Scarlett's 2) so the detector can watch whichever channel carries the signal.
    const audioConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
    if (deviceId) audioConstraints.deviceId = { exact: deviceId };

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
    } catch (e) {
      fail('Mic/interface access denied or unavailable: ' + (e && e.message ? e.message : e));
      return false;
    }

    try {
      if (!moduleAdded) {
        const url = resolveWorkletUrl();
        await ctx.audioWorklet.addModule(url);
        moduleAdded = true;
      }
    } catch (e) {
      fail('Could not load the onset detector (browser too old?): ' + (e && e.message ? e.message : e));
      stopStream();
      return false;
    }

    sourceNode = ctx.createMediaStreamSource(stream);
    // 'max' + 'discrete' so the processor receives the source's raw channels
    // (no stereo speaker-downmix) — needed to see a signal on channel 2, etc.
    workletNode = new AudioWorkletNode(ctx, 'onset-detector', {
      channelCountMode: 'max',
      channelInterpretation: 'discrete',
    });
    workletNode.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.type === 'onset') {
        // Convert the onset's AudioContext time → perf-clock ms, anchored on "now"
        // (the relationship is exact at this instant; no stored sync needed).
        const perf = performance.now() - (ctx.currentTime - d.time) * 1000;
        if (handlers.onOnset) handlers.onOnset(perf, d.peak);
      } else if (d.type === 'level') {
        if (handlers.onLevel) handlers.onLevel(d.peak);
      } else if (d.type === 'info') {
        console.info('[audio] input channels:', d.channels);
      }
    };
    // mic → detector. We do NOT connect to destination (no monitoring — the player
    // hears their acoustic drum directly; routing to output would cause feedback).
    sourceNode.connect(workletNode);
    // Some browsers won't pull audio through a worklet with no downstream node;
    // a muted gain sink keeps the graph alive without making sound.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    workletNode.connect(sink).connect(ctx.destination);

    active = true;
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) {} }
    return true;
  }

  function setThreshold(v) { if (workletNode) workletNode.port.postMessage({ threshold: v }); }
  function setRefractory(ms) { if (workletNode) workletNode.port.postMessage({ refractoryMs: ms }); }

  function stopStream() {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }
  async function stop() {
    active = false;
    try { if (sourceNode) sourceNode.disconnect(); } catch (e) {}
    try { if (workletNode) workletNode.disconnect(); } catch (e) {}
    sourceNode = null; workletNode = null;
    stopStream();
  }

  function fail(msg) { if (handlers.onError) handlers.onError(msg); else console.warn('[audio]', msg); }
  function isActive() { return active; }

  return { supported, listDevices, start, stop, setThreshold, setRefractory, isActive };
})();
if (typeof window !== 'undefined') window.AudioInput = AudioInput;

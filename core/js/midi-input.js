'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   MIDI INPUT — Web MIDI device list, note-on handler, debounce, pad learn.
   DOM-free: status / learn feedback via callbacks. Dual export (window + module).
   ════════════════════════════════════════════════════════════════════════════ */

const MidiInput = (() => {
  const KICK_DEBOUNCE_MS = 15;
  const DEFAULT_NOTE = { kick: 36, snare: 38 };
  // Accepted without learn: GM + Alesis Strata Prime (non-standard mapping).
  const PLAYABLE_NOTES = { kick: [24, 35, 36], snare: [26, 38] };
  const LEARN_NOTES = PLAYABLE_NOTES;
  const INSTR_LABEL = { kick: 'Kick', snare: 'Snare' };

  let midiAccess = null;
  let midiInputs = [];          // [{ id, name }]
  let selectedInputId = null;
  let instrumentNote = DEFAULT_NOTE.kick;
  let playableNotes = PLAYABLE_NOTES.kick.slice();
  let debounceMs = KICK_DEBOUNCE_MS;
  let lastNoteTs = -Infinity;
  let learning = false;
  let learnAllowed = null;      // number[] while learning
  let onLearnedCb = null;
  let onRejectCb = null;
  let noteHandler = null;       // (perfMs, note, velocity) => void
  let statusHandler = null;     // (msg, isErr) => void
  let onInputsChanged = null;   // (inputs) => void

  function emitStatus(msg, isErr) {
    if (typeof statusHandler === 'function') statusHandler(msg, !!isErr);
  }

  function supported() {
    return !unavailableReason();
  }

  // Web MIDI is only exposed in secure contexts (HTTPS, or http://localhost).
  function unavailableReason() {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) ||
      (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS) {
      return 'Web MIDI is not available on iPhone/iPad. Use Audio input instead.';
    }
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      return 'Web MIDI needs HTTPS (browsers only allow it on https:// pages and localhost). ' +
        'For LAN dev run: npm run dev:lan — then open https://<server-ip>:8127 and accept the certificate warning.';
    }
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
      return 'Web MIDI not supported in this browser.';
    }
    return null;
  }

  async function requestAccess() {
    const blocked = unavailableReason();
    if (blocked) {
      emitStatus(blocked, true);
      return false;
    }
    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    } catch (e) {
      if (e && e.name === 'SecurityError') {
        emitStatus(unavailableReason() || 'MIDI blocked: serve this page over HTTPS.', true);
        return false;
      }
      emitStatus('MIDI access denied: ' + (e && e.message ? e.message : e), true);
      return false;
    }
    midiAccess.onstatechange = refreshInputs;
    refreshInputs();
    return true;
  }

  function refreshInputs() {
    midiInputs = [];
    if (midiAccess) {
      for (const input of midiAccess.inputs.values()) {
        midiInputs.push({ id: input.id, name: input.name || input.id });
      }
    }
    if (midiInputs.length && !midiInputs.some(i => i.id === selectedInputId)) {
      selectedInputId = midiInputs[0].id;
    }
    attachToSelectedInput();
    if (!midiInputs.length) {
      emitStatus('No MIDI inputs found. Connect your module and try again.', true);
    } else {
      const cur = midiInputs.find(i => i.id === selectedInputId);
      emitStatus('Connected: ' + (cur ? cur.name : '—'), false);
    }
    if (typeof onInputsChanged === 'function') onInputsChanged(midiInputs.slice());
  }

  function attachToSelectedInput() {
    if (!midiAccess) return;
    for (const input of midiAccess.inputs.values()) {
      input.onmidimessage = (input.id === selectedInputId) ? handleMidiMessage : null;
    }
  }

  function getInputs() {
    return midiInputs.slice();
  }

  function setInputId(id) {
    selectedInputId = id;
    attachToSelectedInput();
    const cur = midiInputs.find(i => i.id === selectedInputId);
    emitStatus('Connected: ' + (cur ? cur.name : '—'), false);
    if (typeof onInputsChanged === 'function') onInputsChanged(midiInputs.slice());
  }

  function getInputId() {
    return selectedInputId;
  }

  function setInstrumentNote(note) {
    instrumentNote = note;
  }

  function getInstrumentNote() {
    return instrumentNote;
  }

  function setPlayableNotes(notes) {
    playableNotes = Array.isArray(notes) ? notes.slice() : [];
  }

  function setInstrument(instr) {
    if (instr !== 'kick' && instr !== 'snare') return;
    instrumentNote = DEFAULT_NOTE[instr];
    playableNotes = (PLAYABLE_NOTES[instr] || []).slice();
  }

  function noteMatches(note) {
    if (note === instrumentNote) return true;
    return playableNotes.includes(note);
  }

  function setDebounceMs(ms) {
    if (typeof ms === 'number' && ms >= 0) debounceMs = ms;
  }

  function onNote(fn) {
    noteHandler = typeof fn === 'function' ? fn : null;
  }

  function setHandler(fn) { onNote(fn); }

  function onStatus(fn) {
    statusHandler = typeof fn === 'function' ? fn : null;
  }

  function setOnInputsChanged(fn) {
    onInputsChanged = typeof fn === 'function' ? fn : null;
  }

  function startLearn({ allowedNotes, onLearned, onReject } = {}) {
    if (!midiAccess) {
      emitStatus('Connect MIDI first.', true);
      return false;
    }
    learning = true;
    learnAllowed = Array.isArray(allowedNotes) ? allowedNotes.slice() : null;
    onLearnedCb = typeof onLearned === 'function' ? onLearned : null;
    onRejectCb = typeof onReject === 'function' ? onReject : null;
    return true;
  }

  function cancelLearn() {
    learning = false;
    learnAllowed = null;
    onLearnedCb = null;
    onRejectCb = null;
  }

  function isLearning() {
    return learning;
  }

  function hasAccess() {
    return !!midiAccess;
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
    // moment we received it, fall back to performance.now() at receipt.
    const recv = performance.now();
    let ts = event.timeStamp;
    if (!(typeof ts === 'number') || ts <= 0 || Math.abs(ts - recv) > 1000) ts = recv;

    if (learning) {
      if (learnAllowed && !learnAllowed.includes(note)) {
        const msg = 'Learn only accepts MIDI notes ' + learnAllowed.join(', ') + '. Hit your pad.';
        emitStatus(msg, true);
        if (onRejectCb) onRejectCb(note, msg);
        return;
      }
      learning = false;
      instrumentNote = note;
      const cb = onLearnedCb;
      onLearnedCb = null;
      onRejectCb = null;
      learnAllowed = null;
      if (cb) cb(note);
      return;
    }

    if (noteMatches(note)) {
      // Debounce hardware double-triggers (one physical hit → two note-ons).
      if (ts - lastNoteTs < debounceMs) return;
      lastNoteTs = ts;
      if (noteHandler) noteHandler(ts, note, velocity);
    }
  }

  return {
    KICK_DEBOUNCE_MS,
    DEFAULT_NOTE,
    PLAYABLE_NOTES,
    LEARN_NOTES,
    INSTR_LABEL,
    supported,
    unavailableReason,
    requestAccess,
    refreshInputs,
    getInputs,
    setInputId,
    getInputId,
    setInstrumentNote,
    getInstrumentNote,
    setPlayableNotes,
    setInstrument,
    startLearn,
    cancelLearn,
    isLearning,
    onNote,
    setHandler,
    onStatus,
    setOnInputsChanged,
    setDebounceMs,
    noteMatches,
    hasAccess,
  };
})();

if (typeof window !== 'undefined') window.MidiInput = MidiInput;
if (typeof module !== 'undefined' && module.exports) module.exports = MidiInput;

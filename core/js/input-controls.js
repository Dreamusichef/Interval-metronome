'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   INPUT CONTROLS — mount() chrome for MIDI / audio source UI.
   Binds to existing markup (default selectors match Game Mode IDs in index.html).
   Missing elements → no-op. Dual export (window + module).
   ════════════════════════════════════════════════════════════════════════════ */

const InputControls = (() => {
  const DEFAULT_SELECTORS = {
    inputBtns: '.rogue-input-btn',
    midiSteps: '#rogueMidiSteps',
    audioSteps: '#rogueAudioSteps',
    midiBtn: '#rogueMidiBtn',
    deviceSelect: '#rogueDeviceSelect',
    midiStatus: '#rogueMidiStatus',
    learnBtn: '#rogueLearnBtn',
    kickNote: '#rogueKickNote',
    audioEnableBtn: '#rogueAudioEnableBtn',
    audioDeviceSelect: '#rogueAudioDeviceSelect',
    audioStatus: '#rogueAudioStatus',
    audioMeter: '#rogueAudioMeter',
    audioMeterFill: '#rogueAudioMeterFill',
    audioMeterPeak: '#rogueAudioMeterPeak',
    audioGain: '#rogueAudioGain',
    audioSensBtn: '#rogueAudioSensBtn',
  };

  function qs(root, sel) {
    if (!sel || !root) return null;
    try { return root.querySelector(sel); } catch (e) { return null; }
  }

  function qsa(root, sel) {
    if (!sel || !root) return [];
    try { return Array.from(root.querySelectorAll(sel)); } catch (e) { return []; }
  }

  function applyTheme(root, theme) {
    if (!root || !theme || typeof theme !== 'object') return;
    Object.keys(theme).forEach(k => {
      const cssKey = k.startsWith('--') ? k : '--' + k.replace(/([A-Z])/g, '-$1').toLowerCase();
      try { root.style.setProperty(cssKey, theme[k]); } catch (e) {}
    });
  }

  /**
   * options: {
   *   theme, layout,
   *   selectors,          // overrides DEFAULT_SELECTORS
   *   onSourceChange,     // (src) => void  'midi'|'audio'
   *   onDeviceChange,     // (deviceId) => void
   *   onConnectMidi,      // () => void
   *   onLearn,            // () => void
   *   onEnableAudio,      // () => void
   *   onSensitivity,      // () => void
   *   onAudioDeviceChange,// (deviceId) => void
   *   getState,           // () => { inputSource, ... }
   * }
   */
  function mount(root, options) {
    options = options || {};
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope) return { els: {}, destroy() {}, setMidiStatus() {}, setAudioStatus() {} };

    applyTheme(root && root.style ? root : null, options.theme);
    if (root && root.classList && options.layout) {
      root.classList.add('input-controls--' + options.layout);
    }

    const sel = Object.assign({}, DEFAULT_SELECTORS, options.selectors || {});
    const els = {
      inputBtns: qsa(scope, sel.inputBtns),
      midiSteps: qs(scope, sel.midiSteps),
      audioSteps: qs(scope, sel.audioSteps),
      midiBtn: qs(scope, sel.midiBtn),
      deviceSelect: qs(scope, sel.deviceSelect),
      midiStatus: qs(scope, sel.midiStatus),
      learnBtn: qs(scope, sel.learnBtn),
      kickNote: qs(scope, sel.kickNote),
      audioEnableBtn: qs(scope, sel.audioEnableBtn),
      audioDeviceSelect: qs(scope, sel.audioDeviceSelect),
      audioStatus: qs(scope, sel.audioStatus),
      audioMeter: qs(scope, sel.audioMeter),
      audioMeterFill: qs(scope, sel.audioMeterFill),
      audioMeterPeak: qs(scope, sel.audioMeterPeak),
      audioGain: qs(scope, sel.audioGain),
      audioSensBtn: qs(scope, sel.audioSensBtn),
    };

    const listeners = [];
    function on(node, type, fn) {
      if (!node) return;
      node.addEventListener(type, fn);
      listeners.push({ node, type, fn });
    }

    els.inputBtns.forEach(b => {
      on(b, 'click', () => {
        if (typeof options.onSourceChange === 'function') options.onSourceChange(b.dataset.src);
      });
    });
    on(els.midiBtn, 'click', () => {
      if (typeof options.onConnectMidi === 'function') options.onConnectMidi();
    });
    on(els.learnBtn, 'click', () => {
      if (typeof options.onLearn === 'function') options.onLearn();
    });
    on(els.deviceSelect, 'change', () => {
      if (typeof options.onDeviceChange === 'function') options.onDeviceChange(els.deviceSelect.value);
    });
    on(els.audioEnableBtn, 'click', () => {
      if (typeof options.onEnableAudio === 'function') options.onEnableAudio();
    });
    on(els.audioSensBtn, 'click', () => {
      if (typeof options.onSensitivity === 'function') options.onSensitivity();
    });
    on(els.audioDeviceSelect, 'change', () => {
      if (typeof options.onAudioDeviceChange === 'function') {
        options.onAudioDeviceChange(els.audioDeviceSelect.value);
      }
    });

    function setStatus(node, msg, isErr) {
      if (!node) return;
      node.textContent = msg;
      node.classList.toggle('error', !!isErr);
      node.classList.remove('countin', 'live');
    }

    function setMidiStatus(msg, isErr) { setStatus(els.midiStatus, msg, isErr); }
    function setAudioStatus(msg, isErr) { setStatus(els.audioStatus, msg, isErr); }

    function reflectSource(src) {
      const audio = src === 'audio';
      els.inputBtns.forEach(b => b.classList.toggle('active', b.dataset.src === src));
      if (els.midiSteps) els.midiSteps.style.display = audio ? 'none' : '';
      if (els.audioSteps) els.audioSteps.style.display = audio ? '' : 'none';
    }

    function renderDevices(inputs, selectedId) {
      if (!els.deviceSelect) return;
      els.deviceSelect.innerHTML = '';
      (inputs || []).forEach(i => {
        const opt = document.createElement('option');
        opt.value = i.id;
        opt.textContent = i.name;
        if (i.id === selectedId) opt.selected = true;
        els.deviceSelect.appendChild(opt);
      });
      els.deviceSelect.style.display = (inputs && inputs.length > 1) ? '' : 'none';
    }

    function destroy() {
      listeners.forEach(({ node, type, fn }) => node.removeEventListener(type, fn));
      listeners.length = 0;
    }

    if (typeof options.getState === 'function') {
      const st = options.getState();
      if (st && st.inputSource) reflectSource(st.inputSource);
    }

    return {
      els,
      destroy,
      setMidiStatus,
      setAudioStatus,
      reflectSource,
      renderDevices,
      DEFAULT_SELECTORS,
    };
  }

  return { mount, DEFAULT_SELECTORS };
})();

if (typeof window !== 'undefined') window.InputControls = InputControls;
if (typeof module !== 'undefined' && module.exports) module.exports = InputControls;

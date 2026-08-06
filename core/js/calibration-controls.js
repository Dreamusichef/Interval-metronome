'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   CALIBRATION CONTROLS — mount() chrome for two-pass calibration UI.
   Binds to existing markup (default selectors match Game Mode IDs in index.html).
   Missing elements → no-op. Dual export (window + module).
   ════════════════════════════════════════════════════════════════════════════ */

const CalibrationControls = (() => {
  const DEFAULT_SELECTORS = {
    calQuartersBtn: '#rogueCalQuartersBtn',
    cal16Btn: '#rogueCal16Btn',
    cal16Bpm: '#rogueCal16Bpm',
    calStatus: '#rogueCalStatus',
    calStopBtn: '#rogueCalStopBtn',
    manualOffset: '#rogueManualOffset',
    manualBtn: '#rogueManualBtn',
  };

  function qs(root, sel) {
    if (!sel || !root) return null;
    try { return root.querySelector(sel); } catch (e) { return null; }
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
   *   theme, layout, selectors,
   *   onCalQuarters,   // () => void
   *   onCal16,         // () => void
   *   onStop,          // () => void
   *   onManual,        // () => void
   *   getState,        // () => { calibrating?, ... }
   * }
   */
  function mount(root, options) {
    options = options || {};
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope) {
      return { els: {}, destroy() {}, setStatus() {}, setStatusBanner() {}, getBpm() { return 100; } };
    }

    applyTheme(root && root.style ? root : null, options.theme);
    if (root && root.classList && options.layout) {
      root.classList.add('calibration-controls--' + options.layout);
    }

    const sel = Object.assign({}, DEFAULT_SELECTORS, options.selectors || {});
    const els = {
      calQuartersBtn: qs(scope, sel.calQuartersBtn),
      cal16Btn: qs(scope, sel.cal16Btn),
      cal16Bpm: qs(scope, sel.cal16Bpm),
      calStatus: qs(scope, sel.calStatus),
      calStopBtn: qs(scope, sel.calStopBtn),
      manualOffset: qs(scope, sel.manualOffset),
      manualBtn: qs(scope, sel.manualBtn),
    };

    const listeners = [];
    function on(node, type, fn) {
      if (!node) return;
      node.addEventListener(type, fn);
      listeners.push({ node, type, fn });
    }

    on(els.calQuartersBtn, 'click', () => {
      if (typeof options.onCalQuarters === 'function') options.onCalQuarters();
    });
    on(els.cal16Btn, 'click', () => {
      if (typeof options.onCal16 === 'function') options.onCal16();
    });
    on(els.calStopBtn, 'click', () => {
      if (typeof options.onStop === 'function') options.onStop();
    });
    on(els.manualBtn, 'click', () => {
      if (typeof options.onManual === 'function') options.onManual();
    });

    function setStatus(msg, isErr) {
      if (!els.calStatus) return;
      els.calStatus.textContent = msg;
      els.calStatus.classList.toggle('error', !!isErr);
      els.calStatus.classList.remove('countin', 'live');
    }

    function setStatusBanner(msg, cls) {
      if (!els.calStatus) return;
      els.calStatus.textContent = msg;
      els.calStatus.classList.remove('error');
      els.calStatus.classList.toggle('countin', cls === 'countin');
      els.calStatus.classList.toggle('live', cls === 'live');
    }

    function getBpm(fallback) {
      const fb = fallback != null ? fallback : 100;
      if (!els.cal16Bpm) return fb;
      const v = parseInt(els.cal16Bpm.value, 10);
      return Number.isNaN(v) ? fb : v;
    }

    function getManualOffset() {
      if (!els.manualOffset) return NaN;
      return parseFloat(els.manualOffset.value);
    }

    function setCalibrating(busy) {
      if (els.calStopBtn) els.calStopBtn.style.display = busy ? '' : 'none';
    }

    function destroy() {
      listeners.forEach(({ node, type, fn }) => node.removeEventListener(type, fn));
      listeners.length = 0;
    }

    return {
      els,
      destroy,
      setStatus,
      setStatusBanner,
      getBpm,
      getManualOffset,
      setCalibrating,
      DEFAULT_SELECTORS,
    };
  }

  return { mount, DEFAULT_SELECTORS };
})();

if (typeof window !== 'undefined') window.CalibrationControls = CalibrationControls;
if (typeof module !== 'undefined' && module.exports) module.exports = CalibrationControls;

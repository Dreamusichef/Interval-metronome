'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   SETTINGS — top-right gear panel. Home for app-wide toggles.
   Currently: "Keep screen awake" (Screen Wake Lock API), persisted in
   localStorage and re-acquired when the tab regains focus.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  const gear = document.getElementById('settingsGear');
  const overlay = document.getElementById('settingsOverlay');
  const closeBtn = document.getElementById('settingsClose');
  const wakeToggle = document.getElementById('wakeLockToggle');
  const wakeNote = document.getElementById('wakeLockNote');
  if (!gear || !overlay) return;

  let readoutTimer = null;
  const open = () => { overlay.hidden = false; startReadout(); };
  const close = () => { overlay.hidden = true; stopReadout(); };
  gear.addEventListener('click', open);
  closeBtn && closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); });

  // ── Auto latency correction (opt-in, default off) ──
  const LAT_KEY = 'gm_latencycomp';
  const latToggle = document.getElementById('latencyCompToggle');
  const latReadout = document.getElementById('latencyReadout');
  window.__latencyCompEnabled = (localStorage.getItem(LAT_KEY) === '1');
  if (latToggle) {
    latToggle.checked = window.__latencyCompEnabled;
    latToggle.addEventListener('change', () => {
      window.__latencyCompEnabled = latToggle.checked;
      localStorage.setItem(LAT_KEY, latToggle.checked ? '1' : '0');
    });
  }
  // Live output-latency readout (lets you watch it move when you change power/output).
  function readLatency() {
    try {
      const ctx = (typeof MetronomeEngine !== 'undefined') && MetronomeEngine.getAudioContext();
      if (ctx && typeof ctx.outputLatency === 'number' && ctx.outputLatency > 0) return Math.round(ctx.outputLatency * 1000);
    } catch (e) {}
    return null;
  }
  function startReadout() {
    if (!latReadout) return;
    const tick = () => { const ms = readLatency(); latReadout.textContent = ms == null ? '(output latency: start audio to measure)' : ('output latency: ' + ms + ' ms'); };
    tick();
    readoutTimer = setInterval(tick, 500);
  }
  function stopReadout() { if (readoutTimer) { clearInterval(readoutTimer); readoutTimer = null; } }

  // ── Keyboard-shortcuts collapsible ──
  const scRow = document.getElementById('shortcutsToggleRow');
  const scTable = document.getElementById('shortcutsTable');
  const scCaret = document.getElementById('shortcutsCaret');
  if (scRow && scTable) {
    scRow.addEventListener('click', () => {
      const show = scTable.hidden;
      scTable.hidden = !show;
      scRow.setAttribute('aria-expanded', show ? 'true' : 'false');
      if (scCaret) scCaret.style.transform = show ? 'rotate(180deg)' : '';
    });
  }

  // ── Screen Wake Lock ──
  const KEY = 'gm_wakelock';
  const supported = ('wakeLock' in navigator);
  let wakeLock = null;

  async function acquire() {
    if (!supported || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { /* user agent rejected (e.g. not visible) — retried on focus */ }
  }
  function release() { try { if (wakeLock) wakeLock.release(); } catch (e) {} wakeLock = null; }
  function wanted() { return localStorage.getItem(KEY) === '1'; }

  if (wakeToggle) {
    if (!supported) {
      wakeToggle.checked = false;
      wakeToggle.disabled = true;
      if (wakeNote) wakeNote.textContent = 'Not supported on this browser.';
    } else {
      wakeToggle.checked = wanted();
      wakeToggle.addEventListener('change', () => {
        localStorage.setItem(KEY, wakeToggle.checked ? '1' : '0');
        if (wakeToggle.checked) acquire(); else release();
      });
      if (wakeToggle.checked) acquire();
    }
  }

  // Wake locks auto-release when the tab is hidden — re-acquire on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wanted()) acquire();
  });
})();

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

  const open = () => { overlay.hidden = false; };
  const close = () => { overlay.hidden = true; };
  gear.addEventListener('click', open);
  closeBtn && closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); });

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

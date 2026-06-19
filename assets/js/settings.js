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

  const open = () => {
    overlay.hidden = false;
    if (window.ProfileSettings) ProfileSettings.loadAll();
  };
  const close = () => { overlay.hidden = true; };
  gear.addEventListener('click', open);
  closeBtn && closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); });

  // ── Auto latency correction (opt-in, default off) ──
  const LAT_KEY = 'gm_latencycomp';
  const latToggle = document.getElementById('latencyCompToggle');
  window.__latencyCompEnabled = (localStorage.getItem(LAT_KEY) === '1');
  if (latToggle) {
    latToggle.checked = window.__latencyCompEnabled;
    latToggle.addEventListener('change', () => {
      window.__latencyCompEnabled = latToggle.checked;
      localStorage.setItem(LAT_KEY, latToggle.checked ? '1' : '0');
    });
  }

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

  // ── Public profile collapsible ──
  const profileRow = document.getElementById('profileToggleRow');
  const profileBody = document.getElementById('profileSettings');
  const profileCaret = document.getElementById('profileCaret');
  if (profileRow && profileBody) {
    profileRow.addEventListener('click', () => {
      const show = profileBody.hidden;
      profileBody.hidden = !show;
      profileRow.setAttribute('aria-expanded', show ? 'true' : 'false');
      if (profileCaret) profileCaret.style.transform = show ? 'rotate(180deg)' : '';
      if (show && window.ProfileSettings) ProfileSettings.loadAll();
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

  // ── Provide Feedback (Tally form with hidden-field URL params) ──
  const FEEDBACK_URL = 'https://tally.so/r/kdr1od';
  const feedbackBtn = document.getElementById('feedbackBtn');

  function feedbackFormUrl() {
    const user = window.Cloud && Cloud.currentUser ? Cloud.currentUser() : null;
    const params = new URLSearchParams({
      app_version: window.APP_VERSION || '',
      user_agent: navigator.userAgent,
      user_id: (user && user.id) || '',
      created_at: new Date().toISOString(),
    });
    return `${FEEDBACK_URL}?${params}`;
  }

  if (feedbackBtn) {
    feedbackBtn.addEventListener('click', () => {
      window.open(feedbackFormUrl(), '_blank', 'noopener,noreferrer');
    });
  }
})();

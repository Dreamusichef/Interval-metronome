'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   APP BOOTSTRAP — documents which core modules this game metronome uses.
   Scripts are still loaded via <script defer> in index.html (classic dual-export
   modules). This file mounts shared chrome once the DOM is ready and core
   globals exist. Load after app.js / roguelite.js (defer order) or call from
   the end of the page.
   ════════════════════════════════════════════════════════════════════════════ */

(function () {
  function applyTheme(el, theme) {
    if (!el || !theme) return;
    Object.keys(theme).forEach(function (k) {
      const cssVar = k.charAt(0) === '-' ? k : '--' + k;
      el.style.setProperty(cssVar, theme[k]);
    });
  }

  function boot() {
    const root = document.getElementById('app') || document.querySelector('.app-container') || document.body;

    // Session controls are mounted from app.js (needs SessionEngine). Re-bind input/cal
    // chrome if those modules exported mount helpers and Game Mode panel exists.
    if (typeof InputControls !== 'undefined' && InputControls.mount) {
      const inputRoot = document.getElementById('roguePanel') || root;
      InputControls.mount(inputRoot, { layout: 'default' });
    }
    if (typeof CalibrationControls !== 'undefined' && CalibrationControls.mount) {
      const calRoot = document.getElementById('roguePanel') || root;
      CalibrationControls.mount(calRoot, { layout: 'default' });
    }

    // Auth bar is mounted by the async cloud loader in index.html once Cloud is ready.
    // Expose a helper for other pages that load this bootstrap.
    if (typeof window !== 'undefined') {
      window.CoreBoot = {
        applyTheme: applyTheme,
        remountAuthBar: function (el) {
          if (window.Cloud && window.Cloud.mountAuthBar) {
            window.Cloud.mountAuthBar(el || document.getElementById('cloudAuthBar'));
          }
        },
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

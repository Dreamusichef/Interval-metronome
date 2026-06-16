'use strict';

/** Single source for release version (BETA badge tooltip + feedback metadata). */
window.APP_VERSION = '0.9.0';

(function applyBrandVersion() {
  function set() {
    const el = document.getElementById('brandBeta');
    if (el) el.title = 'v' + window.APP_VERSION + ' — beta';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', set);
  else set();
})();

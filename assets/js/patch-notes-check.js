'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   PATCH NOTES CHECK — index.html only: detect unseen releases, show 48h banner.
   Silent no-op when Storage has no patch note files.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  const banner = document.getElementById('whatsNewBanner');
  const dismissBtn = document.getElementById('whatsNewDismiss');
  const Store = window.PatchNotesStorage;

  if (!Store) return;

  let currentLatest = null;

  function hideBanner() {
    if (banner) banner.hidden = true;
  }

  function showBanner(version) {
    if (!banner) return;
    const strong = banner.querySelector('.whats-new-version');
    if (strong) strong.textContent = 'v' + version;
    banner.hidden = false;
  }

  function applyState(state) {
    currentLatest = state.latest;
    if (!state.latest || !state.showBanner) {
      hideBanner();
      return;
    }
    showBanner(state.latest.version);
  }

  function refresh() {
    Store.listPatchNotes()
      .then((entries) => applyState(Store.getUnseenState(entries)))
      .catch(() => applyState({ latest: null, showBanner: false }));
  }

  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      if (currentLatest) Store.markSeen(currentLatest.version);
      hideBanner();
    });
  }

  document.addEventListener('patchnotes:seen', hideBanner);

  refresh();
})();

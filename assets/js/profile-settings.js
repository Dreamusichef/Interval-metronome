'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   PROFILE SETTINGS — alias + avatar editor and account deletion (Settings panel).
   Collapsible toggle lives in settings.js (same pattern as keyboard shortcuts).
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  const ERROR_MSG = {
    'alias-too-short': 'Alias must be at least 2 characters.',
    'alias-too-long': 'Alias must be 32 characters or fewer.',
    'avatar-invalid-url': 'Avatar URL must start with https://',
    'signed-out': 'Sign in to save your profile.',
    'save-failed': 'Could not save — try again.',
    'validation-unavailable': 'Profile validation unavailable.',
    'no-client': 'Cloud is not available.',
    'delete-failed': 'Could not delete account — try again.',
    'cancel-failed': 'Could not cancel deletion — try again.',
  };

  const DELETE_CONFIRM_WORD = 'delete';

  let domWired = false;
  let authWired = false;

  function googleAvatarUrl(user) {
    const m = (user && user.user_metadata) || {};
    return m.avatar_url || m.picture || null;
  }

  function detectAvatarMode(profile, user) {
    if (!profile || profile.avatar_url == null) return 'hidden';
    const g = googleAvatarUrl(user);
    if (g && profile.avatar_url === g) return 'google';
    return 'custom';
  }

  function setStatus(root, msg, isError) {
    const el = root.querySelector('.profile-status');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('is-error', !!isError);
  }

  function updateCustomVisibility(root) {
    const mode = root.querySelector('.profile-avatar-mode:checked');
    const customRow = root.querySelector('.profile-custom-url-row');
    const val = mode ? mode.value : 'hidden';
    if (customRow) customRow.hidden = val !== 'custom';
    updatePreview(root);
  }

  function updatePreview(root) {
    const preview = root.querySelector('.profile-avatar-preview');
    if (!preview) return;
    const mode = root.querySelector('.profile-avatar-mode:checked');
    const val = mode ? mode.value : 'hidden';
    let url = '';
    if (val === 'google') {
      const u = window.Cloud && Cloud.currentUser ? Cloud.currentUser() : null;
      const g = googleAvatarUrl(u);
      if (g && g.startsWith('https://')) url = g;
    } else if (val === 'custom') {
      const raw = (root.querySelector('.profile-avatar-url') || {}).value || '';
      if (raw.trim().startsWith('https://')) url = raw.trim();
    }
    if (url) {
      preview.src = url;
      preview.hidden = false;
    } else {
      preview.removeAttribute('src');
      preview.hidden = true;
    }
  }

  async function loadRoot(root) {
    if (!window.Cloud) return;
    const user = Cloud.currentUser();
    if (!user) return;
    setStatus(root, '');
    const profile = await Cloud.getProfile();
    const aliasInput = root.querySelector('.profile-alias-input');
    if (aliasInput) aliasInput.value = (profile && profile.display_name) || '';
    const mode = detectAvatarMode(profile, user);
    root.querySelectorAll('.profile-avatar-mode').forEach(r => {
      r.checked = r.value === mode;
    });
    const urlInput = root.querySelector('.profile-avatar-url');
    if (urlInput) {
      urlInput.value = (mode === 'custom' && profile && profile.avatar_url) ? profile.avatar_url : '';
    }
    updateCustomVisibility(root);
    await updateDeletionUi(root);
  }

  async function saveRoot(root) {
    if (!window.Cloud) return;
    const user = Cloud.currentUser();
    if (!user) {
      setStatus(root, ERROR_MSG['signed-out'], true);
      return;
    }
    const aliasInput = root.querySelector('.profile-alias-input');
    const mode = root.querySelector('.profile-avatar-mode:checked');
    const modeVal = mode ? mode.value : 'hidden';
    let avatar_url = null;
    if (modeVal === 'google') avatar_url = googleAvatarUrl(user);
    else if (modeVal === 'custom') avatar_url = ((root.querySelector('.profile-avatar-url') || {}).value || '').trim();
    setStatus(root, 'Saving…');
    const result = await Cloud.updateProfile({
      display_name: aliasInput ? aliasInput.value : '',
      avatar_url,
    });
    if (result && result.ok) {
      setStatus(root, 'Saved.');
      updatePreview(root);
      return;
    }
    const key = result && result.error;
    setStatus(root, ERROR_MSG[key] || 'Could not save.', true);
  }

  async function resetRoot(root) {
    if (!window.Cloud) return;
    setStatus(root, 'Resetting…');
    const result = await Cloud.resetProfileFromGoogle();
    if (result && result.ok) {
      await loadRoot(root);
      setStatus(root, 'Reset to Google profile.');
      return;
    }
    const key = result && result.error;
    setStatus(root, ERROR_MSG[key] || 'Could not reset.', true);
  }

  function formatDeletionDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
      });
    } catch (e) {
      return iso;
    }
  }

  async function updateDeletionUi(root) {
    const pendingEl = root.querySelector('.profile-deletion-pending');
    const pendingMsg = root.querySelector('.profile-deletion-pending-msg');
    const deleteBtn = root.querySelector('.profile-delete-account-btn');
    if (!pendingEl || !window.Cloud || !Cloud.getAccountDeletionStatus) return;
    const status = await Cloud.getAccountDeletionStatus();
    if (status && status.pending) {
      pendingEl.hidden = false;
      if (pendingMsg) {
        pendingMsg.textContent =
          'Your account is scheduled for deletion on ' +
          formatDeletionDate(status.scheduled_for) +
          '. Sign in before then to cancel.';
      }
      if (deleteBtn) deleteBtn.disabled = true;
    } else {
      pendingEl.hidden = true;
      if (deleteBtn) deleteBtn.disabled = false;
    }
  }

  function removeDeleteDialog() {
    const el = document.getElementById('profileDeleteDialog');
    if (el) el.remove();
  }

  function showDeleteDialog(root) {
    return new Promise(resolve => {
      removeDeleteDialog();
      const overlay = document.createElement('div');
      overlay.id = 'profileDeleteDialog';
      overlay.className = 'profile-delete-dialog';
      overlay.innerHTML =
        '<div class="profile-delete-panel" role="dialog" aria-modal="true" aria-labelledby="profileDeleteTitle">' +
        '<button type="button" class="profile-delete-close" aria-label="Close">&times;</button>' +
        '<h2 class="profile-delete-title" id="profileDeleteTitle">Delete account and data</h2>' +
        '<p class="profile-delete-lead">This is permanent. We cannot retrieve your data after deletion, and all runs, stats, and leaderboard entries will be lost.</p>' +
        '<label class="profile-delete-grace">' +
        '<input type="checkbox" class="profile-delete-grace-check" checked>' +
        '<span>Use a 30-day grace period <small>(recommended — sign back in anytime to cancel)</small></span>' +
        '</label>' +
        '<label class="profile-delete-confirm-label">' +
        '<span>Type <strong>delete</strong> to confirm</span>' +
        '<input class="profile-delete-confirm-input config-input" type="text" autocomplete="off" spellcheck="false" placeholder="delete">' +
        '</label>' +
        '<div class="profile-delete-actions">' +
        '<button type="button" class="cloud-btn profile-delete-cancel-btn">Cancel</button>' +
        '<button type="button" class="rogue-btn profile-delete-confirm-btn" disabled>Delete my account</button>' +
        '</div>' +
        '<p class="profile-delete-status" aria-live="polite"></p>' +
        '</div>';

      const graceCheck = overlay.querySelector('.profile-delete-grace-check');
      const confirmInput = overlay.querySelector('.profile-delete-confirm-input');
      const confirmBtn = overlay.querySelector('.profile-delete-confirm-btn');
      const statusEl = overlay.querySelector('.profile-delete-status');

      function syncConfirmBtn() {
        const typed = (confirmInput.value || '').trim().toLowerCase();
        confirmBtn.disabled = typed !== DELETE_CONFIRM_WORD;
      }

      function finish(result) {
        removeDeleteDialog();
        resolve(result);
      }

      confirmInput.addEventListener('input', syncConfirmBtn);
      overlay.querySelector('.profile-delete-close').addEventListener('click', () => finish(null));
      overlay.querySelector('.profile-delete-cancel-btn').addEventListener('click', () => finish(null));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
      document.addEventListener('keydown', function onEsc(e) {
        if (e.key === 'Escape') {
          document.removeEventListener('keydown', onEsc);
          finish(null);
        }
      });

      confirmBtn.addEventListener('click', async () => {
        if (confirmBtn.disabled) return;
        if (!window.Cloud || !Cloud.requestAccountDeletion) {
          statusEl.textContent = ERROR_MSG['no-client'];
          statusEl.classList.add('is-error');
          return;
        }
        confirmBtn.disabled = true;
        graceCheck.disabled = true;
        confirmInput.disabled = true;
        statusEl.textContent = 'Processing…';
        statusEl.classList.remove('is-error');
        const immediate = !graceCheck.checked;
        const result = await Cloud.requestAccountDeletion({ immediate });
        if (result && result.ok) {
          finish(result);
          const settingsOverlay = document.getElementById('settingsOverlay');
          if (settingsOverlay) settingsOverlay.hidden = true;
          if (immediate) {
            setStatus(root, 'Your account and data have been deleted.');
          } else {
            await updateDeletionUi(root);
            setStatus(root, 'Account scheduled for deletion in 30 days. You can cancel below.');
          }
          return;
        }
        const key = result && result.error;
        statusEl.textContent = ERROR_MSG[key] || ERROR_MSG['delete-failed'];
        statusEl.classList.add('is-error');
        confirmBtn.disabled = false;
        graceCheck.disabled = false;
        confirmInput.disabled = false;
        syncConfirmBtn();
      });

      document.body.appendChild(overlay);
      confirmInput.focus();
    });
  }

  async function cancelDeletionRoot(root) {
    if (!window.Cloud || !Cloud.cancelAccountDeletion) return;
    setStatus(root, 'Cancelling…');
    const result = await Cloud.cancelAccountDeletion();
    if (result && result.ok) {
      await updateDeletionUi(root);
      setStatus(root, 'Account deletion cancelled.');
      return;
    }
    const key = result && result.error;
    setStatus(root, ERROR_MSG[key] || ERROR_MSG['cancel-failed'], true);
  }

  async function deleteAccountRoot(root) {
    if (!window.Cloud || !Cloud.currentUser || !Cloud.currentUser()) {
      setStatus(root, ERROR_MSG['signed-out'], true);
      return;
    }
    await showDeleteDialog(root);
    await updateDeletionUi(root);
  }

  function wireRoot(root) {
    root.querySelectorAll('.profile-avatar-mode').forEach(r => {
      r.addEventListener('change', () => updateCustomVisibility(root));
    });
    const urlInput = root.querySelector('.profile-avatar-url');
    if (urlInput) urlInput.addEventListener('input', () => updatePreview(root));
    const saveBtn = root.querySelector('.profile-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', () => saveRoot(root));
    const resetBtn = root.querySelector('.profile-reset-btn');
    if (resetBtn) resetBtn.addEventListener('click', () => resetRoot(root));
    const deleteBtn = root.querySelector('.profile-delete-account-btn');
    if (deleteBtn) deleteBtn.addEventListener('click', () => deleteAccountRoot(root));
    const cancelDelBtn = root.querySelector('.profile-cancel-deletion-btn');
    if (cancelDelBtn) cancelDelBtn.addEventListener('click', () => cancelDeletionRoot(root));
    const signinBtn = root.querySelector('.profile-signin-btn');
    if (signinBtn) {
      signinBtn.addEventListener('click', async () => {
        if (!window.Cloud || !Cloud.signIn) return;
        await Cloud.signIn();
      });
    }
  }

  function loadAll() {
    document.querySelectorAll('.profile-settings').forEach(loadRoot);
  }

  function setSignedInUi(root, signedIn) {
    const signedInEl = root.querySelector('.profile-signed-in');
    const signinEl = root.querySelector('.profile-signin-prompt');
    if (signedInEl) signedInEl.hidden = !signedIn;
    if (signinEl) signinEl.hidden = !!signedIn;
  }

  function updateVisibility(user) {
    const row = document.getElementById('profileToggleRow');
    const body = document.getElementById('profileSettings');
    if (row) row.removeAttribute('hidden');
    document.querySelectorAll('.profile-settings').forEach(root => setSignedInUi(root, !!user));
    if (body && !user) body.hidden = true;
    if (user) loadAll();
  }

  function syncVisibility() {
    if (!window.Cloud) return;
    if (Cloud.init) Cloud.init();
    const user = Cloud.currentUser ? Cloud.currentUser() : null;
    updateVisibility(user);
  }

  function init() {
    if (!domWired) {
      const roots = document.querySelectorAll('.profile-settings');
      if (!roots.length) {
        setTimeout(init, 100);
        return;
      }
      roots.forEach(wireRoot);
      domWired = true;
    }
    if (!window.Cloud) {
      setTimeout(init, 100);
      return;
    }
    if (Cloud.init) Cloud.init();
    if (!authWired) {
      Cloud.onAuth(updateVisibility);
      document.addEventListener('cloud:signedIn', syncVisibility);
      authWired = true;
    }
    syncVisibility();
  }

  window.ProfileSettings = { init, loadAll, syncVisibility };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

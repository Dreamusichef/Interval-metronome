'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   PROFILE SETTINGS — public alias + avatar editor (Settings panel).
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
  };

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
  }

  function loadAll() {
    document.querySelectorAll('.profile-settings').forEach(loadRoot);
  }

  function updateVisibility(user) {
    const row = document.getElementById('profileToggleRow');
    const body = document.getElementById('profileSettings');
    if (row) row.hidden = !user;
    if (body && !user) body.hidden = true;
    if (user) loadAll();
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
    if (!authWired) {
      Cloud.onAuth(updateVisibility);
      authWired = true;
    }
  }

  window.ProfileSettings = { init, loadAll };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

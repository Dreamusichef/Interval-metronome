'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   CLOUD — Facade over Supabase (prod) or localStorage mock (localhost).

   Script load order (index.html / stats.html): profile-validation.js, backend
   script(s) load async via loadCloudScripts(), then cloud.js; page scripts
   (stats.js, roguelite.js) may run before getSession() finishes. Consumers
   MUST use Cloud.onAuth(fn) — never assume auth is resolved on first tick.

   Public API (window.Cloud):
     init()                         — create the backend (auto-runs on load)
     onAuth(fn)                     — fn(user|null) now + on every auth change
     signIn() / signOut()
     currentUser()                  — user object or null
     getSessionUser()               — fresh session read
     getProfile()                   — public alias + avatar for signed-in user
     updateProfile({ display_name, avatar_url })
     resetProfileFromGoogle()       — restore alias + avatar from OAuth metadata
     requestAccountDeletion({ immediate }) — delete now or schedule 30-day grace period
     cancelAccountDeletion()        — cancel a pending scheduled deletion
     getAccountDeletionStatus()     — { pending, scheduled_for } or { pending: false }
     submitRun(record)              — validated insert via submit_run RPC / mock checks
     saveRun(record)                — alias for submitRun
     myRuns()                       — this user's runs (for personal stats)
     leaderboard(mode, bpm, level, instrument) — global top-100 for a slice
     claimBetaSpot() / joinWaitlist(email)
     mountAuthBar(el)               — render sign-in / name+sign-out bar into el
     resetMockData()                — localhost only: reset seed data
   ════════════════════════════════════════════════════════════════════════════ */
const Cloud = (() => {
  const listeners = [];
  let backend = null;
  // Facade-level "auth bootstrap done". Distinct from backend.isReady() during the
  // brief window while Supabase getSession() is in flight — see onBackendAuth/onAuth.
  let ready = false;
  let inited = false;
  let isMock = false;

  function useMockCloud() {
    if (typeof window !== 'undefined' && window.__CLOUD_MODE__ === 'mock') return true;
    if (typeof window !== 'undefined' && window.__CLOUD_MODE__ === 'supabase') return false;
    if (typeof location === 'undefined') return false;
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1';
  }

  function pickBackend() {
    isMock = useMockCloud();
    if (isMock) {
      if (!window.CloudMockBackend) {
        console.warn('[cloud] CloudMockBackend not loaded');
        return null;
      }
      console.info('[cloud] using mock backend (localhost)');
      return window.CloudMockBackend;
    }
    if (!window.CloudSupabaseBackend) {
      console.warn('[cloud] CloudSupabaseBackend not loaded');
      return null;
    }
    console.info('[cloud] using Supabase');
    return window.CloudSupabaseBackend;
  }

  function notify(user) {
    listeners.forEach(fn => { try { fn(user); } catch (e) {} });
  }

  function dispatchProfileUpdated() {
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('cloud:profileUpdated'));
    }
  }

  function init() {
    if (inited) return backend;
    backend = pickBackend();
    if (!backend) return null;
    if (backend.init) backend.init({ onAuthChange: onBackendAuth });
    inited = true;
    return backend;
  }

  function onBackendAuth(user) {
    // Sync ready from backend BEFORE notify. Supabase backend must set ready=true
    // before calling setUser/onAuthChange (see cloud-supabase.js getSession).
    ready = backend && backend.isReady ? backend.isReady() : true;
    notify(user);
  }

  function onAuth(fn) {
    listeners.push(fn);
    // Late registrants: stats.js / mountAuthBar may subscribe after getSession()
    // already fired. Re-check backend.isReady() so they still get currentUser().
    if (backend && backend.isReady && backend.isReady()) ready = true;
    if (ready) fn(backend && backend.currentUser ? backend.currentUser() : null);
  }

  function currentUser() {
    return backend && backend.currentUser ? backend.currentUser() : null;
  }

  function oauthDisplayName(u) {
    const m = (u && u.user_metadata) || {};
    return m.full_name || m.name || ((u && u.email) || 'Drummer').split('@')[0];
  }

  function safeAvatarUrl(url) {
    return (url && String(url).startsWith('https://')) ? url : '';
  }

  async function signIn() {
    if (!init()) return;
    try { sessionStorage.setItem('cloud:reopenGameMode', '1'); } catch (e) {}
    if (isMock) {
      const picked = await showDevUserPicker();
      if (picked && backend.signInAs) {
        await backend.signInAs(picked);
        if (typeof document !== 'undefined') {
          document.dispatchEvent(new CustomEvent('cloud:signedIn'));
        }
      } else {
        try { sessionStorage.removeItem('cloud:reopenGameMode'); } catch (e) {}
      }
      return;
    }
    return backend.signIn();
  }

  async function signOut() {
    if (!init()) return;
    return backend.signOut();
  }

  async function getSessionUser() {
    if (!init()) return null;
    return backend.getSessionUser();
  }

  async function getProfile() {
    if (!init()) return null;
    if (!backend.getProfile) return null;
    return backend.getProfile();
  }

  async function updateProfile(input) {
    if (!init()) return { error: 'no-client' };
    if (!currentUser()) return { error: 'signed-out' };
    const V = typeof window !== 'undefined' ? window.ProfileValidation : null;
    if (!V) return { error: 'validation-unavailable' };
    const validated = V.validateProfileFields(input || {});
    if (validated.error) return { error: validated.error };
    if (!backend.updateProfile) return { error: 'no-client' };
    const result = await backend.updateProfile(validated.value);
    if (result && result.ok) dispatchProfileUpdated();
    return result;
  }

  async function resetProfileFromGoogle() {
    if (!init()) return { error: 'no-client' };
    if (!currentUser()) return { error: 'signed-out' };
    if (!backend.resetProfileFromGoogle) return { error: 'no-client' };
    const result = await backend.resetProfileFromGoogle();
    if (result && result.ok) dispatchProfileUpdated();
    return result;
  }

  async function requestAccountDeletion(opts) {
    if (!init()) return { error: 'no-client' };
    if (!currentUser()) return { error: 'signed-out' };
    if (!backend.requestAccountDeletion) return { error: 'no-client' };
    const immediate = !!(opts && opts.immediate);
    const result = await backend.requestAccountDeletion({ immediate });
    if (result && result.ok && immediate) {
      if (backend.signOut) await backend.signOut();
    }
    return result;
  }

  async function cancelAccountDeletion() {
    if (!init()) return { error: 'no-client' };
    if (!currentUser()) return { error: 'signed-out' };
    if (!backend.cancelAccountDeletion) return { error: 'no-client' };
    return backend.cancelAccountDeletion();
  }

  async function getAccountDeletionStatus() {
    if (!init()) return { pending: false };
    if (!currentUser()) return { pending: false };
    if (!backend.getAccountDeletionStatus) return { pending: false };
    return backend.getAccountDeletionStatus();
  }

  async function claimBetaSpot() {
    if (!init()) return 'error';
    return backend.claimBetaSpot();
  }

  async function joinWaitlist(email) {
    if (!init()) return { error: 'no-client' };
    // Basic format guard before hitting the DB. The real abuse protection is the
    // server-side rate-limit RLS policy on beta_waitlist; this just rejects
    // obviously malformed input (incl. programmatic callers bypassing the
    // form's required+type=email validation).
    const e = (email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { error: 'invalid-email' };
    return backend.joinWaitlist(e);
  }

  async function submitRun(record) {
    if (!init()) return { skipped: 'no-client' };
    if (backend.submitRun) return backend.submitRun(record);
    return backend.saveRun(record);
  }

  async function saveRun(record) {
    return submitRun(record);
  }

  async function myRuns() {
    if (!init()) return [];
    return backend.myRuns();
  }

  async function leaderboard(mode, bpm, level, instrument) {
    if (!init()) return [];
    return backend.leaderboard(mode, bpm, level, instrument);
  }

  function resetMockData() {
    if (!isMock || !backend || !backend.resetMockData) return;
    backend.resetMockData();
  }

  function escAttr(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function removeDevPicker() {
    const el = document.getElementById('cloudDevPicker');
    if (el) el.remove();
  }

  function showDevUserPicker() {
    return new Promise(resolve => {
      removeDevPicker();
      const devUsers = backend.getDevUsers ? backend.getDevUsers() : [];
      if (!devUsers.length) { resolve(null); return; }

      const overlay = document.createElement('div');
      overlay.id = 'cloudDevPicker';
      overlay.className = 'cloud-dev-picker';
      overlay.innerHTML =
        '<div class="cloud-dev-picker-panel" role="dialog" aria-label="Dev sign in">' +
        '<p class="cloud-dev-picker-title">Dev sign in</p>' +
        '<p class="cloud-dev-picker-hint">Pick a local test user (mock DB only)</p>' +
        '<div class="cloud-dev-picker-users"></div>' +
        '<button type="button" class="cloud-btn cloud-dev-picker-cancel">Cancel</button>' +
        '</div>';

      const list = overlay.querySelector('.cloud-dev-picker-users');
      devUsers.forEach(u => {
        const name = (u.user_metadata && u.user_metadata.full_name) || u.email;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cloud-btn cloud-dev-picker-user';
        btn.textContent = name;
        btn.addEventListener('click', () => { removeDevPicker(); resolve(u.id); });
        list.appendChild(btn);
      });

      overlay.querySelector('.cloud-dev-picker-cancel').addEventListener('click', () => {
        removeDevPicker();
        resolve(null);
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { removeDevPicker(); resolve(null); }
      });

      document.body.appendChild(overlay);
    });
  }

  function mountAuthBar(el) {
    if (!el) return;
    const render = async (u) => {
      if (u) {
        let name = oauthDisplayName(u);
        let av = safeAvatarUrl((u.user_metadata || {}).avatar_url || (u.user_metadata || {}).picture);
        try {
          const p = await getProfile();
          if (p) {
            if (p.display_name) name = p.display_name;
            av = safeAvatarUrl(p.avatar_url);
          }
        } catch (e) {}
        el.innerHTML =
          (isMock ? '<span class="cloud-local-badge">LOCAL</span>' : '') +
          (av ? '<img class="cloud-avatar" src="' + escAttr(av) + '" alt="" referrerpolicy="no-referrer">' : '') +
          '<span class="cloud-name"></span>' +
          '<button class="cloud-btn" data-act="out">Sign out</button>';
        el.querySelector('.cloud-name').textContent = name;
        el.querySelector('[data-act="out"]').addEventListener('click', signOut);
      } else if (isMock) {
        el.innerHTML =
          '<span class="cloud-local-badge">LOCAL</span>' +
          '<div class="cloud-dev-signin-wrap">' +
          '<button class="cloud-btn cloud-dev-signin" data-act="in">Dev sign in ▾</button>' +
          '</div>';
        el.querySelector('[data-act="in"]').addEventListener('click', signIn);
      } else {
        el.innerHTML = '<button class="cloud-btn cloud-google" data-act="in">' +
          '<span class="cloud-g">G</span> Sign in with Google</button>';
        el.querySelector('[data-act="in"]').addEventListener('click', signIn);
      }
    };
    onAuth(render);
    if (typeof document !== 'undefined') {
      document.addEventListener('cloud:profileUpdated', () => {
        const u = currentUser();
        if (u) render(u);
      });
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return {
    init, onAuth, signIn, signOut, currentUser, getSessionUser,
    getProfile, updateProfile, resetProfileFromGoogle,
    requestAccountDeletion, cancelAccountDeletion, getAccountDeletionStatus,
    claimBetaSpot, joinWaitlist, submitRun, saveRun, myRuns, leaderboard,
    mountAuthBar, resetMockData,
  };
})();

if (typeof window !== 'undefined') window.Cloud = Cloud;

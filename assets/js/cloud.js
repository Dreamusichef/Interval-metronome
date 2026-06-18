'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   CLOUD — Facade over Supabase (prod) or localStorage mock (localhost).

   Public API (window.Cloud):
     init()                         — create the backend (auto-runs on load)
     onAuth(fn)                     — fn(user|null) now + on every auth change
     signIn() / signOut()
     currentUser()                  — user object or null
     getSessionUser()               — fresh session read
     saveRun(record)                — insert a run (no-op if signed out)
     myRuns()                       — this user's runs (for personal stats)
     leaderboard(mode, bpm, level, instrument) — global top-100 for a slice
     claimBetaSpot() / joinWaitlist(email)
     mountAuthBar(el)               — render sign-in / name+sign-out bar into el
     resetMockData()                — localhost only: reset seed data
   ════════════════════════════════════════════════════════════════════════════ */
const Cloud = (() => {
  const listeners = [];
  let backend = null;
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

  function init() {
    if (inited) return backend;
    backend = pickBackend();
    if (!backend) return null;
    if (backend.init) backend.init({ onAuthChange: onBackendAuth });
    inited = true;
    return backend;
  }

  function onBackendAuth(user) {
    ready = backend && backend.isReady ? backend.isReady() : true;
    notify(user);
  }

  function onAuth(fn) {
    listeners.push(fn);
    if (ready) fn(backend && backend.currentUser ? backend.currentUser() : null);
  }

  function currentUser() {
    return backend && backend.currentUser ? backend.currentUser() : null;
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

  async function claimBetaSpot() {
    if (!init()) return 'error';
    return backend.claimBetaSpot();
  }

  async function joinWaitlist(email) {
    if (!init()) return { error: 'no-client' };
    // Basic format guard before hitting the DB. The real abuse protection is the
    // server-side rate-limit RLS policy on beta_waitlist (issue #49); this just
    // rejects obviously malformed input (incl. programmatic callers bypassing the
    // form's required+type=email validation).
    const e = (email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { error: 'invalid-email' };
    return backend.joinWaitlist(e);
  }

  async function saveRun(record) {
    if (!init()) return { skipped: 'no-client' };
    return backend.saveRun(record);
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
    const render = (u) => {
      if (u) {
        const m = u.user_metadata || {};
        const name = m.full_name || m.name || (u.email || 'Drummer').split('@')[0];
        const av = m.avatar_url || m.picture;
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
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return {
    init, onAuth, signIn, signOut, currentUser, getSessionUser,
    claimBetaSpot, joinWaitlist, saveRun, myRuns, leaderboard,
    mountAuthBar, resetMockData,
  };
})();

if (typeof window !== 'undefined') window.Cloud = Cloud;

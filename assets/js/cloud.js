'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   CLOUD — Supabase auth + progress (Google sign-in, save runs, read stats).

   Static-site friendly: everything runs client-side with the public ANON key
   (safe to ship — Row Level Security in the DB is what actually protects data;
   see sql/supabase-schema.sql). Loaded on both index.html and stats.html so the
   login session is shared (same origin → same localStorage).

   Public API (window.Cloud):
     init()                         — create the client (auto-runs on load)
     onAuth(fn)                     — fn(user|null) now + on every auth change
     signIn() / signOut()
     currentUser()                  — user object or null
     saveRun(record)                — insert a run (no-op if signed out)
     myRuns()                       — this user's runs (for personal stats)
     leaderboard(mode, bpm, level)  — global top-100 for a slice
     mountAuthBar(el)               — render a sign-in / name+sign-out bar into el
   ════════════════════════════════════════════════════════════════════════════ */
const Cloud = (() => {
  const SUPABASE_URL  = 'https://mmdmibimpipxckgfmhmz.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tZG1pYmltcGlweGNrZ2ZtaG16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDY2NjEsImV4cCI6MjA5NTk4MjY2MX0.dw01oyBckqm8yG_WUA3NmHDrRmts0g6sz8nOtuowk04';

  let client = null;
  let user = null;
  let ready = false;
  const listeners = [];

  function init() {
    if (client) return client;
    if (!window.supabase || !window.supabase.createClient) {
      console.warn('[cloud] supabase-js not loaded yet');
      return null;
    }
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    client.auth.getSession().then(({ data }) => {
      setUser(data && data.session ? data.session.user : null);
      ready = true;
    });
    client.auth.onAuthStateChange((_evt, session) => {
      setUser(session ? session.user : null);
    });
    return client;
  }

  function setUser(u) {
    const was = user && user.id;
    user = u || null;
    if (user && user.id !== was) upsertProfile();   // first sight of this user
    notify();
  }
  function notify() { listeners.forEach(fn => { try { fn(user); } catch (e) {} }); }

  function onAuth(fn) { listeners.push(fn); if (ready) fn(user); }
  function currentUser() { return user; }

  async function signIn() {
    if (!init()) return;
    // Sign-in is a full-page redirect (out to Google and back), so the page
    // reloads fresh. Leave a breadcrumb so the app can restore the view the user
    // was in (e.g. re-open the Game Mode panel) instead of collapsing to default.
    try { sessionStorage.setItem('cloud:reopenGameMode', '1'); } catch (e) {}
    // Return to the page the user signed in from (must be in Supabase's redirect
    // allow-list — add the "/**" wildcard for your domains).
    await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.href.split('#')[0] },
    });
  }
  async function signOut() {
    if (!init()) return;
    await client.auth.signOut();
    setUser(null);
  }

  async function upsertProfile() {
    if (!client || !user) return;
    const m = user.user_metadata || {};
    const row = {
      id: user.id,
      display_name: m.full_name || m.name || m.preferred_username || (user.email || 'Drummer').split('@')[0],
      avatar_url: m.avatar_url || m.picture || null,
    };
    const { error } = await client.from('profiles').upsert(row);
    if (error) console.warn('[cloud] upsertProfile', error.message);
  }

  // Force a fresh session read (avoids the race where the app asks who's signed
  // in before the initial getSession() has resolved).
  async function getSessionUser() {
    if (!init()) return null;
    const { data } = await client.auth.getSession();
    const u = data && data.session ? data.session.user : null;
    setUser(u);
    return u;
  }

  // Beta gate: claim/confirm a spot. Returns 'ok' | 'full' | 'unauthenticated' | 'error'.
  async function claimBetaSpot() {
    if (!init() || !user) return 'unauthenticated';
    const { data, error } = await client.rpc('claim_beta_spot');
    if (error) { console.warn('[cloud] claimBetaSpot', error.message); return 'error'; }
    return data || 'error';
  }

  // Waitlist capture when the beta is full. Duplicate email = treated as success.
  async function joinWaitlist(email) {
    if (!init()) return { error: 'no-client' };
    const e = (email || '').trim().toLowerCase();
    if (!e) return { error: 'empty' };
    const { error } = await client.from('beta_waitlist').insert({ email: e });
    if (error && error.code !== '23505') { console.warn('[cloud] joinWaitlist', error.message); return { error }; }
    return {};
  }

  // record: { mode, bpm, level, rank, green_pct, duration_sec, survival_sec, cleared }
  async function saveRun(record) {
    if (!init()) return { skipped: 'no-client' };
    if (!user) return { skipped: 'signed-out' };
    const { error } = await client.from('runs').insert({ ...record, user_id: user.id });
    if (error) console.warn('[cloud] saveRun', error.message);
    return { error };
  }

  async function myRuns() {
    if (!init() || !user) return [];
    const { data, error } = await client.from('runs').select('*').eq('user_id', user.id);
    if (error) { console.warn('[cloud] myRuns', error.message); return []; }
    return data || [];
  }

  async function leaderboard(mode, bpm, level, instrument) {
    if (!init()) return [];
    const { data, error } = await client.rpc('get_leaderboard', {
      p_mode: mode,
      p_bpm: (bpm == null ? null : bpm),
      p_level: (level == null ? null : level),
      p_instrument: (instrument == null ? null : instrument),
    });
    if (error) { console.warn('[cloud] leaderboard', error.message); return []; }
    return data || [];
  }

  // Render a compact auth bar (sign-in button, or avatar+name+sign-out) into `el`.
  function mountAuthBar(el) {
    if (!el) return;
    const render = (u) => {
      if (u) {
        const m = u.user_metadata || {};
        const name = m.full_name || m.name || (u.email || 'Drummer').split('@')[0];
        const av = m.avatar_url || m.picture;
        el.innerHTML =
          (av ? '<img class="cloud-avatar" src="' + av + '" alt="" referrerpolicy="no-referrer">' : '') +
          '<span class="cloud-name"></span>' +
          '<button class="cloud-btn" data-act="out">Sign out</button>';
        el.querySelector('.cloud-name').textContent = name;
        el.querySelector('[data-act="out"]').addEventListener('click', signOut);
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

  return { init, onAuth, signIn, signOut, currentUser, getSessionUser, claimBetaSpot, joinWaitlist, saveRun, myRuns, leaderboard, mountAuthBar };
})();
if (typeof window !== 'undefined') window.Cloud = Cloud;

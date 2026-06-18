'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   CLOUD SUPABASE BACKEND — production data layer (Google OAuth + Supabase DB).
   Loaded only on non-localhost hosts; wired by cloud.js facade.

   Auth init contract: isReady() must be true BEFORE the first onAuthChange call
   (cloud.js reads isReady() inside onBackendAuth). getSession() is async — set
   ready=true then setUser(), matching the sync order in cloud-mock.js init().
   ════════════════════════════════════════════════════════════════════════════ */
const CloudSupabaseBackend = (() => {
  const SUPABASE_URL  = 'https://mmdmibimpipxckgfmhmz.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tZG1pYmltcGlweGNrZ2ZtaG16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDY2NjEsImV4cCI6MjA5NTk4MjY2MX0.dw01oyBckqm8yG_WUA3NmHDrRmts0g6sz8nOtuowk04';

  let client = null;
  let user = null;
  let ready = false;
  let onAuthChange = null;

  function init(opts) {
    if (opts && opts.onAuthChange) onAuthChange = opts.onAuthChange;
    if (client) return client;
    if (!window.supabase || !window.supabase.createClient) {
      console.warn('[cloud] supabase-js not loaded yet');
      return null;
    }
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    client.auth.getSession().then(({ data }) => {
      // Order matters: ready before setUser → onAuthChange → facade onBackendAuth.
      ready = true;
      setUser(data && data.session ? data.session.user : null);
    });
    client.auth.onAuthStateChange((_evt, session) => {
      setUser(session ? session.user : null);
    });
    return client;
  }

  function setUser(u) {
    const was = user && user.id;
    user = u || null;
    if (user && user.id !== was) upsertProfile();
    if (onAuthChange) onAuthChange(user);
  }

  function isReady() { return ready; }
  function currentUser() { return user; }

  async function signIn() {
    if (!init()) return;
    try { sessionStorage.setItem('cloud:reopenGameMode', '1'); } catch (e) {}
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

  async function getSessionUser() {
    if (!init()) return null;
    const { data } = await client.auth.getSession();
    const u = data && data.session ? data.session.user : null;
    setUser(u);
    return u;
  }

  async function claimBetaSpot() {
    if (!init() || !user) return 'unauthenticated';
    const { data, error } = await client.rpc('claim_beta_spot');
    if (error) { console.warn('[cloud] claimBetaSpot', error.message); return 'error'; }
    return data || 'error';
  }

  async function joinWaitlist(email) {
    if (!init()) return { error: 'no-client' };
    const e = (email || '').trim().toLowerCase();
    if (!e) return { error: 'empty' };
    const { error } = await client.from('beta_waitlist').insert({ email: e });
    if (error && error.code !== '23505') { console.warn('[cloud] joinWaitlist', error.message); return { error }; }
    return {};
  }

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

  return {
    init, isReady, signIn, signOut, currentUser, getSessionUser,
    claimBetaSpot, joinWaitlist, saveRun, myRuns, leaderboard,
  };
})();

if (typeof window !== 'undefined') window.CloudSupabaseBackend = CloudSupabaseBackend;

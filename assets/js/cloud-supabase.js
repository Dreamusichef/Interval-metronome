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
  let profileCache = null;
  let profileCacheUserId = null;

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

  function profileFromOAuth(u) {
    const m = (u && u.user_metadata) || {};
    return {
      display_name: m.full_name || m.name || m.preferred_username || ((u && u.email) || 'Drummer').split('@')[0],
      avatar_url: m.avatar_url || m.picture || null,
    };
  }

  function clearProfileCache() {
    profileCache = null;
    profileCacheUserId = null;
  }

  async function refreshProfileCache() {
    if (!client || !user) {
      clearProfileCache();
      return null;
    }
    const { data, error } = await client.from('profiles')
      .select('display_name, avatar_url')
      .eq('id', user.id)
      .maybeSingle();
    if (error) {
      console.warn('[cloud] refreshProfileCache', error.message);
      profileCache = profileFromOAuth(user);
    } else if (data) {
      profileCache = { display_name: data.display_name, avatar_url: data.avatar_url };
    } else {
      profileCache = profileFromOAuth(user);
    }
    profileCacheUserId = user.id;
    return profileCache;
  }

  function setUser(u) {
    const was = user && user.id;
    user = u || null;
    if (user && user.id !== was) {
      upsertProfile().then(() => refreshProfileCache());
    } else if (user) {
      refreshProfileCache();
    } else {
      clearProfileCache();
    }
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
    const row = Object.assign({ id: user.id }, profileFromOAuth(user));
    const { error } = await client.from('profiles').upsert(row, { onConflict: 'id', ignoreDuplicates: true });
    if (error) console.warn('[cloud] upsertProfile', error.message);
  }

  async function getSessionUser() {
    if (!init()) return null;
    const { data } = await client.auth.getSession();
    const u = data && data.session ? data.session.user : null;
    setUser(u);
    return u;
  }

  async function getProfile() {
    if (!init() || !user) return null;
    if (profileCache && profileCacheUserId === user.id) {
      return { display_name: profileCache.display_name, avatar_url: profileCache.avatar_url };
    }
    const p = await refreshProfileCache();
    return p ? { display_name: p.display_name, avatar_url: p.avatar_url } : null;
  }

  async function updateProfile(fields) {
    if (!init() || !user) return { error: 'signed-out' };
    const row = {
      display_name: fields.display_name,
      avatar_url: fields.avatar_url == null ? null : fields.avatar_url,
    };
    const { data, error } = await client.from('profiles')
      .update(row)
      .eq('id', user.id)
      .select('display_name, avatar_url')
      .maybeSingle();
    if (error) {
      console.warn('[cloud] updateProfile', error.message);
      return { error: 'save-failed' };
    }
    if (!data) {
      const insertRow = Object.assign({ id: user.id }, row);
      const ins = await client.from('profiles').insert(insertRow).select('display_name, avatar_url').single();
      if (ins.error) {
        console.warn('[cloud] updateProfile insert', ins.error.message);
        return { error: 'save-failed' };
      }
      profileCache = { display_name: ins.data.display_name, avatar_url: ins.data.avatar_url };
    } else {
      profileCache = { display_name: data.display_name, avatar_url: data.avatar_url };
    }
    profileCacheUserId = user.id;
    return { ok: true };
  }

  async function resetProfileFromGoogle() {
    if (!init() || !user) return { error: 'signed-out' };
    const row = Object.assign({ id: user.id }, profileFromOAuth(user));
    const { data, error } = await client.from('profiles')
      .upsert(row)
      .select('display_name, avatar_url')
      .single();
    if (error) {
      console.warn('[cloud] resetProfileFromGoogle', error.message);
      return { error: 'save-failed' };
    }
    profileCache = { display_name: data.display_name, avatar_url: data.avatar_url };
    profileCacheUserId = user.id;
    return { ok: true };
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

  async function submitRun(record) {
    if (!init()) return { skipped: 'no-client' };
    if (!user) return { skipped: 'signed-out' };
    const { data, error } = await client.rpc('submit_run', {
      p_run_id: record.run_id,
      p_started_at: record.started_at,
      p_played_sec: record.played_sec,
      p_mode: record.mode,
      p_instrument: record.instrument || 'kick',
      p_bpm: record.bpm == null ? null : record.bpm,
      p_level: record.level == null ? null : record.level,
      p_rank: record.rank,
      p_green_pct: record.green_pct,
      p_duration_sec: record.duration_sec == null ? null : record.duration_sec,
      p_survival_sec: record.survival_sec == null ? null : record.survival_sec,
      p_cleared: !!record.cleared,
      p_subdivision: record.subdivision || 'sixteenth',
    });
    if (error) {
      console.warn('[cloud] submitRun', error.message);
      return { error, valid: false };
    }
    return data || { valid: false, reject_reason: 'error' };
  }

  async function saveRun(record) {
    return submitRun(record);
  }

  async function myRuns() {
    if (!init() || !user) return [];
    const { data, error } = await client.from('runs').select('*').eq('user_id', user.id);
    if (error) { console.warn('[cloud] myRuns', error.message); return []; }
    return data || [];
  }

  async function leaderboard(mode, bpm, level, instrument, subdivision) {
    if (!init()) return [];
    const { data, error } = await client.rpc('get_leaderboard', {
      p_mode: mode,
      p_bpm: (bpm == null ? null : bpm),
      p_level: (level == null ? null : level),
      p_instrument: (instrument == null ? null : instrument),
      p_subdivision: (subdivision == null ? null : subdivision),
    });
    if (error) { console.warn('[cloud] leaderboard', error.message); return []; }
    return data || [];
  }

  async function requestAccountDeletion(opts) {
    if (!init() || !user) return { error: 'signed-out' };
    const immediate = !!(opts && opts.immediate);
    const { data, error } = await client.rpc('request_account_deletion', { p_immediate: immediate });
    if (error) {
      console.warn('[cloud] requestAccountDeletion', error.message);
      return { error: 'delete-failed' };
    }
    if (!data || !data.ok) return { error: (data && data.error) || 'delete-failed' };
    clearProfileCache();
    return data;
  }

  async function cancelAccountDeletion() {
    if (!init() || !user) return { error: 'signed-out' };
    const { data, error } = await client.rpc('cancel_account_deletion');
    if (error) {
      console.warn('[cloud] cancelAccountDeletion', error.message);
      return { error: 'cancel-failed' };
    }
    if (!data || !data.ok) return { error: (data && data.error) || 'cancel-failed' };
    return data;
  }

  async function getAccountDeletionStatus() {
    if (!init() || !user) return { pending: false };
    const { data, error } = await client.rpc('get_account_deletion_status');
    if (error) {
      console.warn('[cloud] getAccountDeletionStatus', error.message);
      return { pending: false };
    }
    return data || { pending: false };
  }

  async function getRampPresets() {
    if (!init() || !user) return null;
    const { data, error } = await client.from('ramp_presets')
      .select('presets, updated_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) {
      console.warn('[cloud] getRampPresets', error.message);
      return null;
    }
    if (!data) return { presets: [], updated_at: null };
    const presets = Array.isArray(data.presets) ? data.presets : [];
    return { presets, updated_at: data.updated_at || null };
  }

  async function saveRampPresets(presets) {
    if (!init() || !user) return { error: 'signed-out' };
    const list = Array.isArray(presets) ? presets : [];
    const row = {
      user_id: user.id,
      presets: list,
      updated_at: new Date().toISOString(),
    };
    const { error } = await client.from('ramp_presets').upsert(row, { onConflict: 'user_id' });
    if (error) {
      console.warn('[cloud] saveRampPresets', error.message);
      return { error: 'save-failed' };
    }
    return { ok: true, updated_at: row.updated_at };
  }

  return {
    init, isReady, signIn, signOut, currentUser, getSessionUser,
    getProfile, updateProfile, resetProfileFromGoogle,
    requestAccountDeletion, cancelAccountDeletion, getAccountDeletionStatus,
    getRampPresets, saveRampPresets,
    claimBetaSpot, joinWaitlist, submitRun, saveRun, myRuns, leaderboard,
  };
})();

if (typeof window !== 'undefined') window.CloudSupabaseBackend = CloudSupabaseBackend;

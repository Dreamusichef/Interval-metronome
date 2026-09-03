'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   CLOUD MOCK BACKEND — localStorage-backed fake DB for localhost / non-prod.
   Wired by js/cloud/auth.js facade.
   ════════════════════════════════════════════════════════════════════════════ */
const CloudMockBackend = (() => {
  // Bump this when seed users / runs change — invalidates stale localStorage mock data.
  const STORAGE_KEY = 'cloud:mock:v7';

  const DEV_USERS = [
    {
      id: 'dev-user-alex',
      email: 'alex@local.dev',
      user_metadata: { full_name: 'Alex', avatar_url: null },
    },
    {
      id: 'dev-user-wei',
      email: 'wei@local.dev',
      user_metadata: { full_name: 'Wei', avatar_url: null },
    },
    {
      id: 'dev-user-sam',
      email: 'sam@local.dev',
      user_metadata: { full_name: 'Sam', avatar_url: null },
    },
  ];

  let db = null;
  let user = null;
  let ready = false;
  let onAuthChange = null;
  let profileCache = null;
  let profileCacheUserId = null;

  function uid() {
    return 'run-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function isoDaysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString();
  }

  function seedDb() {
    const profiles = DEV_USERS.map(u => ({
      id: u.id,
      display_name: u.user_metadata.full_name,
      avatar_url: null,
    }));
    const runs = [
      { id: uid(), user_id: 'dev-user-alex', mode: 'timetrial', instrument: 'kick', subdivision: 'sixteenth', bpm: 120, level: null, rank: 'A', green_pct: 88, duration_sec: 120, survival_sec: null, cleared: false, created_at: isoDaysAgo(3) },
      { id: uid(), user_id: 'dev-user-alex', mode: 'timetrial', instrument: 'kick', subdivision: 'sixteenth', bpm: 120, level: null, rank: 'S', green_pct: 94, duration_sec: 120, survival_sec: null, cleared: false, created_at: isoDaysAgo(1) },
      { id: uid(), user_id: 'dev-user-wei', mode: 'timetrial', instrument: 'kick', subdivision: 'sixteenth', bpm: 120, level: null, rank: 'B', green_pct: 82, duration_sec: 120, survival_sec: null, cleared: false, created_at: isoDaysAgo(2) },
      { id: uid(), user_id: 'dev-user-sam', mode: 'timetrial', instrument: 'kick', subdivision: 'sixteenth', bpm: 120, level: null, rank: 'SS', green_pct: 97, duration_sec: 180, survival_sec: null, cleared: false, created_at: isoDaysAgo(0) },
      { id: uid(), user_id: 'dev-user-alex', mode: 'timetrial', instrument: 'kick', subdivision: 'eighth', bpm: 120, level: null, rank: 'B', green_pct: 79, duration_sec: 120, survival_sec: null, cleared: false, created_at: isoDaysAgo(2) },
      { id: uid(), user_id: 'dev-user-wei', mode: 'timetrial', instrument: 'kick', subdivision: 'eighth', bpm: 120, level: null, rank: 'A', green_pct: 86, duration_sec: 120, survival_sec: null, cleared: false, created_at: isoDaysAgo(1) },
      { id: uid(), user_id: 'dev-user-alex', mode: 'suddendeath', instrument: 'kick', subdivision: 'sixteenth', bpm: 100, level: null, rank: 'A', green_pct: 75, duration_sec: 180, survival_sec: 142, cleared: false, created_at: isoDaysAgo(4) },
      { id: uid(), user_id: 'dev-user-wei', mode: 'suddendeath', instrument: 'kick', subdivision: 'sixteenth', bpm: 100, level: null, rank: 'S', green_pct: 80, duration_sec: 180, survival_sec: 165, cleared: false, created_at: isoDaysAgo(2) },
      { id: uid(), user_id: 'dev-user-sam', mode: 'suddendeath', instrument: 'kick', subdivision: 'sixteenth', bpm: 100, level: null, rank: 'B', green_pct: 70, duration_sec: 180, survival_sec: 98, cleared: false, created_at: isoDaysAgo(1) },
      { id: uid(), user_id: 'dev-user-sam', mode: 'suddendeath', instrument: 'kick', subdivision: 'triplet', bpm: 100, level: null, rank: 'A', green_pct: 72, duration_sec: 180, survival_sec: 120, cleared: false, created_at: isoDaysAgo(1) },
      { id: uid(), user_id: 'dev-user-alex', mode: 'gauntlet', instrument: 'kick', subdivision: 'sixteenth', bpm: null, level: 1, rank: 'B', green_pct: 78, duration_sec: null, survival_sec: null, cleared: false, created_at: isoDaysAgo(5) },
      { id: uid(), user_id: 'dev-user-wei', mode: 'gauntlet', instrument: 'kick', subdivision: 'sixteenth', bpm: null, level: 1, rank: 'A', green_pct: 85, duration_sec: null, survival_sec: null, cleared: true, created_at: isoDaysAgo(3) },
      { id: uid(), user_id: 'dev-user-sam', mode: 'gauntlet', instrument: 'kick', subdivision: 'sixteenth', bpm: null, level: 1, rank: 'S', green_pct: 91, duration_sec: null, survival_sec: null, cleared: true, created_at: isoDaysAgo(1) },
      { id: uid(), user_id: 'dev-user-wei', mode: 'gauntlet', instrument: 'kick', subdivision: 'triplet', bpm: null, level: 1, rank: 'B', green_pct: 80, duration_sec: null, survival_sec: null, cleared: false, created_at: isoDaysAgo(4) },
      { id: uid(), user_id: 'dev-user-alex', mode: 'gauntlet', instrument: 'kick', subdivision: 'sextuplet', bpm: null, level: 1, rank: 'A', green_pct: 82, duration_sec: null, survival_sec: null, cleared: true, created_at: isoDaysAgo(2) },
      { id: uid(), user_id: 'dev-user-alex', mode: 'timetrial', instrument: 'snare', subdivision: 'sixteenth', bpm: 120, level: null, rank: 'C', green_pct: 68, duration_sec: 60, survival_sec: null, cleared: false, created_at: isoDaysAgo(6) },
    ];
    return { profiles, runs, beta_waitlist: [], account_deletion_requests: [], ramp_presets: [], sessionUserId: null };
  }

  function purgeUserData(userId) {
    if (!db || !userId) return;
    db.profiles = db.profiles.filter(p => p.id !== userId);
    db.runs = db.runs.filter(r => r.user_id !== userId);
    db.account_deletion_requests = (db.account_deletion_requests || [])
      .filter(r => r.user_id !== userId);
    db.ramp_presets = (db.ramp_presets || []).filter(r => r.user_id !== userId);
    persistDb(db);
  }

  function loadDb() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (!parsed.account_deletion_requests) parsed.account_deletion_requests = [];
        if (!parsed.ramp_presets) parsed.ramp_presets = [];
        if (parsed.runs) parsed.runs.forEach(r => { if (!r.subdivision) r.subdivision = 'sixteenth'; });
        return parsed;
      }
    } catch (e) {}
    const seeded = seedDb();
    persistDb(seeded);
    return seeded;
  }

  function persistDb(next) {
    db = next;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch (e) {}
  }

  function devUserById(id) {
    return DEV_USERS.find(u => u.id === id) || null;
  }

  function displayNameForUser(userId) {
    const p = db && db.profiles.find(pr => pr.id === userId);
    if (p && p.display_name) return p.display_name;
    const dev = devUserById(userId);
    if (dev) {
      const m = dev.user_metadata || {};
      return m.full_name || m.name || (dev.email || 'Drummer').split('@')[0];
    }
    return 'Drummer';
  }

  function profileFromOAuth(u) {
    const m = (u && u.user_metadata) || {};
    return {
      display_name: m.full_name || m.name || ((u && u.email) || 'Drummer').split('@')[0],
      avatar_url: m.avatar_url || m.picture || null,
    };
  }

  function clearProfileCache() {
    profileCache = null;
    profileCacheUserId = null;
  }

  function refreshProfileCache() {
    if (!user || !db) {
      clearProfileCache();
      return null;
    }
    const row = db.profiles.find(p => p.id === user.id);
    profileCache = row
      ? { display_name: row.display_name, avatar_url: row.avatar_url }
      : profileFromOAuth(user);
    profileCacheUserId = user.id;
    return profileCache;
  }

  function setUser(u) {
    user = u || null;
    if (db) {
      db.sessionUserId = user ? user.id : null;
      persistDb(db);
    }
    if (user) {
      upsertProfile().then(() => refreshProfileCache());
    } else {
      clearProfileCache();
    }
    if (onAuthChange) onAuthChange(user);
  }

  function init(opts) {
    if (opts && opts.onAuthChange) onAuthChange = opts.onAuthChange;
    if (ready) return true;
    db = loadDb();
    const sessionUser = db.sessionUserId ? devUserById(db.sessionUserId) : null;
    user = sessionUser;
    if (user) {
      const requests = db.account_deletion_requests || [];
      const due = requests.find(r => {
        if (r.user_id !== user.id) return false;
        const t = Date.parse(r.scheduled_for);
        return !Number.isNaN(t) && t <= Date.now();
      });
      if (due) {
        purgeUserData(user.id);
        db.sessionUserId = null;
        persistDb(db);
        user = null;
      } else {
        refreshProfileCache();
      }
    }
    ready = true;   // before onAuthChange — same contract as cloud-supabase getSession
    if (onAuthChange) onAuthChange(user);
    return true;
  }

  function isReady() { return ready; }
  function currentUser() { return user; }
  function getClient() { return null; }
  function getDevUsers() { return DEV_USERS.slice(); }

  async function signInAs(userId) {
    if (!init()) return;
    const u = devUserById(userId);
    if (!u) return;
    setUser(u);
    await upsertProfile();
  }

  async function signIn() {
    // Facade opens the dev user picker; default to first user if called directly.
    if (!user) await signInAs(DEV_USERS[0].id);
  }

  async function signOut() {
    setUser(null);
  }

  async function upsertProfile() {
    if (!user || !db) return;
    const row = Object.assign({ id: user.id }, profileFromOAuth(user));
    const idx = db.profiles.findIndex(p => p.id === row.id);
    if (idx < 0) {
      db.profiles.push(row);
      persistDb(db);
    }
  }

  async function getProfile() {
    if (!init() || !user) return null;
    if (profileCache && profileCacheUserId === user.id) {
      return { display_name: profileCache.display_name, avatar_url: profileCache.avatar_url };
    }
    const p = refreshProfileCache();
    return p ? { display_name: p.display_name, avatar_url: p.avatar_url } : null;
  }

  async function updateProfile(fields) {
    if (!init() || !user || !db) return { error: 'signed-out' };
    const idx = db.profiles.findIndex(p => p.id === user.id);
    const row = {
      id: user.id,
      display_name: fields.display_name,
      avatar_url: fields.avatar_url == null ? null : fields.avatar_url,
    };
    if (idx >= 0) db.profiles[idx] = row;
    else db.profiles.push(row);
    persistDb(db);
    profileCache = { display_name: row.display_name, avatar_url: row.avatar_url };
    profileCacheUserId = user.id;
    return { ok: true };
  }

  async function resetProfileFromGoogle() {
    if (!init() || !user || !db) return { error: 'signed-out' };
    const row = Object.assign({ id: user.id }, profileFromOAuth(user));
    const idx = db.profiles.findIndex(p => p.id === row.id);
    if (idx >= 0) db.profiles[idx] = row;
    else db.profiles.push(row);
    persistDb(db);
    profileCache = { display_name: row.display_name, avatar_url: row.avatar_url };
    profileCacheUserId = user.id;
    return { ok: true };
  }

  async function getSessionUser() {
    if (!init()) return null;
    return user;
  }

  async function claimBetaSpot() {
    if (!user) return 'unauthenticated';
    return 'ok';
  }

  async function joinWaitlist(email) {
    if (!init()) return { error: 'no-client' };
    const e = (email || '').trim().toLowerCase();
    if (!e) return { error: 'empty' };
    if (db.beta_waitlist.some(w => w.email === e)) return {};
    db.beta_waitlist.push({ email: e });
    persistDb(db);
    return {};
  }

  async function submitRun(record) {
    if (!init()) return { skipped: 'no-client' };
    if (!user) return { skipped: 'signed-out' };

    if (!record.run_id) return { valid: false, reject_reason: 'missing_run_id' };

    const V = typeof window !== 'undefined' ? window.RunSubmitValidation : null;
    if (V && V.isDuplicateRun(db.runs, user.id, record.run_id)) {
      return { valid: false, reject_reason: 'duplicate_run' };
    }

    const prev = db.runs
      .filter(r => r.user_id === user.id)
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null;

    const nowMs = Date.now();
    const check = V
      ? V.validateRunSubmit(prev, record, nowMs)
      : { valid: true, reject_reason: null };

    const row = {
      id: uid(),
      user_id: user.id,
      created_at: new Date(nowMs).toISOString(),
      run_id: record.run_id,
      started_at: record.started_at,
      played_sec: record.played_sec == null ? null : record.played_sec,
      valid: check.valid,
      reject_reason: check.reject_reason,
      mode: record.mode,
      instrument: record.instrument || 'kick',
      subdivision: record.subdivision || 'sixteenth',
      bpm: record.bpm == null ? null : record.bpm,
      level: record.level == null ? null : record.level,
      rank: record.rank,
      green_pct: record.green_pct,
      duration_sec: record.duration_sec == null ? null : record.duration_sec,
      survival_sec: record.survival_sec == null ? null : record.survival_sec,
      cleared: !!record.cleared,
    };
    db.runs.push(row);
    persistDb(db);
    return { valid: check.valid, reject_reason: check.reject_reason };
  }

  async function saveRun(record) {
    return submitRun(record);
  }

  async function myRuns() {
    if (!init() || !user) return [];
    return db.runs.filter(r => r.user_id === user.id);
  }

  function runSortKey(mode, run) {
    const clearedFirst = (mode === 'gauntlet' && run.cleared) ? 1 : 0;
    const primary = mode === 'suddendeath' ? (run.survival_sec ?? -1) : (run.green_pct ?? -1);
    const duration = run.duration_sec ?? -1;
    const created = run.created_at || '';
    return { clearedFirst, primary, duration, created };
  }

  function compareRuns(mode, a, b) {
    const ka = runSortKey(mode, a);
    const kb = runSortKey(mode, b);
    if (kb.clearedFirst !== ka.clearedFirst) return kb.clearedFirst - ka.clearedFirst;
    if (kb.primary !== ka.primary) return kb.primary - ka.primary;
    if (kb.duration !== ka.duration) return kb.duration - ka.duration;
    if (ka.created < kb.created) return -1;
    if (ka.created > kb.created) return 1;
    return 0;
  }

  async function leaderboard(mode, bpm, level, instrument, subdivision) {
    if (!init()) return [];
    const slice = db.runs
      .map(r => {
        const p = db.profiles.find(pr => pr.id === r.user_id);
        return {
          ...r,
          dname: displayNameForUser(r.user_id),
          aurl: (p && p.avatar_url) || null,
        };
      })
      .filter(r =>
        r.valid !== false &&
        r.mode === mode &&
        (bpm == null || r.bpm === bpm) &&
        (level == null || r.level === level) &&
        (instrument == null || r.instrument === instrument) &&
        (subdivision == null || (r.subdivision || 'sixteenth') === subdivision)
      );

    const bestByUser = new Map();
    for (const run of slice) {
      const prev = bestByUser.get(run.user_id);
      if (!prev || compareRuns(mode, run, prev) < 0) bestByUser.set(run.user_id, run);
    }

    const rows = Array.from(bestByUser.values())
      .sort((a, b) => compareRuns(mode, a, b))
      .slice(0, 100)
      .map(r => ({
        display_name: r.dname,
        avatar_url: r.aurl,
        rank: r.rank,
        green_pct: r.green_pct,
        duration_sec: r.duration_sec,
        survival_sec: r.survival_sec,
        cleared: r.cleared,
        achieved_at: r.created_at,
      }));

    return rows;
  }

  async function requestAccountDeletion(opts) {
    if (!init() || !user || !db) return { error: 'signed-out' };
    const immediate = !!(opts && opts.immediate);
    if (!db.account_deletion_requests) db.account_deletion_requests = [];
    if (immediate) {
      purgeUserData(user.id);
      clearProfileCache();
      return { ok: true, immediate: true };
    }
    const scheduled = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const idx = db.account_deletion_requests.findIndex(r => r.user_id === user.id);
    const row = { user_id: user.id, requested_at: new Date().toISOString(), scheduled_for: scheduled };
    if (idx >= 0) db.account_deletion_requests[idx] = row;
    else db.account_deletion_requests.push(row);
    persistDb(db);
    return { ok: true, immediate: false, scheduled_for: scheduled };
  }

  async function cancelAccountDeletion() {
    if (!init() || !user || !db) return { error: 'signed-out' };
    if (!db.account_deletion_requests) return { ok: true };
    const before = db.account_deletion_requests.length;
    db.account_deletion_requests = db.account_deletion_requests.filter(r => r.user_id !== user.id);
    if (db.account_deletion_requests.length !== before) persistDb(db);
    return { ok: true };
  }

  async function getAccountDeletionStatus() {
    if (!init() || !user || !db) return { pending: false };
    const row = (db.account_deletion_requests || []).find(r => r.user_id === user.id);
    if (!row) return { pending: false };
    const t = Date.parse(row.scheduled_for);
    if (Number.isNaN(t) || t <= Date.now()) return { pending: false };
    return { pending: true, scheduled_for: row.scheduled_for };
  }

  async function getRampPresets() {
    if (!init() || !user || !db) return null;
    if (!db.ramp_presets) db.ramp_presets = [];
    const row = db.ramp_presets.find(r => r.user_id === user.id);
    if (!row) return { presets: [], updated_at: null };
    return {
      presets: Array.isArray(row.presets) ? row.presets : [],
      updated_at: row.updated_at || null,
    };
  }

  async function saveRampPresets(presets) {
    if (!init() || !user || !db) return { error: 'signed-out' };
    if (!db.ramp_presets) db.ramp_presets = [];
    const list = Array.isArray(presets) ? presets : [];
    const updated_at = new Date().toISOString();
    const row = { user_id: user.id, presets: list, updated_at };
    const idx = db.ramp_presets.findIndex(r => r.user_id === user.id);
    if (idx >= 0) db.ramp_presets[idx] = row;
    else db.ramp_presets.push(row);
    persistDb(db);
    return { ok: true, updated_at };
  }

  function resetMockData() {
    db = seedDb();
    persistDb(db);
    setUser(db.sessionUserId ? devUserById(db.sessionUserId) : null);
    console.info('[cloud] mock data reset');
  }

  return {
    init, isReady, signIn, signInAs, signOut, currentUser, getSessionUser, getClient,
    getProfile, updateProfile, resetProfileFromGoogle,
    requestAccountDeletion, cancelAccountDeletion, getAccountDeletionStatus,
    getRampPresets, saveRampPresets,
    claimBetaSpot, joinWaitlist, submitRun, saveRun, myRuns, leaderboard,
    getDevUsers, resetMockData,
  };
})();

if (typeof window !== 'undefined') window.CloudMockBackend = CloudMockBackend;

'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   PATCH NOTES STORAGE — list + fetch versioned markdown from Supabase Storage.
   No repo-local patch note files; empty/unreachable Storage fails gracefully.

   Owner SQL (run in Supabase SQL editor — see sql/supabase-migration-patch-notes-storage.sql):
   anon SELECT on storage.objects scoped to Patch Notes/ in User-Facing Data bucket.
   ════════════════════════════════════════════════════════════════════════════ */
window.PatchNotesStorage = (function () {
  const SUPABASE_URL = 'https://mmdmibimpipxckgfmhmz.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tZG1pYmltcGlweGNrZ2ZtaG16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDY2NjEsImV4cCI6MjA5NTk4MjY2MX0.dw01oyBckqm8yG_WUA3NmHDrRmts0g6sz8nOtuowk04';

  const BUCKET = 'User-Facing Data';
  const PATCH_FOLDER = 'Patch Notes';
  const BUCKET_ENC = encodeURIComponent(BUCKET);
  const PUBLIC_BASE = SUPABASE_URL + '/storage/v1/object/public/' + BUCKET_ENC + '/' + encodeURIComponent(PATCH_FOLDER);

  const SEEN_KEY = 'gm_patch_notes_seen';
  const CACHE_LIST_KEY = 'gm_patch_notes_list';
  const BANNER_TTL_MS = 48 * 60 * 60 * 1000;

  const SEMVER_MD = /^(\d+\.\d+\.\d+)\.md$/i;

  function parseSemver(v) {
    if (!v) return [0, 0, 0];
    return String(v).split('.').map((n) => parseInt(n, 10) || 0);
  }

  function compareSemver(a, b) {
    const pa = parseSemver(a);
    const pb = parseSemver(b);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const da = pa[i] || 0;
      const db = pb[i] || 0;
      if (da !== db) return da - db;
    }
    return 0;
  }

  function sortBySemverDesc(entries) {
    return entries.slice().sort((a, b) => compareSemver(b.version, a.version));
  }

  function fileToEntry(file) {
    if (!file || !file.name || file.id === null) return null;
    const m = file.name.match(SEMVER_MD);
    if (!m) return null;
    return {
      version: m[1],
      name: file.name,
      updated_at: file.updated_at || file.created_at || null,
    };
  }

  function storageHeaders() {
    return {
      apikey: SUPABASE_ANON,
      Authorization: 'Bearer ' + SUPABASE_ANON,
      'Content-Type': 'application/json',
    };
  }

  function fetchHeaders() {
    return {
      apikey: SUPABASE_ANON,
      Authorization: 'Bearer ' + SUPABASE_ANON,
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    };
  }

  function listPatchNotesRemote() {
    const url = SUPABASE_URL + '/storage/v1/object/list/' + BUCKET_ENC;
    return fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: storageHeaders(),
      body: JSON.stringify({
        prefix: PATCH_FOLDER,
        limit: 100,
        offset: 0,
      }),
    }).then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then((rows) => {
      const entries = (Array.isArray(rows) ? rows : [])
        .map(fileToEntry)
        .filter(Boolean);
      return sortBySemverDesc(entries);
    });
  }

  function publicUrl(version) {
    return PUBLIC_BASE + '/' + encodeURIComponent(version + '.md');
  }

  function fetchPatchNoteRemote(version) {
    const bust = '?_=' + Date.now();
    return fetch(publicUrl(version) + bust, {
      cache: 'no-store',
      headers: fetchHeaders(),
    }).then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    });
  }

  function trySingleFileFallback() {
    const version = (typeof window !== 'undefined' && window.APP_VERSION) || '';
    if (!version) return Promise.resolve([]);
    return fetchPatchNoteRemote(version).then(() => [{
      version,
      name: version + '.md',
      updated_at: null,
    }]).catch(() => []);
  }

  function listPatchNotes() {
    return listPatchNotesRemote()
      .catch(() => trySingleFileFallback())
      .then((entries) => {
        if (entries.length) writeListCache(entries);
        return entries;
      });
  }

  function fetchPatchNote(version) {
    return fetchPatchNoteRemote(version);
  }

  function getLastSeen() {
    try {
      return localStorage.getItem(SEEN_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function markSeen(version) {
    if (!version) return;
    try {
      localStorage.setItem(SEEN_KEY, version);
    } catch (e) { /* private mode / quota */ }
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('patchnotes:seen', { detail: { version } }));
    }
  }

  function readListCache() {
    try {
      const raw = localStorage.getItem(CACHE_LIST_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? sortBySemverDesc(parsed) : null;
    } catch (e) {
      return null;
    }
  }

  function writeListCache(entries) {
    try {
      localStorage.setItem(CACHE_LIST_KEY, JSON.stringify(entries));
    } catch (e) { /* skip */ }
  }

  function isWithinBannerTtl(updatedAt) {
    if (!updatedAt) return true;
    const ts = new Date(updatedAt).getTime();
    if (Number.isNaN(ts)) return true;
    return (Date.now() - ts) <= BANNER_TTL_MS;
  }

  function getUnseenState(entries) {
    if (!entries || !entries.length) {
      return { latest: null, showBanner: false };
    }
    const latest = entries[0];
    const lastSeen = getLastSeen();
    if (compareSemver(latest.version, lastSeen) <= 0) {
      return { latest, showBanner: false };
    }
    const showBanner = isWithinBannerTtl(latest.updated_at);
    return { latest, showBanner };
  }

  return {
    BANNER_TTL_MS,
    SEEN_KEY,
    compareSemver,
    listPatchNotes,
    fetchPatchNote,
    publicUrl,
    getLastSeen,
    markSeen,
    readListCache,
    writeListCache,
    isWithinBannerTtl,
    getUnseenState,
  };
})();

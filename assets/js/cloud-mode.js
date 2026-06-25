'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   CLOUD MODE — pick mock (local dev) vs Supabase (deployed prod).

   Loaded synchronously before the async cloud script chain in index/stats.
   Mock is used for every non-production host: localhost, LAN IPs, machine
   names, etc. Supabase only on the live deploy hostnames.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  const PROD_HOSTS = new Set([
    'metronome.artofdrumminghq.com',
    'dreamusichef.github.io',
  ]);

  function isPrivateOrLoopbackHost(hostname) {
    const h = String(hostname || '').toLowerCase();
    if (!h) return false;
    if (h === 'localhost' || h === '::1' || h === '[::1]') return true;
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (!m) return false;
    const a = +m[1];
    const b = +m[2];
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    return false;
  }

  function resolveCloudMode(hostname) {
    const h = String(hostname || '').toLowerCase();
    if (PROD_HOSTS.has(h)) return 'supabase';
    // Explicit loopback / RFC1918 — always mock even if PROD_HOSTS ever grows.
    if (isPrivateOrLoopbackHost(h)) return 'mock';
    // Any other host (e.g. http-server -a 0.0.0.0 on a LAN machine name) → mock.
    return 'mock';
  }

  const CloudMode = {
    PROD_HOSTS,
    isPrivateOrLoopbackHost,
    resolveCloudMode,
    isMock(hostname) {
      return resolveCloudMode(hostname) === 'mock';
    },
  };

  if (typeof window !== 'undefined') {
    window.CloudMode = CloudMode;
    window.__CLOUD_MODE__ = resolveCloudMode(
      typeof location !== 'undefined' ? location.hostname : ''
    );
  }
})();

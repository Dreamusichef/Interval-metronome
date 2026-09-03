'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   CLOUD GAME — Game Mode APIs on top of core Cloud auth (window.Cloud).

   Loaded after core/js/cloud/auth.js. Extends Cloud with beta / runs / leaderboard.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  const C = window.Cloud;
  if (!C) return;

  Object.assign(C, {
    async claimBetaSpot() {
      const backend = C.init();
      if (!backend) return 'error';
      return backend.claimBetaSpot();
    },

    async joinWaitlist(email) {
      const backend = C.init();
      if (!backend) return { error: 'no-client' };
      // Basic format guard before hitting the DB. The real abuse protection is the
      // server-side rate-limit RLS policy on beta_waitlist; this just rejects
      // obviously malformed input (incl. programmatic callers bypassing the
      // form's required+type=email validation).
      const e = (email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { error: 'invalid-email' };
      return backend.joinWaitlist(e);
    },

    async submitRun(record) {
      const backend = C.init();
      if (!backend) return { skipped: 'no-client' };
      if (backend.submitRun) return backend.submitRun(record);
      return backend.saveRun(record);
    },

    async saveRun(record) {
      return C.submitRun(record);
    },

    async myRuns() {
      const backend = C.init();
      if (!backend) return [];
      return backend.myRuns();
    },

    async leaderboard(mode, bpm, level, instrument, subdivision) {
      const backend = C.init();
      if (!backend) return [];
      return backend.leaderboard(mode, bpm, level, instrument, subdivision);
    },
  });
})();

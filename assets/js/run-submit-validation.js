'use strict';

/* Pure submit_run validation — mirrors sql/supabase-migration-submit-run.sql.
   Browser build for cloud-mock.js; Node copy: lib/run-submit-validation.cjs */

const RunSubmitValidation = (() => {
  const GRACE_SEC = 25;

  function maxPlayedSec(mode, durationSec) {
    if (mode === 'gauntlet') return 5 * 60 + 4 * 10 + GRACE_SEC;
    if (durationSec != null) return durationSec + GRACE_SEC;
    return 3600 + GRACE_SEC;
  }

  function validateRunSubmit(prev, payload, nowMs) {
    const { run_id, started_at, played_sec, mode, duration_sec } = payload;

    if (!run_id) return { valid: false, reject_reason: 'missing_run_id' };

    const startedMs = started_at ? Date.parse(started_at) : NaN;
    if (!started_at || Number.isNaN(startedMs)
        || startedMs > nowMs + 30000
        || startedMs < nowMs - 24 * 60 * 60 * 1000) {
      return { valid: false, reject_reason: 'invalid_started_at' };
    }

    if (played_sec == null || played_sec < 1) {
      return { valid: false, reject_reason: 'invalid_played_sec' };
    }
    if (played_sec > maxPlayedSec(mode, duration_sec)) {
      return { valid: false, reject_reason: 'invalid_played_sec' };
    }

    if (prev) {
      const prevCreatedMs = Date.parse(prev.created_at || '');
      if (!Number.isNaN(prevCreatedMs)) {
        const elapsedSec = (nowMs - prevCreatedMs) / 1000;
        if (elapsedSec < played_sec - GRACE_SEC) {
          return { valid: false, reject_reason: 'impossible_timing' };
        }
      }
      if (prev.started_at && prev.played_sec != null) {
        const prevStartedMs = Date.parse(prev.started_at);
        const gapMs = Math.max(prev.played_sec - GRACE_SEC, 0) * 1000;
        if (!Number.isNaN(prevStartedMs) && startedMs < prevStartedMs + gapMs) {
          return { valid: false, reject_reason: 'overlapping_run' };
        }
      }
    }

    return { valid: true, reject_reason: null };
  }

  function isDuplicateRun(runs, userId, runId) {
    return runs.some(r => r.user_id === userId && r.run_id === runId);
  }

  return { GRACE_SEC, maxPlayedSec, validateRunSubmit, isDuplicateRun };
})();

if (typeof window !== 'undefined') window.RunSubmitValidation = RunSubmitValidation;

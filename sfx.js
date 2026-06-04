'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   GAME SFX — result-screen reward sounds.

   window.GameSfx(key)            play a sound by event key (no-op if unknown)
   window.GameSfx.preloadAll()    eagerly fetch every clip
   window.GameSfx.setEnabled(b)   mute / unmute
   window.GameSfx.completeKey(mode, suddenDeath, rank)  → the right "complete" key

   Files live in sounds/ (mono 44.1kHz wav). Ranks D/C/B share one reveal clip.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  const BASE = 'sounds/';
  const V = '1';   // cache-bust — bump if a clip is re-exported
  const MANIFEST = {
    // Rank-reveal flourish (fires when the emblem bursts in)
    rankE: 'rank-e.wav',
    rankD: 'rank-dcb.wav', rankC: 'rank-dcb.wav', rankB: 'rank-dcb.wav',
    rankA: 'rank-a.wav', rankS: 'rank-s.wav', rankSS: 'rank-ss.wav',
    // Run-complete stingers (fire when the result overlay appears)
    'completeTT-E': 'complete-tt-e.wav',
    'completeTT-DCBA': 'complete-tt-dcba.wav',
    'completeTT-SSS': 'complete-tt-sss.wav',
    completeSD: 'complete-sd.wav',
    completeGauntlet: 'complete-gauntlet.wav',
    // Fail stinger (sudden death death / gauntlet fail)
    fail: 'fail.wav',
    // Each trophy pop
    trophyPop: 'trophy.wav',
  };

  const cache = {};
  let enabled = true;

  function get(key) {
    const file = MANIFEST[key];
    if (!file) return null;
    if (!cache[file]) {
      const a = new Audio(BASE + file + '?v=' + V);
      a.preload = 'auto';
      cache[file] = a;
    }
    return cache[file];
  }

  function play(key) {
    if (!enabled) return;
    const a = get(key);
    if (!a) return;
    try { a.currentTime = 0; const p = a.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }

  play.preloadAll = () => Object.keys(MANIFEST).forEach(get);
  play.setEnabled = (b) => { enabled = !!b; };
  play.manifest = MANIFEST;
  // Pick the run-complete stinger for a cleared run.
  play.completeKey = (mode, suddenDeath, rank) => {
    if (mode === 'gauntlet') return 'completeGauntlet';
    if (suddenDeath) return 'completeSD';
    if (rank === 'S' || rank === 'SS') return 'completeTT-SSS';
    if (rank === 'E') return 'completeTT-E';
    return 'completeTT-DCBA';   // D · C · B · A
  };

  window.GameSfx = play;

  // Warm the cache on the first user gesture (also unlocks audio on mobile).
  const warm = () => {
    play.preloadAll();
    window.removeEventListener('pointerdown', warm);
    window.removeEventListener('keydown', warm);
  };
  window.addEventListener('pointerdown', warm, { once: true });
  window.addEventListener('keydown', warm, { once: true });
})();
